import { DEFAULT_BIT_DEPTH, DEVICE_BIT_DEPTHS, KIT_CODE_RE, VOICE_INDICES } from './device'
import type { BitDepth, VoiceIndex } from './device'
import { hydratePattern, hydratePreset, hydrateSequence } from './library'
import { DEFAULT_BPM, clampBpm } from './sequence'
import type {
  AudioMeta,
  Codec,
  Container,
  Kit,
  Sample,
  SampleId,
  SavedPattern,
  SavedPreset,
  Session,
  Slot,
  Voice,
} from './types'
import { createVoice, makeSlot, normaliseChannelName } from './voice'

/**
 * The portable project file.
 *
 * Distinct from the localStorage session, which is a resume-where-you-left-off cache tied
 * to one browser. A project file crosses machines, so unlike the session it carries its
 * audio with it and unlike the session it is fully untrusted on the way back in: nothing
 * here assumes the file was written by a version of this app that agrees with this one.
 *
 * Anything unrecognised degrades to a default rather than failing the import. The one
 * exception is a sample whose audio is absent from the archive — that is dropped outright,
 * because keeping it would restore a session with a row that can never play or export.
 */

const CONTAINERS: readonly Container[] = ['wav', 'mp3', 'flac', 'ogg', 'm4a', 'aiff', 'unknown']
const CODECS: readonly Codec[] = [
  'pcm',
  'ieee-float',
  'alaw',
  'mulaw',
  'adpcm',
  'compressed',
  'unknown',
]

export const PROJECT_FORMAT = 'rample-kit-studio-project'
export const PROJECT_VERSION = 1

/** Where sample audio sits inside the archive, keyed by sample id. */
export const AUDIO_DIR = 'audio'

export interface ProjectManifest {
  format: typeof PROJECT_FORMAT
  version: typeof PROJECT_VERSION
  savedAt: string
  kits: Kit[]
  activeKitId: string
  masterVolume: number
  keepAlive: boolean
  library: { patterns: SavedPattern[]; presets: SavedPreset[] }
}

export interface ProjectImport {
  session: Session
  library: { patterns: SavedPattern[]; presets: SavedPreset[] }
  /** Names of samples dropped because the archive had no audio for them. */
  missingAudio: string[]
}

export function buildManifest(
  session: Session,
  library: { patterns: readonly SavedPattern[]; presets: readonly SavedPreset[] },
  now: Date = new Date(),
): ProjectManifest {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: now.toISOString(),
    kits: session.kits,
    activeKitId: session.activeKitId,
    masterVolume: session.master.volume,
    keepAlive: session.keepAlive,
    library: { patterns: [...library.patterns], presets: [...library.presets] },
  }
}

// ── Hydration ───────────────────────────────────────────────────────────────────

function asRecord(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null
}

function asNumber(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback
}

/** 0..1, since these feed GainNodes directly and a stray 40 would be deafening. */
function asVolume(raw: unknown): number {
  return Math.max(0, Math.min(1, asNumber(raw, 0.8)))
}

function hydrateMeta(raw: unknown): AudioMeta {
  const input = asRecord(raw) ?? {}
  const container = CONTAINERS.includes(input.container as Container)
    ? (input.container as Container)
    : 'unknown'
  const codec = CODECS.includes(input.codec as Codec) ? (input.codec as Codec) : 'unknown'

  return {
    container,
    codec,
    // null is meaningful here — it is how a non-WAV container reports "no PCM figure" —
    // so a missing or non-numeric value maps to null rather than to a made-up number.
    sampleRate: typeof input.sampleRate === 'number' ? input.sampleRate : null,
    bitDepth: typeof input.bitDepth === 'number' ? input.bitDepth : null,
    channels: Math.max(1, Math.round(asNumber(input.channels, 1))),
    durationSec: Math.max(0, asNumber(input.durationSec, 0)),
    sizeBytes: Math.max(0, Math.round(asNumber(input.sizeBytes, 0))),
  }
}

export function hydrateSample(raw: unknown): Sample | null {
  const input = asRecord(raw)
  if (!input || typeof input.id !== 'string' || input.id === '') return null

  return {
    id: input.id,
    name: typeof input.name === 'string' && input.name ? input.name : input.id,
    meta: hydrateMeta(input.meta),
    converted: input.converted === true,
    // 'converting' is transient — a project saved mid-conversion must not import a row
    // stuck showing a spinner for a conversion that will never finish.
    status: input.status === 'error' ? 'error' : 'ready',
    ...(typeof input.error === 'string' ? { error: input.error } : {}),
    ...(input.padded === true ? { padded: true } : {}),
    ...(input.randomMuted === true ? { randomMuted: true } : {}),
  }
}

/**
 * Layer slots, tolerating the older shape.
 *
 * Manifests written before slots existed stored a bare array of sample ids; those read as
 * one slot each, which is exactly what they meant. Slot ids are regenerated rather than
 * trusted, since a duplicated id would make two rows indistinguishable to React and to
 * drag-and-drop.
 */
function hydrateSlots(raw: unknown, knownSamples: ReadonlySet<SampleId>): Slot[] {
  if (!Array.isArray(raw)) return []
  const slots: Slot[] = []
  for (const entry of raw) {
    const sampleId = typeof entry === 'string' ? entry : asRecord(entry)?.sampleId
    if (typeof sampleId === 'string' && knownSamples.has(sampleId)) slots.push(makeSlot(sampleId))
  }
  return slots
}

