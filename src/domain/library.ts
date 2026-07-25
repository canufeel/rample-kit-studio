import { VOICE_COUNT } from './device'
import {
  DENSITY_MODES,
  DIVISIONS,
  clampBpm,
  clampLength,
  createSequence,
  hitCount,
  resolvePattern,
} from './sequence'
import type { ChannelSequence, DensityMode, DivisionId, SavedPattern, SavedPreset } from './types'

/**
 * The two-tier library: Tier-2 single-channel patterns and Tier-3 four-channel
 * presets, both global and both independent of kit data.
 *
 * Everything here is pure. The library's one hard rule is copy-in/copy-out, and this file
 * exists mostly to make that rule impossible to get wrong at a call site.
 */

/**
 * Deep copy of a sequence, used on every crossing of the library boundary.
 *
 * This is the whole of the copy-in/copy-out contract, and it has to be a deep copy rather
 * than a spread: `steps` is a mutable array, so `{ ...sequence }` would leave a saved pattern
 * sharing its step map with the live channel it came from. Editing that channel would
 * then silently rewrite the saved entry, and recalling one entry onto two channels would
 * alias them together.
 */
export function cloneSequence(sequence: ChannelSequence): ChannelSequence {
  return {
    ...sequence,
    steps: [...sequence.steps],
    // A randomise queued against the running transport is not part of a pattern's
    // identity. Storing it would make a recalled pattern rewrite itself at the next loop
    // boundary — the same reasoning the session restore uses.
    pendingRandomise: null,
  }
}

/**
 * A channel with nothing to play.
 *
 * "New preset" clears to this rather than to `createSequence()`: the app's default is a
 * 4-in-16 Euclid, which is a fine starting groove but is not *empty*, and a cleared scene to
 * build up from scratch is what "New" is for. Keeping the default length and division means
 * only the hits are gone, so the grid is still the right size to draw into.
 */
export function emptySequence(): ChannelSequence {
  return { ...createSequence(), triggers: 0 }
}

export function isSilent(sequence: ChannelSequence): boolean {
  return hitCount(sequence) === 0
}

// ── Naming ──────────────────────────────────────────────────────────────────────

export const MAX_NAME_LENGTH = 48

/** Collapse whitespace and cap length, so list rows can't be blown out by one entry. */
export function normaliseName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH)
}

/**
 * What the name field is prefilled with when saving a channel's pattern.
 *
 * Combines whatever the pattern was last called with the channel it is being taken from,
 * so re-saving a tweaked pattern suggests a name close to the original, and a never-named
 * pattern still says where it came from.
 */
export function defaultPatternName(sequence: ChannelSequence, channelName: string): string {
  const previous = sequence.name ?? 'Unnamed'
  // Re-saving from the same channel would otherwise stack the channel name on every pass:
  // "Unnamed · Kick", then "Unnamed · Kick · Kick", and so on.
  if (previous.endsWith(`· ${channelName}`)) return previous
  return `${previous} · ${channelName}`
}

/** Presets have no single pattern to describe, so they do fall back to a counter. */
export function defaultPresetName(existing: readonly SavedPreset[]): string {
  const used = new Set(existing.map((p) => p.name))
  for (let n = 1; ; n++) {
    const candidate = `Scene ${n}`
    if (!used.has(candidate)) return candidate
  }
}

// ── Building entries (copy-in) ──────────────────────────────────────────────────

export function createPattern(
  name: string,
  sequence: ChannelSequence,
  sourceChannel: string,
  id: string,
  now: Date = new Date(),
): SavedPattern {
  const entryName = normaliseName(name) || defaultPatternName(sequence, sourceChannel)
  return {
    id,
    name: entryName,
    savedAt: now.toISOString(),
    sourceChannel,
    // The stored copy remembers the name it was saved under, so recalling it and saving
    // again suggests that name rather than "Unnamed".
    sequence: { ...cloneSequence(sequence), name: entryName },
  }
}

/**
 * Capture the current scene. `sequences` and `channelNames` are both in SP slot order —
 * the order the rows appear in the UI — so a preset previews and reloads top to bottom
 * exactly as it was saved.
 */
