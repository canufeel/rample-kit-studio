import { binFrequency, hann, powerSpectrum } from './fft'

/**
 * What the audio itself says about a sample.
 *
 * Everything here is a measurement, not a judgement. "Bright" and "punchy" are decided in
 * `character.ts` by putting thresholds on these numbers; keeping the two apart means the
 * thresholds can be argued about and retuned without re-analysing anybody's library.
 */

/**
 * Bumped whenever a stored value would come out different for the same audio. Cached
 * results carrying an older version are discarded and recomputed rather than trusted.
 */
export const FEATURES_VERSION = 1

/** Frame size at 44.1 kHz ≈ 23 ms: long enough to resolve a kick's fundamental. */
const FRAME = 1024
const HOP = 512

/** Envelope resolution, ≈ 1.5 ms at 44.1 kHz. Attack times are short. */
const ENVELOPE_HOP = 64

/** Beyond this, a sample is a loop and the tail adds nothing to its character. */
const MAX_ANALYSIS_SECONDS = 30

/** Below this the sample is treated as silent, and most features are meaningless. */
const SILENCE_RMS = 1e-5

/**
 * How much audio the pitch detector sees.
 *
 * YIN costs O(maxTau × N), and maxTau is a full period of the lowest pitch we look for —
 * 1102 samples at 40 Hz. Run over a whole file that is tens of millions of operations per
 * sample, which a card import of two thousand files cannot afford. A window is not a
 * compromise either: 4096 samples is nearly four periods at the very bottom of the range
 * and hundreds in the middle, which is all the algorithm needs. Pitch does not change
 * within a one-shot.
 */
const PITCH_WINDOW = 4096

/** Fraction of total energy defining the rolloff point. */
const ROLLOFF_FRACTION = 0.85

/**
 * Band over which spectral flatness is measured.
 *
 * Flatness is a geometric mean over an arithmetic one, so near-empty bins dominate it.
 * Measured across the full spectrum, every real recording scores as tonal: most 16-bit
 * material is rolled off above 15 kHz, and a few hundred near-silent bins drag the
 * geometric mean to nothing. Profiling the factory card that way put hi-hats — which are
 * mostly noise — at a median of 0.05, indistinguishable from a sine.
 *
 * Restricting the measurement to where music actually has content restores the
 * discrimination the statistic is supposed to provide.
 */
const FLATNESS_LO_HZ = 50
const FLATNESS_HI_HZ = 12000

/** Decay is measured to this many dB below the envelope peak. */
const DECAY_DB = -40

/**
 * Share of energy per frequency band.
 *
 * The edges are softer than the numbers suggest: at a 1024-point frame and 44.1 kHz the
 * bins are 43 Hz apart, so a 50 Hz tone spills across the 60 Hz boundary into `low`.
 * Anything reading these should treat adjacent bands together rather than trusting one
 * alone — which is why the classifier tests `sub + low` rather than `sub`.
 */
export interface Bands {
  /** 20–60 Hz. Where a kick's weight lives. */
  sub: number
  /** 60–250 Hz. Body. */
  low: number
  /** 250–800 Hz. */
  lowMid: number
  /** 800–4 kHz. Presence; where a snare's crack sits. */
  mid: number
  /** 4 kHz and up. Air, and where hats live almost entirely. */
  high: number
}

export interface AudioFeatures {
  version: number
  /** Seconds of audio actually analysed, which is capped. */
  duration: number
  /** Largest absolute sample, 0..1. */
  peak: number
  /** Root mean square over the whole sample, 0..1. */
  rms: number
  /** peak / rms. High means transient, low means sustained or compressed. */
  crest: number
  /** Seconds from the start to the envelope peak. */
  attack: number
  /** Seconds from the envelope peak down to −40 dB, or the remaining length if it never gets there. */
  decay: number
  /** Spectral centroid in Hz — the centre of mass of the spectrum, i.e. brightness. */
  centroid: number
  /** Hz below which 85% of the energy lies. */
  rolloff: number
  /** Spectral flatness, 0..1. Near 1 is noise, near 0 is a clean tone. */
  flatness: number
  /** Zero crossings per second. Cheap corroboration of noisiness. */
  zcr: number
  /** Share of total energy per band; sums to 1 for a non-silent sample. */
  bands: Bands
  /** Detected fundamental in Hz, or null when nothing periodic was found. */
  pitchHz: number | null
  /** 0..1 — how periodic the signal is where the pitch was found. */
  pitchConfidence: number
  /** True when the sample is silent, in which case every field above is zero. */
  silent: boolean
}

