import type { AudioFeatures } from './features'

/**
 * What the audio says a sample is — at the resolution the audio can actually support.
 *
 * This deliberately does **not** return a `SampleType`. Profiling a 2,373-file factory
 * card against its own filenames showed a fine-grained classifier topping out around 69%
 * precision even after tightening it to half coverage, and the errors were not tuning
 * problems:
 *
 * - **Kick and tom do not separate.** Centroid medians of 100 Hz and 143 Hz, both
 *   overwhelmingly low-band, decay ranges that overlap heavily. Nothing measured here
 *   tells them apart.
 * - **`fx`, `loop` and `perc` are not acoustic categories.** They describe a sample's job,
 *   not its sound. A bright noisy FX hit is acoustically a hi-hat, and always will be, so
 *   every fine classifier will "misread" it forever.
 *
 * Families are the honest resolution. They are what the measurements genuinely separate,
 * they are enough to drive the character line and the drop-target suggestion, and at this
 * grain a disagreement with the filename is real signal rather than noise. Naming the
 * exact instrument is left to the filename, which usually knows, and to the optional model
 * tier, which was always the plan for the half of a library that filenames cannot answer.
 */

export type AcousticFamily =
  /** Kick, tom, low percussion, bass — energy overwhelmingly below 250 Hz. */
  | 'low'
  /** Hats, cymbals, bright noise — most energy above 4 kHz. */
  | 'bright'
  /** Snares, claps, mid percussion — the presence band, with little bottom. */
  | 'body'
  /** Sustained and periodic enough to carry a note. */
  | 'tonal'
  | 'unknown'

export const FAMILY_NAME: Record<AcousticFamily, string> = {
  low: 'low drum',
  bright: 'bright',
  body: 'body',
  tonal: 'tonal',
  unknown: 'unclear',
}

export interface AudioVerdict {
  family: AcousticFamily
  /** 0..1. Comparable across families, so a caller can threshold on it. */
  confidence: number
}

const NOTHING: AudioVerdict = { family: 'unknown', confidence: 0 }

/** Pitch is only believed above this; below it, "unpitched" is the honest reading. */
export const PITCH_TRUSTED = 0.9

export function classify(f: AudioFeatures): AudioVerdict {
  if (f.silent) return NOTHING

  const low = f.bands.sub + f.bands.low
  const pitched = f.pitchHz !== null && f.pitchConfidence > PITCH_TRUSTED

  // Low first: it is the least ambiguous reading in the set, and a low sample with a
  // pitch is still a low sample.
  if (low > 0.8 && f.centroid < 300) {
    return { family: 'low', confidence: low > 0.9 ? 0.85 : 0.7 }
  }

  if (f.bands.high > 0.45 && f.centroid > 3000) {
    return { family: 'bright', confidence: f.bands.high > 0.6 ? 0.85 : 0.7 }
  }

  // A ringing cymbal is not as top-heavy as a hi-hat — its energy spreads down into the
  // mids — so the threshold above misses it and it would fall through to `body`. What
  // separates it from a snare is that it is still going a second later.
  if (f.decay > 0.9 && f.bands.high > 0.12 && low < 0.05 && f.centroid > 1800) {
    return { family: 'bright', confidence: 0.7 }
  }

  // Sustained and periodic. Checked before `body` because a held note in the presence
  // band is a tonal sample, not a snare.
  if (pitched && f.decay > 0.6) {
    return { family: 'tonal', confidence: 0.7 }
  }

  // Body is the narrowest rule rather than the widest, despite being the catch-all shape:
  // as an open-ended "mid-ish" test it swallowed every ringing cymbal and sustained pad
  // that the rules above declined. Requiring the sample to actually stop is what makes it
  // mean "snare or clap" rather than "not yet classified".
  if (f.centroid > 600 && f.centroid < 4000 && low < 0.5 && f.decay < 0.8) {
    return { family: 'body', confidence: 0.65 }
  }

  return NOTHING
}
