import { stripExtension } from '~/domain/filename'
import { TYPE_NAME } from './types'
import type { Openness, Register, SampleForm, SampleType } from './types'

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
  const words: string[] = []

  for (const raw of stripExtension(filename).toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw) continue
    words.push(raw)
    tokens.push(raw)
    const letters = /^([a-z]+)[0-9]+$/.exec(raw)
    if (letters) tokens.push(letters[1]!)
  }

  // Adjacent pairs, joined. Compound names are split by a separator as often as not —
  // `hi_hat`, `open_hat`, `bass_drum`, `rim_shot`, `dun_dun`, `one_shot` — and rejoining
  // them catches every one of those with a single rule rather than a dictionary entry per
  // spelling. Spurious pairs like `kicksnare` match nothing and cost nothing.
  for (let i = 0; i + 1 < words.length; i++) tokens.push(words[i]! + words[i + 1]!)

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
  // Written closed up in real packs far more often than the dictionary first allowed.
  clhat: { type: 'hat', weight: 0.9 },
  ophat: { type: 'hat', weight: 0.9 },
  clhh: { type: 'hat', weight: 0.85 },
  ophh: { type: 'hat', weight: 0.85 },
  openhat: { type: 'hat', weight: 0.95 },
  closedhat: { type: 'hat', weight: 0.95 },

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
  // Hand percussion. A world-percussion pack is otherwise almost entirely unreadable —
  // these names are unambiguous and appear in the hundreds across such libraries.
  djembe: { type: 'perc', weight: 0.95 },
  djeme: { type: 'perc', weight: 0.9 },
  darbuka: { type: 'perc', weight: 0.95 },
  doumbek: { type: 'perc', weight: 0.95 },
  dundun: { type: 'perc', weight: 0.95 },
  doundoun: { type: 'perc', weight: 0.95 },
  kenkeni: { type: 'perc', weight: 0.95 },
  sangban: { type: 'perc', weight: 0.95 },
  gongoma: { type: 'perc', weight: 0.95 },
  udu: { type: 'perc', weight: 0.9 },
  cajon: { type: 'perc', weight: 0.95 },
  taiko: { type: 'perc', weight: 0.95 },
  surdo: { type: 'perc', weight: 0.95 },
  dhol: { type: 'perc', weight: 0.9 },
  bendir: { type: 'perc', weight: 0.95 },
  riq: { type: 'perc', weight: 0.9 },
  shekere: { type: 'perc', weight: 0.95 },
  caxixi: { type: 'perc', weight: 0.95 },
  berimbau: { type: 'perc', weight: 0.95 },
  tambourim: { type: 'perc', weight: 0.9 },
  pandeiro: { type: 'perc', weight: 0.95 },
  castanet: { type: 'perc', weight: 0.9 },
  woodfish: { type: 'perc', weight: 0.9 },
  chime: { type: 'perc', weight: 0.8 },
  chimes: { type: 'perc', weight: 0.8 },
  gong: { type: 'perc', weight: 0.9 },

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
  /** Tempo advertised in the name, spelled out or as a bare number. */
  tempoBpm: number | null
  /** One hit or a bar of music. Independent of `type` — a loop can also be a kick. */
  form: SampleForm | null
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
  form: null,
  note: null,
  variant: null,
}

/** Plausible musical tempos. Narrower than the transport's range, on purpose — see below. */
const MIN_TEMPO = 60
const MAX_TEMPO = 200

/**
 * A tempo the name is advertising, either spelled out (`128bpm`) or as a bare number.
 *
 * The bare-number case is worth the risk because it is how most libraries do it, and
 * profiling a held-out library put the risk at close to nothing: a standalone 60–200
 * number appeared in 229 loop files and 22 one-shots. The collision to worry about is
 * drum-machine names, and they all sit outside the range — 505, 606, 626, 707, 727, 808,
 * 909 — while machine names that *are* inside it (Juno-106, SH-101) arrive glued to
 * letters and never tokenise as a bare number.
 */
function readTempo(tokens: readonly string[], lower: string): number | null {
  const spelled = /\b(\d{2,3})\s*bpm\b/.exec(lower)
  if (spelled) {
    const bpm = Number(spelled[1])
    if (bpm >= 40 && bpm <= 300) return bpm
  }
  for (const token of tokens) {
    if (!/^\d{2,3}$/.test(token)) continue
    const bpm = Number(token)
    if (bpm >= MIN_TEMPO && bpm <= MAX_TEMPO) return bpm
  }
  return null
}

/** Tokens that say outright which of the two forms this is. */
const LOOP_WORDS = new Set(['loop', 'loops', 'break', 'breaks', 'breakbeat', 'groove', 'grooves'])
const ONE_SHOT_WORDS = new Set(['oneshot', 'oneshots', 'shot', 'hit', 'hits', 'single'])

/**
 * One hit or a bar of music.
 *
 * Explicit words win over an inferred tempo, because a pack that says `one_shot` and also
 * carries a number is telling you the number is not a tempo. `one_shot` tokenises to
 * `one` + `shot`, so `shot` is what is actually matched.
 */
function readForm(tokens: readonly string[], tempo: number | null): SampleForm | null {
  for (const token of tokens) if (LOOP_WORDS.has(token)) return 'loop'
  for (const token of tokens) if (ONE_SHOT_WORDS.has(token)) return 'oneShot'
  return tempo === null ? null : 'loop'
}

/**
 * A pitch, when the name is unambiguous about it.
 *
 * Two shapes qualify, and a bare letter is neither. `C2` is safe because of the octave;
 * `F#` is safe because of the accidental — nothing else in a filename looks like that.
 * A lone `D`, as in `4 PHa_D take1.wav`, means nothing and is never read as a note.
 *
 * A flat is only accepted alongside an octave. `Eb2` is a note, but a bare `eb` is far
 * more likely to be the tail of a word than E-flat.
 */
function readNote(raw: string): string | null {
  // `_` counts as a word character, so `\b` would never fire inside `High_F#` or
  // `Needle_D#`. Separators become spaces first; `#` is kept because it is part of a note.
  const lower = raw.replace(/[^a-z0-9#]+/gi, ' ').toLowerCase()
  const withOctave = /\b([a-g])(#|b)?(-1|[0-8])\b/.exec(lower)
  if (withOctave) {
    const [, letter, accidental, octave] = withOctave
    return `${letter!.toUpperCase()}${accidental ?? ''}${octave}`
  }
  const sharp = /\b([a-g])#/.exec(lower)
  return sharp ? `${sharp[1]!.toUpperCase()}#` : null
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

  // Read regardless of whether an instrument was found: a file can be recognisably a loop
  // while saying nothing about what is in it.
  const tempoBpm = readTempo(tokens, lower)
  const rest = {
    openness,
    register,
    tempoBpm,
    form: readForm(tokens, tempoBpm),
    note: readNote(lower),
    variant: readVariant(lower),
  }

  if (!winner) return { ...EMPTY, ...rest }

  const confidence = Math.max(
    0.1,
    Number((winner.entry.weight - (conflicted ? CONFLICT_PENALTY : 0)).toFixed(2)),
  )

  return {
    ...rest,
    type: winner.entry.type,
    confidence,
    evidence: winner.token,
    // Only meaningful where a sample can be choked; on a pad it is noise.
    openness: winner.entry.type === 'hat' || winner.entry.type === 'cymbal' ? openness : null,
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
