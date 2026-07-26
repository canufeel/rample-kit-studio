import { describe, expect, test } from 'bun:test'
import {
  centsOffset,
  detectPitch,
  extractFeatures,
  midiFromHz,
  noteFromHz,
} from './features'

const RATE = 44100

// ── Signal generators, so every expectation has a known right answer ────────────

function sine(hz: number, seconds: number, amplitude = 0.8): Float32Array {
  const out = new Float32Array(Math.floor(seconds * RATE))
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / RATE)
  return out
}

function saw(hz: number, seconds: number, amplitude = 0.8): Float32Array {
  const out = new Float32Array(Math.floor(seconds * RATE))
  const period = RATE / hz
  for (let i = 0; i < out.length; i++) out[i] = amplitude * (2 * ((i % period) / period) - 1)
  return out
}

/** Deterministic pseudo-noise, so a failure is always reproducible. */
function noise(seconds: number, amplitude = 0.8): Float32Array {
  const out = new Float32Array(Math.floor(seconds * RATE))
  let seed = 12345
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    out[i] = amplitude * (seed / 0x3fffffff - 1)
  }
  return out
}

/** Apply an exponential decay, turning a tone into something shaped like a drum hit. */
function decayed(signal: Float32Array, tau: number): Float32Array {
  const out = new Float32Array(signal.length)
  for (let i = 0; i < signal.length; i++) out[i] = signal[i]! * Math.exp(-i / RATE / tau)
  return out
}

// ── Pitch ───────────────────────────────────────────────────────────────────────

describe('pitch detection', () => {
  test('finds the fundamental of a sine', () => {
    for (const hz of [110, 220, 440, 880]) {
      const found = detectPitch(sine(hz, 0.2), RATE)
      expect(found.hz).toBeCloseTo(hz, 0)
      expect(found.confidence).toBeGreaterThan(0.8)
    }
  })

  test('finds the fundamental of a harmonically rich tone, not a harmonic of it', () => {
    // The octave error is the classic YIN failure; the first qualifying dip is what
    // avoids it, and this is the test that would catch a regression to the global minimum.
    const found = detectPitch(saw(147, 0.2), RATE)
    expect(found.hz).toBeCloseTo(147, -1)
  })

  test('interpolation beats whole-sample quantisation', () => {
    // 443 Hz is between two integer periods at 44.1 kHz: 99 samples is 445.5 Hz and 100
    // is 441 Hz, so only interpolation can land near the true value.
    const found = detectPitch(sine(443, 0.2), RATE)
    expect(Math.abs(found.hz! - 443)).toBeLessThan(1)
  })

  test('reports no pitch for noise', () => {
    const found = detectPitch(noise(0.2), RATE)
    expect(found.hz).toBeNull()
  })

  test('reports no pitch for silence', () => {
    expect(detectPitch(new Float32Array(4410), RATE).hz).toBeNull()
  })

  test('a buffer too short to hold a period is declined, not guessed at', () => {
    expect(detectPitch(new Float32Array(16), RATE).hz).toBeNull()
  })
})

describe('notes', () => {
  test('A4 is 440', () => {
    expect(midiFromHz(440)).toBe(69)
    expect(noteFromHz(440)).toBe('A4')
  })

  test('octaves and accidentals', () => {
    expect(noteFromHz(261.63)).toBe('C4')
    expect(noteFromHz(130.81)).toBe('C3')
    expect(noteFromHz(2093)).toBe('C7')
    expect(noteFromHz(466.16)).toBe('A#4')
  })

  test('cents offset is signed and near zero when in tune', () => {
    expect(centsOffset(440)).toBe(0)
    expect(centsOffset(444)).toBeGreaterThan(10)
    expect(centsOffset(436)).toBeLessThan(-10)
  })
})

// ── Spectral ────────────────────────────────────────────────────────────────────