const SILENT: AudioFeatures = {
  version: FEATURES_VERSION,
  duration: 0,
  peak: 0,
  rms: 0,
  crest: 0,
  attack: 0,
  decay: 0,
  centroid: 0,
  rolloff: 0,
  flatness: 0,
  zcr: 0,
  bands: { sub: 0, low: 0, lowMid: 0, mid: 0, high: 0 },
  pitchHz: null,
  pitchConfidence: 0,
  silent: true,
}

// ── Envelope ────────────────────────────────────────────────────────────────────

/** Peak-absolute envelope, one value per `ENVELOPE_HOP` samples. */
function envelope(samples: Float32Array): Float32Array {
  const steps = Math.max(1, Math.ceil(samples.length / ENVELOPE_HOP))
  const env = new Float32Array(steps)
  for (let s = 0; s < steps; s++) {
    const start = s * ENVELOPE_HOP
    const end = Math.min(samples.length, start + ENVELOPE_HOP)
    let max = 0
    for (let i = start; i < end; i++) {
      const v = Math.abs(samples[i]!)
      if (v > max) max = v
    }
    env[s] = max
  }
  return env
}

// ── Pitch ───────────────────────────────────────────────────────────────────────

/** Lowest and highest fundamentals worth looking for. Below 40 Hz is a rumble, not a note. */
const MIN_PITCH_HZ = 40
const MAX_PITCH_HZ = 2000

/**
 * The YIN threshold. A dip in the normalised difference below this counts as periodic;
 * the paper suggests 0.1–0.15, and the looser end catches real instrument samples that a
 * strict threshold rejects.
 */
const YIN_THRESHOLD = 0.15

/**
 * Fundamental frequency by the YIN method, with the periodicity it was found at.
 *
 * Written out rather than taken from a library specifically for that second return value.
 * The confidence is the point: on percussion the honest answer is "no pitch", and a
 * detector that always returns *a* number would have this app printing notes on hi-hats.
 *
 * Steps follow de Cheveigné & Kawahara (2002): squared difference, cumulative mean
 * normalisation, absolute threshold, then parabolic interpolation of the chosen dip.
 */