export function createPreset(
  name: string,
  sequences: readonly ChannelSequence[],
  channelNames: readonly string[],
  bpm: number,
  existing: readonly SavedPreset[],
  id: string,
  now: Date = new Date(),
): SavedPreset {
  const normalised = normaliseName(name)
  return {
    id,
    name: normalised || defaultPresetName(existing),
    savedAt: now.toISOString(),
    bpm: clampBpm(bpm),
    // Pad or trim to exactly four, so a preset always has one slot per voice however it
    // was produced.
    channels: Array.from({ length: VOICE_COUNT }, (_, i) =>
      sequences[i] ? cloneSequence(sequences[i]!) : emptySequence(),
    ),
    channelNames: Array.from({ length: VOICE_COUNT }, (_, i) => channelNames[i] ?? `CH${i + 1}`),
  }
}

// ── Recall (copy-out) ───────────────────────────────────────────────────────────

/** The live sequence a Tier-2 entry should become. Copied again on the way out. */
export function patternForRecall(entry: SavedPattern): ChannelSequence {
  return cloneSequence(entry.sequence)
}

/**
 * The four live sequences, channel names and tempo a Tier-3 entry should become.
 *
 * A channel that carries no pattern name of its own inherits the preset's, so saving one
 * of those channels afterwards suggests "House 909 · Kick" rather than "Unnamed · Kick" —
 * having just loaded a named scene, the scene's name is the best thing to call its parts.
 * A channel that *does* carry a name keeps it, since that name is more specific.
 */
export function presetForRecall(entry: SavedPreset): {
  sequences: ChannelSequence[]
  channelNames: string[]
  bpm: number
} {
  return {
    sequences: Array.from({ length: VOICE_COUNT }, (_, i) => {
      const stored = entry.channels[i]
      if (!stored) return { ...emptySequence(), name: entry.name }
      const copy = cloneSequence(stored)
      return { ...copy, name: copy.name ?? entry.name }
    }),
    channelNames: Array.from({ length: VOICE_COUNT }, (_, i) => entry.channelNames[i] ?? `CH${i + 1}`),
    bpm: clampBpm(entry.bpm),
  }
}

// ── Comparing live state to a loaded preset ─────────────────────────────────────

/**
 * Whether two channels would play identically.
 *
 * Deliberately compares audible behaviour rather than fields. `densityMode` is a setting
 * for the *next* randomise and `pendingRandomise` is transport state, so neither should
 * make a scene look edited; and the two pattern kinds are compared through
 * `resolvePattern`, so switching kind without changing the resulting hits is correctly
 * reported as no change.
 */
export function sequencesEquivalent(a: ChannelSequence, b: ChannelSequence): boolean {
  if (a.length !== b.length || a.division !== b.division) return false
  const left = resolvePattern(a)
  const right = resolvePattern(b)
  return left.every((on, i) => on === right[i])
}

/** Whether the live scene still matches the preset it was loaded from. Slot order. */
export function presetMatchesLive(
  preset: SavedPreset,
  sequences: readonly ChannelSequence[],
  bpm: number,
): boolean {
  if (preset.bpm !== bpm) return false
  return preset.channels.every((channel, i) => {
    const live = sequences[i]
    return live !== undefined && sequencesEquivalent(channel, live)
  })
}

// ── Preview ────────────────────────────────────────────────────────

/**
 * The parameters a library row shows so a pattern can be read before it is loaded.
 *
 * Euclidean entries name their triggers and rotation, since those generate the shape;
 * user entries name their hit count, since the shape *is* the step map and the grid
 * thumbnail beside this text already shows it.
 */
export function describeSequence(sequence: ChannelSequence): string {
  const head = `${sequence.length} steps · ${sequence.division}`
  if (sequence.kind === 'euclidean') {
    const rotation = sequence.rotation > 0 ? ` · rot ${sequence.rotation}` : ''
    return `Euclid · ${head} · ${sequence.triggers} trig${rotation}`
  }
  return `User · ${head} · ${hitCount(sequence)} hits`
}

// ── Hydration from storage ──────────────────────────────────────────────────────

