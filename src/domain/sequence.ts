import { euclideanPattern } from './euclid'
import type { ChannelSequence, DensityMode, DivisionId, SequenceKind } from './types'

/**
 * The per-channel sequencer model: time divisions, pattern resolution, and density
 * randomisation.
 *
 * All preview-only. None of this is exported — the Rample has no sequencer, and this
 * exists purely to simulate the external gate/MIDI triggering the device would receive.
 */

// ── Time divisions ──────────────────────────────────────────────────────────────

export interface Division {
  id: DivisionId
  label: string
  /** Length of one step in quarter-note beats. */
  beats: number
}

/**
 * Pamela's-style division set. `beats` is relative to a quarter note, so 1/4 is one
 * beat, a dotted value is 1.5x its plain form, and a triplet is 2/3 of it.
 */
export const DIVISIONS: readonly Division[] = [
  { id: '1/1', label: '1/1', beats: 4 },
  { id: '1/2', label: '1/2', beats: 2 },
  { id: '1/4', label: '1/4', beats: 1 },
  { id: '1/8', label: '1/8', beats: 0.5 },
  { id: '1/16', label: '1/16', beats: 0.25 },
  { id: '1/32', label: '1/32', beats: 0.125 },
  { id: '1/64', label: '1/64', beats: 0.0625 },
  { id: '1/4.', label: '1/4.', beats: 1.5 },
  { id: '1/8.', label: '1/8.', beats: 0.75 },
  { id: '1/16.', label: '1/16.', beats: 0.375 },
  { id: '1/4T', label: '1/4T', beats: 2 / 3 },
  { id: '1/8T', label: '1/8T', beats: 1 / 3 },
  { id: '1/16T', label: '1/16T', beats: 1 / 6 },
]

const DIVISION_BY_ID = new Map(DIVISIONS.map((d) => [d.id, d]))

export function divisionBeats(id: DivisionId): number {
  return DIVISION_BY_ID.get(id)?.beats ?? 0.25
}

/** How long one step of this division lasts, in seconds, at the given tempo. */
export function stepSeconds(division: DivisionId, bpm: number): number {
  return divisionBeats(division) * (60 / bpm)
}

// ── Clock advance ───────────────────────────────────────────────────────────────

export interface ChannelClock {
  /** AudioContext time at which the next step falls due. */
  nextTime: number
  /** Index into the channel's pattern. */
  step: number
}

export interface ScheduledHit {
  step: number
  time: number
}

/**
 * Walk a channel's clock forward, collecting the hits that fall due before `horizon`.
 *
 * Pure — it takes clock state and hands back new clock state rather than mutating shared
 * state, so the timing core of the sequencer can be tested without an AudioContext.
 *
 * Stops early at a loop boundary and reports `wrapped`, rather than running to the
 * horizon. That lets the caller swap in a queued randomisation exactly at the boundary
 * instead of a lookahead window later, which at fast divisions would be a step
 * or more adrift.
 */
export function advanceClock(
  clock: ChannelClock,
  pattern: readonly boolean[],
  division: DivisionId,
  bpm: number,
  horizon: number,
): { hits: ScheduledHit[]; clock: ChannelClock; wrapped: boolean } {
  const hits: ScheduledHit[] = []
  let { nextTime, step } = clock

  const stepDuration = stepSeconds(division, bpm)
  // A non-advancing step would spin this loop forever inside a timer callback. Length
  // and tempo are both clamped upstream, so this is a backstop rather than an expectation.
  if (pattern.length === 0 || !(stepDuration > 0)) {
    return { hits, clock: { nextTime, step }, wrapped: false }
  }

  while (nextTime < horizon) {
    if (pattern[step]) hits.push({ step, time: nextTime })

    nextTime += stepDuration
    step += 1

    if (step >= pattern.length) {
      return { hits, clock: { nextTime, step: 0 }, wrapped: true }
    }
  }

  return { hits, clock: { nextTime, step }, wrapped: false }
}

export const MIN_BPM = 20
export const MAX_BPM = 300
export const DEFAULT_BPM = 120

export const MIN_LENGTH = 1
export const MAX_LENGTH = 64
export const DEFAULT_LENGTH = 16

// ── Density randomisation ───────────────────────────────────────────────

/**
 * How full a randomised pattern gets, as a fraction of its length. Length itself is
 * never randomised — only how many hits land in it and where.
 *
 * Bands are half-open so they don't overlap at the seams, though after rounding to a
 * whole number of hits and clamping, adjacent bands can still produce the same count on
 * short patterns. Tunable constants, not laws.
 */