export function detectPitch(
  samples: Float32Array,
  sampleRate: number,
): { hz: number | null; confidence: number } {
  const maxTau = Math.min(Math.floor(sampleRate / MIN_PITCH_HZ), Math.floor(samples.length / 2))
  const minTau = Math.max(2, Math.floor(sampleRate / MAX_PITCH_HZ))
  if (maxTau <= minTau) return { hz: null, confidence: 0 }

  // Squared difference function.
  const diff = new Float32Array(maxTau + 1)
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0
    for (let i = 0; i + tau < samples.length; i++) {
      const d = samples[i]! - samples[i + tau]!
      sum += d * d
    }
    diff[tau] = sum
  }

  // Cumulative mean normalisation. Without it the difference function is smallest at
  // tau = 0 and every detector picks that.
  const norm = new Float32Array(maxTau + 1)
  norm[0] = 1
  let running = 0
  for (let tau = 1; tau <= maxTau; tau++) {
    running += diff[tau]!
    norm[tau] = running === 0 ? 1 : (diff[tau]! * tau) / running
  }

  // First dip below the threshold, not the global minimum: the global minimum is often an
  // octave down, and the first qualifying dip is the true period.
  let chosen = -1
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (norm[tau]! < YIN_THRESHOLD) {
      while (tau + 1 <= maxTau && norm[tau + 1]! < norm[tau]!) tau++
      chosen = tau
      break
    }
  }

  if (chosen === -1) {
    // Nothing crossed the threshold. Report the best dip anyway so the caller can see how
    // close it came, but with the low confidence that implies.
    let best = minTau
    for (let tau = minTau; tau <= maxTau; tau++) if (norm[tau]! < norm[best]!) best = tau
    return { hz: null, confidence: Math.max(0, 1 - norm[best]!) }
  }

  // Parabolic interpolation across the dip, so the estimate is not quantised to whole
  // samples — at 44.1 kHz a period of 100 samples is 441 Hz and 99 is 445 Hz.
  const y0 = norm[chosen - 1] ?? norm[chosen]!
  const y1 = norm[chosen]!
  const y2 = norm[chosen + 1] ?? norm[chosen]!
  const denom = 2 * (2 * y1 - y0 - y2)
  const shift = denom === 0 ? 0 : (y2 - y0) / denom
  const period = chosen + shift

  const hz = sampleRate / period
  if (!Number.isFinite(hz) || hz < MIN_PITCH_HZ || hz > MAX_PITCH_HZ) {
    return { hz: null, confidence: 0 }
  }
  return { hz, confidence: Math.max(0, Math.min(1, 1 - y1)) }
}

// ── Notes ───────────────────────────────────────────────────────────────────────

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

/** Nearest MIDI note number to a frequency, A4 = 69 = 440 Hz. */
export function midiFromHz(hz: number): number {
  return Math.round(69 + 12 * Math.log2(hz / 440))
}

