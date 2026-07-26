import { stripExtension } from '~/domain/filename'
import { TYPE_NAME } from './types'
import type { Openness, Register, SampleType } from './types'

/**
 * Tier 0 of sample analysis: read the filename.
 *
 * Cheapest possible source and, on real content, a startlingly good one. Sample packs and
 * factory cards are named by people who wanted to find things again, so the instrument is
 * usually right there — `2 WS Botlo SN75.wav`, `1 BD lg 6.wav`, `3 WS-GritYAMDD10-32 CP.wav`.
 *
 * Nothing here is guessed from statistics. Either a token in the dictionary matched, or
 * the answer is `unknown` — a wrong badge is worse than no badge, and the audio tier
 * exists precisely to answer the cases this one declines.
 */

// ── Tokenising ──────────────────────────────────────────────────────────────────

/**
 * Split a filename into lowercase candidate tokens.
 *
 * The subtlety is trailing digits. Real libraries number their variants by gluing the
 * index onto the abbreviation — `SN75`, `WB89`, `CP03` — so splitting on non-alphanumerics
 * alone yields `sn75`, which matches nothing. Every letters-then-digits token therefore
 * also contributes its letter prefix.
 *
 * Splitting *all* digits out would be worse: `mode808`, `dr110` and `valve606` are machine
 * names, and `808` is meaningful where a bare `8` is not. So the digits are dropped rather
 * than kept as their own token, and only the letters go into matching.
 */
export function tokenise(filename: string): string[] {
  const tokens: string[] = []
  for (const raw of stripExtension(filename).toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw) continue
    tokens.push(raw)
    const letters = /^([a-z]+)[0-9]+$/.exec(raw)
    if (letters) tokens.push(letters[1]!)
  }
  return tokens
}

// ── The dictionary ──────────────────────────────────────────────────────────────

/**
 * Weight doubles as specificity and as confidence.
 *
 * Spelled-out words score highest — nobody writes "snare" by accident. Two-letter
 * abbreviations score lower because they collide with pack and machine names. Broad
 * category prefixes (`prc`, `perc`) score lowest of the real matches, so that in
 * `3 PRC TM 8.wav` the specific `tm` outranks the category it sits inside.
 */
interface Entry {
  type: SampleType
  weight: number
}

