/**
 * What the app believes a sample *is*, and where that belief came from.
 *
 * Three tiers produce these, in increasing cost: the filename (free, no download), the
 * audio itself (cheap DSP in a worker), and an optional downloaded model. Every tag
 * records its `source` so the UI can say why it thinks what it thinks, and so a cheaper
 * tier never silently overwrites a more reliable one.
 */

/**
 * The instrument families worth distinguishing on this device.
 *
 * Deliberately coarse. A kit has four voices and twelve layers each; splitting "conga"
 * from "bongo" would add taxonomy the UI has no room to show and the user has no decision
 * to make about. The line is drawn where it changes what you'd do: a kick and a tom go on
 * different voices, two flavours of shaker do not.
 */
export type SampleType =
  | 'kick'
  | 'snare'
  | 'clap'
  | 'hat'
  | 'cymbal'
  | 'tom'
  | 'rim'
  | 'perc'
  | 'bass'
  | 'tonal'
  | 'chord'
  | 'vocal'
  | 'fx'
  | 'unknown'

/**
 * Whether a sample is a single hit or a bar of music — a separate question from what
 * instrument it is, and one this device cares about a great deal.
 *
 * These were one field until a held-out library showed why they cannot be. A file named
 * `nn_drum_120_bay_kick.wav` is a kick *and* a loop; forced to choose, the tagger answered
 * "kick" and scored as wrong against a `loops/` folder, dragging precision from 99% to 78%
 * on its own. Both answers were right, about different things.
 *
 * It matters on the hardware too: a loop occupies a whole voice and gets triggered once a
 * bar, where a one-shot is layered a dozen deep and triggered constantly.
 */
export type SampleForm = 'oneShot' | 'loop'

/** Short label for the row badge. Kept to four characters so the column never shifts. */
export const TYPE_LABEL: Record<SampleType, string> = {
  kick: 'KICK',
  snare: 'SNR',
  clap: 'CLAP',
  hat: 'HAT',
  cymbal: 'CYM',
  tom: 'TOM',
  rim: 'RIM',
  perc: 'PERC',
  bass: 'BASS',
  tonal: 'TONE',
  chord: 'CHRD',
  vocal: 'VOX',
  fx: 'FX',
  unknown: '—',
}

/** Long form, for tooltips and the filter menu. */
export const TYPE_NAME: Record<SampleType, string> = {
  kick: 'Kick',
  snare: 'Snare',
  clap: 'Clap',
  hat: 'Hi-hat',
  cymbal: 'Cymbal',
  tom: 'Tom',
  rim: 'Rim',
  perc: 'Percussion',
  bass: 'Bass',
  tonal: 'Tonal',
  chord: 'Chord',
  vocal: 'Vocal',
  fx: 'FX',
  unknown: 'Unidentified',
}

/**
 * Display order for grouped views. Roughly the order a kit gets built in — the drum core
 * first, then colour, then tonal material — rather than alphabetical, which would put
 * "bass" before "kick" for no reason a musician would recognise.
 */
export const TYPE_ORDER: readonly SampleType[] = [
  'kick',
  'snare',
  'clap',
  'hat',
  'cymbal',
  'tom',
  'rim',
  'perc',
  'bass',
  'tonal',
  'chord',
  'vocal',
  'fx',
  'unknown',
]

/**
 * Where a tag came from. Ranked: a later source may overwrite an earlier one, never the
 * reverse. `user` is final — an explicit correction is never revised by an analysis pass.
 */
export type TagSource = 'filename' | 'dsp' | 'model' | 'user'

export const SOURCE_RANK: Record<TagSource, number> = {
  filename: 0,
  dsp: 1,
  model: 2,
  user: 3,
}

/** Whether a hat (or any decaying sample) rings on or is choked. */
export type Openness = 'open' | 'closed'

/** Where in the range a drum sits — the low/mid/high of a tom or conga set. */
export type Register = 'low' | 'mid' | 'high'