function hydrateVoice(raw: unknown, index: VoiceIndex, knownSamples: ReadonlySet<SampleId>): Voice {
  const base = createVoice(index)
  const input = asRecord(raw)
  if (!input) return base

  const depth = asNumber(input.targetBitDepth, DEFAULT_BIT_DEPTH)

  return {
    index,
    name: typeof input.name === 'string' ? normaliseChannelName(input.name, index) : base.name,
    mode: input.mode === 'stereo' ? 'stereo' : 'mono',
    targetBitDepth: (DEVICE_BIT_DEPTHS as readonly number[]).includes(depth)
      ? (depth as BitDepth)
      : DEFAULT_BIT_DEPTH,
    convertMode: input.convertMode === 'manual' ? 'manual' : 'auto',
    // Layers are the ordering the device sees, so anything without audio has to go —
    // and dropping it here closes the gap it would otherwise leave in the layer numbering.
    layers: hydrateSlots(input.layers, knownSamples),
    previewMode:
      input.previewMode === 'cyclic' || input.previewMode === 'manual' ? input.previewMode : 'random',
    previewCursor: Math.max(0, Math.round(asNumber(input.previewCursor, 0))),
    mixer: { volume: asVolume(asRecord(input.mixer)?.volume) },
    muted: input.muted === true,
    soloed: input.soloed === true,
  }
}

interface KitFallbacks {
  /** Top-level sequences and tempo from a manifest written before kits owned them. */
  sequences?: unknown
  bpm?: unknown
}

function hydrateKit(
  raw: unknown,
  availableAudio: ReadonlySet<SampleId>,
  fallbackCode: string,
  fallbacks: KitFallbacks = {},
): Kit | null {
  const input = asRecord(raw)
  if (!input || typeof input.id !== 'string' || input.id === '') return null

  const code =
    typeof input.code === 'string' && KIT_CODE_RE.test(input.code) ? input.code : fallbackCode

  // Only samples whose bytes actually shipped in the archive survive.
  const samples: Record<SampleId, Sample> = {}
  const stored = asRecord(input.samples) ?? {}
  for (const value of Object.values(stored)) {
    const sample = hydrateSample(value)
    if (sample && availableAudio.has(sample.id)) samples[sample.id] = sample
  }
  const known = new Set(Object.keys(samples))

  const voices = VOICE_INDICES.map((index) =>
    hydrateVoice(
      Array.isArray(input.voices) ? input.voices.find((v) => asRecord(v)?.index === index) : null,
      index,
      known,
    ),
  )

  const storedOrder = Array.isArray(input.voiceOrder) ? input.voiceOrder : []
  const order = storedOrder.filter((i): i is VoiceIndex =>
    (VOICE_INDICES as readonly number[]).includes(i as number),
  )
  // A partial or duplicated order would drop panels from the UI entirely, so fill in
  // whatever is missing rather than trusting the stored list.
  const voiceOrder = [...new Set(order), ...VOICE_INDICES.filter((i) => !order.includes(i))]

  const storedSequences = Array.isArray(input.sequences)
    ? input.sequences
    : Array.isArray(fallbacks.sequences)
      ? fallbacks.sequences
      : []

  return {
    id: input.id,
    code,
    voices,
    voiceOrder,
    samples,
    sequences: VOICE_INDICES.map((_, i) => hydrateSequence(storedSequences[i])),
    bpm: clampBpm(asNumber(input.bpm, asNumber(fallbacks.bpm, DEFAULT_BPM))),
    activePresetId: typeof input.activePresetId === 'string' ? input.activePresetId : null,
  }
}

/** Every sample name the manifest referenced but the archive had no audio for. */
function findMissingAudio(raw: unknown, availableAudio: ReadonlySet<SampleId>): string[] {
  const missing: string[] = []
  const kits = Array.isArray(asRecord(raw)?.kits) ? (asRecord(raw)!.kits as unknown[]) : []
  for (const kit of kits) {
    const stored = asRecord(asRecord(kit)?.samples) ?? {}
    for (const value of Object.values(stored)) {
      const sample = hydrateSample(value)
      if (sample && !availableAudio.has(sample.id)) missing.push(sample.name)
    }
  }
  return missing
}

/**
 * Rebuild a session and library from an imported manifest.
 *
 * Returns null only when the file is not a project file at all — a recognisable file with
 * damaged contents is repaired rather than rejected, since a partial recovery beats
 * handing the user nothing.
 */
export function hydrateProject(
  raw: unknown,
  availableAudio: ReadonlySet<SampleId>,
): ProjectImport | null {
  const input = asRecord(raw)
  if (!input || input.format !== PROJECT_FORMAT) return null
  if (asNumber(input.version, 0) !== PROJECT_VERSION) return null

  const storedKits = Array.isArray(input.kits) ? input.kits : []
  const kits = storedKits
    .map((kit, i) =>
      hydrateKit(kit, availableAudio, `A${i}`, { sequences: input.sequences, bpm: input.bpm }),
    )
    .filter((kit): kit is Kit => kit !== null)

  // A session with no kits has no tab to show and nothing to edit.
  if (kits.length === 0) return null

  const activeKitId =
    typeof input.activeKitId === 'string' && kits.some((k) => k.id === input.activeKitId)
      ? input.activeKitId
      : kits[0]!.id

  const library = asRecord(input.library) ?? {}

  return {
    session: {
      kits,
      activeKitId,
      // Never import as playing: there is no audio graph yet and starting one needs a gesture.
      transport: { playing: false },
      master: { volume: asVolume(input.masterVolume) },
      keepAlive: input.keepAlive !== false,
    },
    library: {
      patterns: (Array.isArray(library.patterns) ? library.patterns : [])
        .map(hydratePattern)
        .filter((p): p is SavedPattern => p !== null),
      presets: (Array.isArray(library.presets) ? library.presets : [])
        .map(hydratePreset)
        .filter((p): p is SavedPreset => p !== null),
    },
    missingAudio: findMissingAudio(input, availableAudio),
  }
}
