import { DEFAULT_BPM, clampBpm, createSequence } from '~/domain/sequence'
import type { ChannelSequence, Kit, Session, Slot } from '~/domain/types'
import { VOICE_INDICES } from '~/domain/device'
import { defaultChannelName, makeSlot } from '~/domain/voice'

/**
 * Tier-1 persistence: the session's *structure* in localStorage.
 *
 * The pairing with IndexedDB (audioStore.ts) is the whole design — structure is a few
 * kilobytes of JSON and wants synchronous, simple reads; audio is tens of megabytes of
 * binary and would blow localStorage's quota on a single voice. Samples here are
 * metadata plus an id; the bytes are fetched from IndexedDB by that id on demand.
 */

const KEY = 'rks:session:v1'

interface PersistedSession {
  version: 1
  savedAt: string
  kits: Kit[]
  activeKitId: string
  masterVolume?: number
  keepAlive?: boolean
  /**
   * Sequences and tempo used to live here, before either belonged to a kit. Read on load
   * and copied into every kit that lacks its own; never written.
   */
  sequences?: ChannelSequence[]
  bpm?: number
}

export function saveSession(session: Session): void {
  const payload: PersistedSession = {
    version: 1,
    savedAt: new Date().toISOString(),
    kits: session.kits,
    activeKitId: session.activeKitId,
    masterVolume: session.master.volume,
    keepAlive: session.keepAlive,
  }
  localStorage.setItem(KEY, JSON.stringify(payload))
}

/**
 * Layer slots, tolerating the older shape.
 *
 * Sessions written before slots existed stored a bare array of sample ids. Each reads as one
 * slot, which is what it meant — a sample could only appear once. Slot ids are regenerated
 * rather than trusted, since two rows sharing one would be indistinguishable to React and
 * to drag-and-drop.
 */
function hydrateSlots(raw: unknown): Slot[] {
  if (!Array.isArray(raw)) return []
  const slots: Slot[] = []
  for (const entry of raw) {
    if (typeof entry === 'string') slots.push(makeSlot(entry))
    else if (entry && typeof entry === 'object' && typeof (entry as Slot).sampleId === 'string') {
      slots.push(makeSlot((entry as Slot).sampleId))
    }
  }
  return slots
}

/**
 * Backfill fields added after a session was written.
 *
 * Sessions saved before channels had names or an authoritative slot order would otherwise
 * restore with blank labels and no export order at all, so both are filled from the
 * channel's identity — which is exactly what a fresh kit would have used.
 */
function hydrateKits(parsed: PersistedSession): Kit[] {
  return parsed.kits.map((kit) => ({
    ...kit,
    voices: kit.voices.map((voice) => ({
      ...voice,
      name: voice.name || defaultChannelName(voice.index),
      muted: voice.muted === true,
      soloed: voice.soloed === true,
      layers: hydrateSlots(voice.layers),
    })),
    voiceOrder:
      Array.isArray(kit.voiceOrder) && kit.voiceOrder.length > 0
        ? kit.voiceOrder
        : [...VOICE_INDICES],
    // Sessions written when the sequencer was session-wide have one set of patterns and one
    // tempo for every kit. Copying them into each kit is the honest migration: it is what
    // the user was actually hearing, just now owned per kit and free to diverge.
    sequences: hydrateSequences(kit.sequences ?? parsed.sequences),
    bpm: clampBpm(kit.bpm ?? parsed.bpm ?? DEFAULT_BPM),
    activePresetId: typeof kit.activePresetId === 'string' ? kit.activePresetId : null,
  }))
}

/** Fill in anything a session saved by an earlier build didn't have. */
function hydrateSequences(stored: ChannelSequence[] | undefined): ChannelSequence[] {
  return VOICE_INDICES.map((_, i) => {
    const sequence = stored?.[i]
    // `pendingRandomise` is transport state, never restored — a randomise queued before
    // a reload should not fire the moment the user next presses play.
    return sequence ? { ...createSequence(), ...sequence, pendingRandomise: null } : createSequence()
  })
}

export function loadSession(): { session: Session; savedAt: string } | null {
  const raw = localStorage.getItem(KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as PersistedSession
    if (parsed.version !== 1 || !Array.isArray(parsed.kits) || parsed.kits.length === 0) return null
    return {
      session: {
        kits: hydrateKits(parsed),
        activeKitId: parsed.activeKitId,
        // Never restore as playing: the audio graph does not exist yet on a fresh load,
        // and starting the transport requires a user gesture anyway.
        transport: { playing: false },
        master: { volume: parsed.masterVolume ?? 0.8 },
        keepAlive: parsed.keepAlive ?? true,
      },
      savedAt: parsed.savedAt,
    }
  } catch {
    // A corrupt entry should cost the user their session, not the whole app.
    return null
  }
}

export function clearSession(): void {
  localStorage.removeItem(KEY)
}

export function hasSavedSession(): boolean {
  return localStorage.getItem(KEY) !== null
}