/**
 * Rebuild a sequence from untrusted JSON.
 *
 * localStorage is user-editable, survives across builds, and is the only path into this
 * data, so every field is checked rather than trusted. Anything missing or out of range
 * falls back to the default for that field instead of failing the whole entry — a library
 * is worth more partially recovered than discarded.
 */
export function hydrateSequence(raw: unknown): ChannelSequence {
  const base = createSequence()
  if (typeof raw !== 'object' || raw === null) return base
  const input = raw as Partial<Record<keyof ChannelSequence, unknown>>

  const length = typeof input.length === 'number' ? clampLength(input.length) : base.length
  const kind = input.kind === 'user' ? 'user' : 'euclidean'
  const division = DIVISIONS.some((d) => d.id === input.division)
    ? (input.division as DivisionId)
    : base.division
  const densityMode = (DENSITY_MODES as readonly string[]).includes(input.densityMode as string)
    ? (input.densityMode as DensityMode)
    : base.densityMode

  const triggers =
    typeof input.triggers === 'number' && Number.isFinite(input.triggers)
      ? Math.max(0, Math.min(Math.round(input.triggers), length))
      : Math.min(base.triggers, length)

  const rotation =
    typeof input.rotation === 'number' && Number.isFinite(input.rotation)
      ? ((Math.round(input.rotation) % length) + length) % length
      : 0

  // Re-derived to exactly `length`, so a hand-edited or older entry can never produce a
  // step map that disagrees with the length beside it.
  const stored = Array.isArray(input.steps) ? input.steps : []
  const steps = Array.from({ length }, (_, i) => stored[i] === true)

  const name = typeof input.name === 'string' ? normaliseName(input.name) || null : null

  return {
    name,
    kind,
    length,
    division,
    triggers,
    rotation,
    steps,
    densityMode,
    pendingRandomise: null,
  }
}

function hydrateName(raw: unknown, fallback: string): string {
  const name = typeof raw === 'string' ? normaliseName(raw) : ''
  return name || fallback
}

function hydrateTimestamp(raw: unknown): string {
  return typeof raw === 'string' && !Number.isNaN(Date.parse(raw)) ? raw : new Date().toISOString()
}

/** null when the entry has no usable id — without one it cannot be renamed or deleted. */
export function hydratePattern(raw: unknown): SavedPattern | null {
  if (typeof raw !== 'object' || raw === null) return null
  const input = raw as Record<string, unknown>
  if (typeof input.id !== 'string' || input.id === '') return null

  const sequence = hydrateSequence(input.sequence)

  // Entries written before channels had names stored a numeric `sourceVoice`; read it as
  // the default name for that channel so an existing library still shows its provenance.
  const legacyVoice = Number(input.sourceVoice)
  const sourceChannel =
    typeof input.sourceChannel === 'string' && normaliseName(input.sourceChannel)
      ? normaliseName(input.sourceChannel)
      : `CH${Number.isInteger(legacyVoice) && legacyVoice >= 1 && legacyVoice <= VOICE_COUNT ? legacyVoice : 1}`

  return {
    id: input.id,
    name: hydrateName(input.name, defaultPatternName(sequence, sourceChannel)),
    savedAt: hydrateTimestamp(input.savedAt),
    sourceChannel,
    sequence,
  }
}

export function hydratePreset(raw: unknown): SavedPreset | null {
  if (typeof raw !== 'object' || raw === null) return null
  const input = raw as Record<string, unknown>
  if (typeof input.id !== 'string' || input.id === '') return null

  const stored = Array.isArray(input.channels) ? input.channels : []
  const storedNames = Array.isArray(input.channelNames) ? input.channelNames : []

  return {
    id: input.id,
    name: hydrateName(input.name, 'Scene'),
    savedAt: hydrateTimestamp(input.savedAt),
    bpm: clampBpm(typeof input.bpm === 'number' ? input.bpm : NaN),
    channels: Array.from({ length: VOICE_COUNT }, (_, i) =>
      i < stored.length ? hydrateSequence(stored[i]) : emptySequence(),
    ),
    channelNames: Array.from({ length: VOICE_COUNT }, (_, i) => {
      const stored = storedNames[i]
      return typeof stored === 'string' && normaliseName(stored)
        ? normaliseName(stored)
        : `CH${i + 1}`
    }),
  }
}