/** Scientific pitch notation for a frequency: 440 → "A4". */
export function noteFromHz(hz: number): string {
  const midi = midiFromHz(hz)
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`
}

/** How far off the nearest equal-tempered note this frequency is, in cents. */
export function centsOffset(hz: number): number {
  const midi = 69 + 12 * Math.log2(hz / 440)
  return Math.round((midi - Math.round(midi)) * 100)
}

// ── The extractor ───────────────────────────────────────────────────────────────

/**
 * Measure one sample.
 *
 * `samples` is mono — the caller mixes down, since how to fold a stereo file is a
 * question about the file, not about the measurement.
 */
export function extractFeatures(samples: Float32Array, sampleRate: number): AudioFeatures {
  const limit = Math.min(samples.length, Math.floor(MAX_ANALYSIS_SECONDS * sampleRate))
  const audio = limit < samples.length ? samples.subarray(0, limit) : samples
  if (audio.length === 0) return SILENT

  // Time domain: peak, RMS, zero crossings.
  let peak = 0
  let sumSquares = 0
  let crossings = 0
  let previous = 0
  for (let i = 0; i < audio.length; i++) {
    const v = audio[i]!
    const abs = Math.abs(v)
    if (abs > peak) peak = abs
    sumSquares += v * v
    if ((v >= 0 && previous < 0) || (v < 0 && previous >= 0)) crossings++
    previous = v
  }
  const rms = Math.sqrt(sumSquares / audio.length)
  if (rms < SILENCE_RMS) return { ...SILENT, duration: audio.length / sampleRate }

  const duration = audio.length / sampleRate

  // Envelope: attack to the peak, decay from it.
  const env = envelope(audio)
  let peakStep = 0
  for (let s = 1; s < env.length; s++) if (env[s]! > env[peakStep]!) peakStep = s
  const attack = (peakStep * ENVELOPE_HOP) / sampleRate

  const decayFloor = env[peakStep]! * 10 ** (DECAY_DB / 20)
  let decayStep = env.length - 1
  for (let s = peakStep; s < env.length; s++) {
    if (env[s]! <= decayFloor) {
      decayStep = s
      break
    }
  }
  const decay = Math.max(0, ((decayStep - peakStep) * ENVELOPE_HOP) / sampleRate)

  // Frequency domain: one aggregate power spectrum over the whole sample. Averaging
  // per-frame statistics instead would weight a quiet tail as heavily as the body of the
  // hit; summing power weights each frame by how much sound is actually in it.
  const frameSize = Math.min(FRAME, 2 ** Math.floor(Math.log2(Math.max(2, audio.length))))
  const window = hann(frameSize)
  const bins = frameSize / 2 + 1
  const spectrum = new Float64Array(bins)

  let frames = 0
  for (let start = 0; start + frameSize <= audio.length; start += HOP) {
    const power = powerSpectrum(audio.subarray(start, start + frameSize), window)
    for (let k = 0; k < bins; k++) spectrum[k]! += power[k]!
    frames++
  }
  if (frames === 0) {
    // Shorter than one frame — pad it out rather than reporting no spectrum at all.
    const padded = new Float32Array(frameSize)
    padded.set(audio.subarray(0, Math.min(audio.length, frameSize)))
    const power = powerSpectrum(padded, window)
    for (let k = 0; k < bins; k++) spectrum[k]! += power[k]!
    frames = 1
  }

  // Bin 0 is DC. It carries no pitch or brightness information and any offset in the file
  // lands there, so it is excluded from every spectral statistic below.
  let total = 0
  for (let k = 1; k < bins; k++) total += spectrum[k]!

  let centroid = 0
  let rolloff = 0
  let flatness = 0
  const bands: Bands = { sub: 0, low: 0, lowMid: 0, mid: 0, high: 0 }

  if (total > 0) {
    let weighted = 0
    let logSum = 0
    let logCount = 0
    let flatSum = 0
    let running = 0
    let rolloffFound = false

    // A relative floor, so an empty bin is treated as "far below the average" rather than
    // as an absolute zero whose logarithm swamps every other term.
    const floor = (total / (bins - 1)) * 1e-6

    for (let k = 1; k < bins; k++) {
      const hz = binFrequency(k, frameSize, sampleRate)
      const p = spectrum[k]!
      weighted += hz * p

      if (hz >= FLATNESS_LO_HZ && hz <= FLATNESS_HI_HZ) {
        // Geometric mean via logs — the product itself underflows within a few dozen bins.
        logSum += Math.log(Math.max(p, floor))
        flatSum += p
        logCount++
      }

      running += p
      if (!rolloffFound && running >= total * ROLLOFF_FRACTION) {
        rolloff = hz
        rolloffFound = true
      }

      if (hz < 60) bands.sub += p
      else if (hz < 250) bands.low += p
      else if (hz < 800) bands.lowMid += p
      else if (hz < 4000) bands.mid += p
      else bands.high += p
    }

    centroid = weighted / total
    if (!rolloffFound) rolloff = sampleRate / 2

    if (logCount > 0 && flatSum > 0) {
      const geometric = Math.exp(logSum / logCount)
      const arithmetic = flatSum / logCount
      flatness = Math.min(1, geometric / arithmetic)
    }

    for (const key of Object.keys(bands) as (keyof Bands)[]) bands[key] /= total
  }

  // Measured from the envelope peak, where the tone is loudest and most established. The
  // attack transient before it is inharmonic and would only confuse the estimate.
  const pitchStart = Math.min(peakStep * ENVELOPE_HOP, Math.max(0, audio.length - PITCH_WINDOW))
  const pitch = detectPitch(
    audio.subarray(pitchStart, Math.min(audio.length, pitchStart + PITCH_WINDOW)),
    sampleRate,
  )

  return {
    version: FEATURES_VERSION,
    duration,
    peak,
    rms,
    crest: rms > 0 ? peak / rms : 0,
    attack,
    decay,
    centroid,
    rolloff,
    flatness,
    zcr: crossings / duration,
    bands,
    pitchHz: pitch.hz,
    pitchConfidence: pitch.confidence,
    silent: false,
  }
}