const DICTIONARY: Record<string, Entry> = {
  // Kick
  kick: { type: 'kick', weight: 0.95 },
  kik: { type: 'kick', weight: 0.9 },
  bassdrum: { type: 'kick', weight: 0.95 },
  bd: { type: 'kick', weight: 0.85 },
  kd: { type: 'kick', weight: 0.85 },
  bdrum: { type: 'kick', weight: 0.9 },
  '808': { type: 'kick', weight: 0.5 },

  // Snare
  snare: { type: 'snare', weight: 0.95 },
  snr: { type: 'snare', weight: 0.9 },
  sn: { type: 'snare', weight: 0.85 },
  sd: { type: 'snare', weight: 0.8 },

  // Clap
  clap: { type: 'clap', weight: 0.95 },
  cp: { type: 'clap', weight: 0.85 },
  clp: { type: 'clap', weight: 0.85 },
  handclap: { type: 'clap', weight: 0.95 },

  // Hats
  hihat: { type: 'hat', weight: 0.95 },
  hat: { type: 'hat', weight: 0.9 },
  hh: { type: 'hat', weight: 0.9 },
  oh: { type: 'hat', weight: 0.8 },
  chh: { type: 'hat', weight: 0.85 },
  ohh: { type: 'hat', weight: 0.85 },

  // Cymbals
  ride: { type: 'cymbal', weight: 0.9 },
  crash: { type: 'cymbal', weight: 0.9 },
  cymbal: { type: 'cymbal', weight: 0.95 },
  splash: { type: 'cymbal', weight: 0.85 },
  china: { type: 'cymbal', weight: 0.8 },
  cy: { type: 'cymbal', weight: 0.7 },

  // Toms
  tom: { type: 'tom', weight: 0.9 },
  toms: { type: 'tom', weight: 0.9 },
  tm: { type: 'tom', weight: 0.7 },
  lt: { type: 'tom', weight: 0.8 },
  mt: { type: 'tom', weight: 0.8 },
  ht: { type: 'tom', weight: 0.8 },

  // Rim
  rim: { type: 'rim', weight: 0.9 },
  rimshot: { type: 'rim', weight: 0.95 },
  rs: { type: 'rim', weight: 0.7 },
  stick: { type: 'rim', weight: 0.75 },
  sidestick: { type: 'rim', weight: 0.9 },

  // Percussion — the broad bucket, deliberately outranked by anything specific
  perc: { type: 'perc', weight: 0.75 },
  prc: { type: 'perc', weight: 0.7 },
  percussion: { type: 'perc', weight: 0.8 },
  conga: { type: 'perc', weight: 0.9 },
  bongo: { type: 'perc', weight: 0.9 },
  cowbell: { type: 'perc', weight: 0.9 },
  cb: { type: 'perc', weight: 0.6 },
  woodblock: { type: 'perc', weight: 0.9 },
  wb: { type: 'perc', weight: 0.65 },
  shaker: { type: 'perc', weight: 0.9 },
  shake: { type: 'perc', weight: 0.85 },
  tamb: { type: 'perc', weight: 0.85 },
  tambourine: { type: 'perc', weight: 0.95 },
  triangle: { type: 'perc', weight: 0.85 },
  claves: { type: 'perc', weight: 0.9 },
  agogo: { type: 'perc', weight: 0.9 },
  maracas: { type: 'perc', weight: 0.9 },
  guiro: { type: 'perc', weight: 0.9 },
  tabla: { type: 'perc', weight: 0.9 },
  timbale: { type: 'perc', weight: 0.9 },
  cabasa: { type: 'perc', weight: 0.9 },
  block: { type: 'perc', weight: 0.7 },

  // Bass — a bass *instrument*. The drum is `bd`, never a bare "bass".
  bass: { type: 'bass', weight: 0.7 },
  sub: { type: 'bass', weight: 0.7 },
  '303': { type: 'bass', weight: 0.5 },

  // Tonal
  synth: { type: 'tonal', weight: 0.8 },
  lead: { type: 'tonal', weight: 0.8 },
  pad: { type: 'tonal', weight: 0.8 },
  pluck: { type: 'tonal', weight: 0.85 },
  arp: { type: 'tonal', weight: 0.85 },
  bell: { type: 'tonal', weight: 0.8 },
  bells: { type: 'tonal', weight: 0.8 },
  key: { type: 'tonal', weight: 0.7 },
  keys: { type: 'tonal', weight: 0.75 },
  piano: { type: 'tonal', weight: 0.9 },
  organ: { type: 'tonal', weight: 0.9 },
  rhodes: { type: 'tonal', weight: 0.9 },
  saw: { type: 'tonal', weight: 0.6 },
  square: { type: 'tonal', weight: 0.6 },
  string: { type: 'tonal', weight: 0.8 },
  strings: { type: 'tonal', weight: 0.85 },
  brass: { type: 'tonal', weight: 0.8 },
  flute: { type: 'tonal', weight: 0.9 },
  marimba: { type: 'tonal', weight: 0.9 },

  // Chord
  chord: { type: 'chord', weight: 0.9 },
  chords: { type: 'chord', weight: 0.9 },
  stab: { type: 'chord', weight: 0.8 },
  stabs: { type: 'chord', weight: 0.8 },

  // Vocal
  vocal: { type: 'vocal', weight: 0.9 },
  vocals: { type: 'vocal', weight: 0.9 },
  vox: { type: 'vocal', weight: 0.85 },
  voice: { type: 'vocal', weight: 0.8 },
  acapella: { type: 'vocal', weight: 0.95 },
  choir: { type: 'vocal', weight: 0.9 },

  // FX
  fx: { type: 'fx', weight: 0.9 },
  sfx: { type: 'fx', weight: 0.9 },
  noise: { type: 'fx', weight: 0.75 },
  riser: { type: 'fx', weight: 0.85 },
  sweep: { type: 'fx', weight: 0.8 },
  impact: { type: 'fx', weight: 0.8 },
  texture: { type: 'fx', weight: 0.75 },
  atmos: { type: 'fx', weight: 0.8 },
  drone: { type: 'fx', weight: 0.8 },
  glitch: { type: 'fx', weight: 0.8 },
  reverse: { type: 'fx', weight: 0.7 },
  zap: { type: 'fx', weight: 0.8 },

  // Loops
  loop: { type: 'loop', weight: 0.85 },
  break: { type: 'loop', weight: 0.85 },
  breakbeat: { type: 'loop', weight: 0.95 },
  groove: { type: 'loop', weight: 0.75 },
  beat: { type: 'loop', weight: 0.65 },
  bar: { type: 'loop', weight: 0.5 },
}