describe('spectral measures', () => {
  test('centroid tracks the tone', () => {
    const low = extractFeatures(sine(200, 0.3), RATE)
    const high = extractFeatures(sine(5000, 0.3), RATE)
    expect(low.centroid).toBeCloseTo(200, -2)
    expect(high.centroid).toBeCloseTo(5000, -3)
    expect(high.centroid).toBeGreaterThan(low.centroid)
  })

  test('flatness separates a tone from noise', () => {
    // The single most load-bearing feature: it is what tells a hi-hat from a bass note
    // when both are short.
    expect(extractFeatures(sine(440, 0.3), RATE).flatness).toBeLessThan(0.05)
    expect(extractFeatures(noise(0.3), RATE).flatness).toBeGreaterThan(0.3)
  })

  test('rolloff sits above the tone and below Nyquist', () => {
    const f = extractFeatures(sine(1000, 0.3), RATE)
    expect(f.rolloff).toBeGreaterThanOrEqual(900)
    expect(f.rolloff).toBeLessThan(RATE / 2)
  })

  test('zero-crossing rate is roughly twice the frequency of a sine', () => {
    const f = extractFeatures(sine(500, 0.5), RATE)
    expect(f.zcr).toBeGreaterThan(900)
    expect(f.zcr).toBeLessThan(1100)
  })

  test('bands sum to one', () => {
    const f = extractFeatures(sine(50, 0.3), RATE)
    const total = f.bands.sub + f.bands.low + f.bands.lowMid + f.bands.mid + f.bands.high
    expect(total).toBeCloseTo(1, 3)
  })

  test('a low tone lands in the bottom two bands', () => {
    // Not in `sub` alone: bins are 43 Hz apart at this frame size, so a 50 Hz tone
    // straddles the 60 Hz boundary. The band edges are softer than they look, which is
    // why the classifier reads sub+low together rather than either on its own.
    const f = extractFeatures(sine(50, 0.3), RATE)
    expect(f.bands.sub + f.bands.low).toBeGreaterThan(0.95)
    expect(f.bands.sub).toBeGreaterThan(f.bands.lowMid)
  })

  test('a bright tone lands in the high band', () => {
    expect(extractFeatures(sine(9000, 0.3), RATE).bands.high).toBeGreaterThan(0.8)
  })
})

// ── Envelope ────────────────────────────────────────────────────────────────────

describe('envelope', () => {
  test('a percussive hit has a near-zero attack', () => {
    expect(extractFeatures(decayed(sine(220, 0.5), 0.05), RATE).attack).toBeLessThan(0.01)
  })

  test('decay time tracks the decay constant', () => {
    const fast = extractFeatures(decayed(sine(220, 1), 0.02), RATE)
    const slow = extractFeatures(decayed(sine(220, 1), 0.3), RATE)
    expect(slow.decay).toBeGreaterThan(fast.decay * 3)
  })

  test('a sustained tone is not mistaken for a decaying one', () => {
    // A steady sine never falls 40 dB, so decay runs to the end of the sample.
    const f = extractFeatures(sine(220, 0.5), RATE)
    expect(f.decay).toBeGreaterThan(0.4)
  })

  test('crest factor separates a transient from a steady tone', () => {
    const steady = extractFeatures(sine(220, 0.5), RATE)
    const hit = extractFeatures(decayed(sine(220, 0.5), 0.01), RATE)
    expect(hit.crest).toBeGreaterThan(steady.crest * 2)
  })

  test('a sine has the crest factor of a sine', () => {
    // peak/rms of a full sine is sqrt(2). A wrong RMS would show up here first.
    expect(extractFeatures(sine(440, 0.3), RATE).crest).toBeCloseTo(Math.SQRT2, 1)
  })
})

// ── Edges ───────────────────────────────────────────────────────────────────────

describe('edge cases', () => {
  test('silence is reported as silent rather than as a spectrum of zeroes', () => {
    const f = extractFeatures(new Float32Array(4410), RATE)
    expect(f.silent).toBe(true)
    expect(f.centroid).toBe(0)
    expect(f.pitchHz).toBeNull()
  })

  test('an empty buffer does not throw', () => {
    expect(() => extractFeatures(new Float32Array(0), RATE)).not.toThrow()
    expect(extractFeatures(new Float32Array(0), RATE).silent).toBe(true)
  })

  test('a sample shorter than one frame is still analysed', () => {
    // 200 samples is under 5 ms — real one-shot clicks are this short.
    const f = extractFeatures(sine(1000, 200 / RATE), RATE)
    expect(f.silent).toBe(false)
    expect(f.centroid).toBeGreaterThan(0)
  })

  test('DC offset does not become brightness', () => {
    // Bin 0 is excluded on purpose; a file with an offset would otherwise read as having
    // enormous low-frequency energy.
    const withOffset = sine(1000, 0.3)
    for (let i = 0; i < withOffset.length; i++) withOffset[i]! += 0.15
    const f = extractFeatures(withOffset, RATE)
    expect(f.centroid).toBeCloseTo(1000, -2)
  })

  test('a very long sample is capped rather than analysed in full', () => {
    const f = extractFeatures(sine(440, 45), RATE)
    expect(f.duration).toBeLessThanOrEqual(30)
  })

  test('the version is stamped so a cache can tell when to recompute', () => {
    expect(extractFeatures(sine(440, 0.1), RATE).version).toBeGreaterThan(0)
  })
})