export const DENSITY_BANDS: Record<DensityMode, { lo: number; hi: number; label: string }> = {
  mezzanine: { lo: 0, hi: 0.25, label: 'sparse' },
  bar: { lo: 0.25, hi: 0.5, label: 'medium' },
  disco: { lo: 0.5, hi: 0.75, label: 'busy' },
}

export const DENSITY_MODES = ['mezzanine', 'bar', 'disco'] as const

/**
 * Floor of one hit, so randomising never silences a channel outright.
 *
 * Set to 0 to honour mezzanine's literal 0% edge and allow occasional resting channels.
 */
export const MIN_RANDOM_HITS = 1

export type Rng = () => number

/** How many hits a randomise should produce for this length and density band. */
export function targetHits(length: number, mode: DensityMode, rng: Rng = Math.random): number {
  const band = DENSITY_BANDS[mode]
  const fraction = band.lo + rng() * (band.hi - band.lo)
  return Math.max(MIN_RANDOM_HITS, Math.min(Math.round(fraction * length), length))
}

/** Place `hits` steps at random across `length` — a partial Fisher-Yates over indices. */
export function randomSteps(length: number, hits: number, rng: Rng = Math.random): boolean[] {
  const indices = Array.from({ length }, (_, i) => i)
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[indices[i], indices[j]] = [indices[j]!, indices[i]!]
  }
  const steps = new Array<boolean>(length).fill(false)
  for (const index of indices.slice(0, hits)) steps[index] = true
  return steps
}

/**
 * Roll new values for a channel, keeping its kind, length and division.
 *
 * Euclidean channels get a new trigger count and a random rotation — density sets how
 * many hits, Bjorklund keeps them even, and the rotation stops every channel landing on
 * the downbeat together. User channels get hits scattered at random, which supplies its
 * own offset variety and so needs no rotation.
 */
export function randomiseSequence(
  sequence: ChannelSequence,
  mode: DensityMode,
  rng: Rng = Math.random,
): Partial<ChannelSequence> {
  const hits = targetHits(sequence.length, mode, rng)

  if (sequence.kind === 'euclidean') {
    return {
      triggers: hits,
      rotation: Math.floor(rng() * sequence.length),
      densityMode: mode,
    }
  }

  return { steps: randomSteps(sequence.length, hits, rng), densityMode: mode }
}

// ── Pattern resolution ──────────────────────────────────────────────────────────

/** The concrete on/off steps a channel plays, whichever mode it is in. */
export function resolvePattern(sequence: ChannelSequence): boolean[] {
  if (sequence.kind === 'euclidean') {
    return euclideanPattern(sequence.length, sequence.triggers, sequence.rotation)
  }
  // A user pattern's step array can lag behind a length change, so normalise it here
  // rather than making every length edit rewrite the array.
  const steps = new Array<boolean>(sequence.length).fill(false)
  for (let i = 0; i < sequence.length; i++) steps[i] = sequence.steps[i] ?? false
  return steps
}

export function hitCount(sequence: ChannelSequence): number {
  return resolvePattern(sequence).filter(Boolean).length
}

export function createSequence(kind: SequenceKind = 'euclidean'): ChannelSequence {
  return {
    name: null,
    kind,
    length: DEFAULT_LENGTH,
    division: '1/16',
    triggers: 4,
    rotation: 0,
    steps: new Array<boolean>(DEFAULT_LENGTH).fill(false),
    densityMode: 'bar',
    pendingRandomise: null,
  }
}

export function clampLength(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_LENGTH
  return Math.max(MIN_LENGTH, Math.min(MAX_LENGTH, Math.round(value)))
}

export function clampBpm(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BPM
  return Math.max(MIN_BPM, Math.min(MAX_BPM, value))
}

/**
 * Whether the four channels drift against each other rather than lining up every bar.
 *
 * Differing step counts and divisions against one global tempo produce polymeter for
 * free — a feature worth surfacing in the UI, since a user who did not intend it will
 * otherwise wonder why the loop never repeats.
 */
export function isPolymetric(sequences: readonly ChannelSequence[]): boolean {
  const active = sequences.filter((s) => hitCount(s) > 0)
  if (active.length < 2) return false
  const cycles = active.map((s) => s.length * divisionBeats(s.division))
  return cycles.some((c) => Math.abs(c - cycles[0]!) > 1e-9)
}