/** How much a competing match from a different family costs the winner's confidence. */
const CONFLICT_PENALTY = 0.15

// ── Modifiers ───────────────────────────────────────────────────────────────────

const OPENNESS: Record<string, Openness> = {
  open: 'open',
  op: 'open',
  opn: 'open',
  // The abbreviations that already say it: `oh` is an open hat, `chh` a closed one.
  oh: 'open',
  ohh: 'open',
  chh: 'closed',
  closed: 'closed',
  close: 'closed',
  cl: 'closed',
  clsd: 'closed',
  tight: 'closed',
  shut: 'closed',
}

const REGISTER: Record<string, Register> = {
  low: 'low',
  lo: 'low',
  lw: 'low',
  deep: 'low',
  floor: 'low',
  sub: 'low',
  mid: 'mid',
  med: 'mid',
  medium: 'mid',
  mdl: 'mid',
  rack: 'mid',
  high: 'high',
  hi: 'high',
  hgh: 'high',
}

/** Register implied by the abbreviation itself — `lt` is already a low tom. */
const IMPLIED_REGISTER: Record<string, Register> = {
  lt: 'low',
  mt: 'mid',
  ht: 'high',
}

// ── Result ──────────────────────────────────────────────────────────────────────

export interface FilenameTags {
  type: SampleType
  /** 0..1. Zero exactly when nothing matched. */
  confidence: number
  /** The token that decided it, so the UI can explain itself. Null when unknown. */
  evidence: string | null
  openness: Openness | null
  register: Register | null
  /** Tempo advertised in the name, as in `175bpm Break one 8.wav`. */
  tempoBpm: number | null
  /** A note *with an octave* — `C2`, `F#3`. A bare letter is too ambiguous to trust. */
  note: string | null
  /** Variant marker, as in `take2` or `layer3`. Groups alternates of one source. */
  variant: { kind: 'take' | 'layer'; n: number } | null
}

const EMPTY: FilenameTags = {
  type: 'unknown',
  confidence: 0,
  evidence: null,
  openness: null,
  register: null,
  tempoBpm: null,
  note: null,
  variant: null,
}

/**
 * A tempo the name is advertising. Bounded to plausible musical tempos so that
 * `Mode808-29` and a sample rate in the name cannot be read as one.
 */
function readTempo(lower: string): number | null {
  const match = /\b(\d{2,3})\s*bpm\b/.exec(lower)
  if (!match) return null
  const bpm = Number(match[1])
  return bpm >= 40 && bpm <= 300 ? bpm : null
}

/**
 * A pitch, but only when an octave digit is attached.
 *
 * The octave is what makes this safe. Single letters are everywhere in sample names —
 * `4 PHa_D take1.wav` has a stray `D` that means nothing — and the boundary requirement
 * keeps `Lanem_B07` from reading as B0, since `b0` there is followed by another digit.
 */
