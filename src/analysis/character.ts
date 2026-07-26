import { noteFromHz } from './features'
import type { AudioFeatures } from './features'
import { PITCH_TRUSTED } from './classify'

/**
 * The measurements, in words.
 *
 * Every threshold here is a presentation choice, not a fact, which is exactly why they
 * live apart from `features.ts`: retuning "where does bright start" must never mean
 * re-analysing anyone's library.
 *
 * The vocabulary is kept small and each axis contributes at most one word, so the line
 * stays readable next to a filename. Where a sample is unremarkable on an axis, that axis
 * says nothing at all — "medium brightness, medium length" is noise, and a line that is
 * always four words long stops being read.
 */

/** Centroid boundaries, in Hz. Sited between the measured medians of the families. */
const DARK_BELOW = 300
const WARM_BELOW = 1500
const BRIGHT_BELOW = 4000

/** Flatness. Only the ends are worth naming; the middle is unremarkable. */
const TONAL_BELOW = 0.05
const NOISY_ABOVE = 0.18

/**
 * Decay, in seconds.
 *
 * Sited between the measured clusters rather than on round numbers. `LONG_BELOW` was 1.5
 * first, which fell exactly on the cymbal median of 1.518 — half of all cymbals would have
 * read "long" and half "sustained" for a difference nobody can hear. A boundary on top of
 * a cluster is a coin toss dressed as a measurement.
 */
const TIGHT_BELOW = 0.15
const SHORT_BELOW = 0.5
const LONG_BELOW = 2.5

/** An attack this slow is audible as a swell rather than a hit. */
const SWELL_ABOVE = 0.05

export interface Character {
  brightness: 'dark' | 'warm' | 'bright' | 'crisp'
  texture: 'tonal' | 'noisy' | null
  length: 'tight' | 'short' | 'long' | 'sustained'
  /** Only set when the attack is slow enough to hear as one. */
  swell: boolean
  /** Scientific pitch notation, when the sample is periodic enough to have a note. */
  note: string | null
}

export function characterOf(f: AudioFeatures): Character | null {
  if (f.silent) return null

  const brightness =
    f.centroid < DARK_BELOW
      ? 'dark'
      : f.centroid < WARM_BELOW
        ? 'warm'
        : f.centroid < BRIGHT_BELOW
          ? 'bright'
          : 'crisp'

  const texture = f.flatness < TONAL_BELOW ? 'tonal' : f.flatness > NOISY_ABOVE ? 'noisy' : null

  const length =
    f.decay < TIGHT_BELOW
      ? 'tight'
      : f.decay < SHORT_BELOW
        ? 'short'
        : f.decay < LONG_BELOW
          ? 'long'
          : 'sustained'

  return {
    brightness,
    texture,
    length,
    swell: f.attack > SWELL_ABOVE,
    // A note is only claimed when the detector was sure. On percussion the honest answer
    // is no note, and printing one on a hi-hat would discredit the whole readout.
    note: f.pitchHz !== null && f.pitchConfidence > PITCH_TRUSTED ? noteFromHz(f.pitchHz) : null,
  }
}

/** The character as a short list of words, for the row's metadata line. */
export function characterWords(character: Character | null): string[] {
  if (!character) return []
  return [
    character.brightness,
    character.texture,
    character.length,
    character.swell ? 'swell' : null,
  ].filter((word): word is string => word !== null)
}