function readNote(lower: string): string | null {
  const match = /\b([a-g])(#|b)?(-1|[0-8])\b/.exec(lower)
  if (!match) return null
  const [, letter, accidental, octave] = match
  return `${letter!.toUpperCase()}${accidental ?? ''}${octave}`
}

function readVariant(lower: string): FilenameTags['variant'] {
  const match = /\b(take|layer|var|alt)\s*(\d{1,2})\b/.exec(lower)
  if (!match) return null
  const kind = match[1] === 'layer' ? 'layer' : 'take'
  return { kind, n: Number(match[2]) }
}

/**
 * Read everything the filename is willing to say.
 *
 * The winner is the highest-weighted dictionary match, ties going to the *last* one —
 * names read general-to-specific (`WS Perkkit SN24`), so the rightmost match is usually
 * the instrument and everything before it is the pack.
 */
export function tagFilename(filename: string): FilenameTags {
  const lower = stripExtension(filename).toLowerCase()
  const tokens = tokenise(filename)

  let winner: { token: string; entry: Entry } | null = null
  let conflicted = false
  let openness: Openness | null = null
  let register: Register | null = null

  for (const token of tokens) {
    const entry = DICTIONARY[token]
    if (entry) {
      if (winner && winner.entry.type !== entry.type) conflicted = true
      // `>=` so a tie goes to the later token.
      if (!winner || entry.weight >= winner.entry.weight) winner = { token, entry }
    }
    // Modifiers are read independently of the type — `1 RACK TOM HI 02` carries both.
    openness = OPENNESS[token] ?? openness
    register = IMPLIED_REGISTER[token] ?? REGISTER[token] ?? register
  }

  if (!winner) {
    return { ...EMPTY, openness, register, tempoBpm: readTempo(lower), note: readNote(lower), variant: readVariant(lower) }
  }

  const confidence = Math.max(
    0.1,
    Number((winner.entry.weight - (conflicted ? CONFLICT_PENALTY : 0)).toFixed(2)),
  )

  return {
    type: winner.entry.type,
    confidence,
    evidence: winner.token,
    // Only meaningful where a sample can be choked; on a pad it is noise.
    openness: winner.entry.type === 'hat' || winner.entry.type === 'cymbal' ? openness : null,
    register,
    tempoBpm: readTempo(lower),
    note: readNote(lower),
    variant: readVariant(lower),
  }
}

/**
 * Below this, the badge is dimmed. Roughly the line between a spelled-out word and a
 * two-letter abbreviation that also lost a conflict.
 */
export const UNSURE_BELOW = 0.7

/**
 * Plain-English account of what was read and why, for the badge's tooltip.
 *
 * Says which token decided it, because "why does it think this is a tom" is the first
 * question a wrong badge provokes, and the answer is always a token in the filename.
 */
export function describeFilenameTags(tags: FilenameTags): string {
  if (tags.type === 'unknown') {
    return 'Nothing in the filename identifies this sample. Its type will be read from the audio once analysis runs.'
  }

  const qualifiers = [tags.openness, tags.register].filter(Boolean).join(' ')
  const head = qualifiers ? `${qualifiers} ${TYPE_NAME[tags.type].toLowerCase()}` : TYPE_NAME[tags.type]

  const lines = [
    `${head[0]!.toUpperCase()}${head.slice(1)} — matched “${tags.evidence}” in the filename${
      tags.confidence < UNSURE_BELOW ? ', but not confidently' : ''
    }.`,
  ]
  if (tags.note) lines.push(`Note: ${tags.note}`)
  if (tags.tempoBpm) lines.push(`Tempo: ${tags.tempoBpm} BPM`)
  if (tags.variant) lines.push(`${tags.variant.kind === 'take' ? 'Take' : 'Layer'} ${tags.variant.n}`)
  return lines.join('\n')
}
