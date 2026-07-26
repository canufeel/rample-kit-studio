import { describe, expect, test } from 'bun:test'
import { binFrequency, fft, floorPow2, hann, isPow2, powerSpectrum } from './fft'

/** Direct O(n²) DFT — the reference the fast one is checked against. */
function dft(re: readonly number[]): { re: number[]; im: number[] } {
  const n = re.length
  const outRe = new Array<number>(n).fill(0)
  const outIm = new Array<number>(n).fill(0)
  for (let k = 0; k < n; k++) {
    for (let t = 0; t < n; t++) {
      const angle = (-2 * Math.PI * k * t) / n
      outRe[k]! += re[t]! * Math.cos(angle)
      outIm[k]! += re[t]! * Math.sin(angle)
    }
  }
  return { re: outRe, im: outIm }
}

describe('powers of two', () => {
  test('isPow2', () => {
    for (const n of [1, 2, 4, 1024]) expect(isPow2(n)).toBe(true)
    for (const n of [0, 3, 5, 1000, -4]) expect(isPow2(n)).toBe(false)
  })

  test('floorPow2', () => {
    expect(floorPow2(1)).toBe(1)
    expect(floorPow2(1023)).toBe(512)
    expect(floorPow2(1024)).toBe(1024)
    expect(floorPow2(0)).toBe(0)
  })
})

describe('fft against a direct DFT', () => {
  test('matches on random input', () => {
    const n = 64
    // Fixed seed by construction, so a failure is reproducible.
    const input = Array.from({ length: n }, (_, i) => Math.sin(i * 1.7) + 0.3 * Math.cos(i * 0.31))
    const expected = dft(input)

    const re = Float32Array.from(input)
    const im = new Float32Array(n)
    fft(re, im)

    for (let k = 0; k < n; k++) {
      expect(re[k]!).toBeCloseTo(expected.re[k]!, 3)
      expect(im[k]!).toBeCloseTo(expected.im[k]!, 3)
    }
  })

  test('a constant signal puts all energy in bin zero', () => {
    const n = 32
    const re = new Float32Array(n).fill(1)
    const im = new Float32Array(n)
    fft(re, im)

    expect(re[0]!).toBeCloseTo(n, 4)
    for (let k = 1; k < n; k++) expect(Math.hypot(re[k]!, im[k]!)).toBeCloseTo(0, 3)
  })

  test('a bin-centred sinusoid lands in exactly that bin', () => {
    const n = 64
    const k0 = 7
    const re = new Float32Array(n)
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * k0 * i) / n)
    const im = new Float32Array(n)
    fft(re, im)

    const mags = Array.from({ length: n / 2 + 1 }, (_, k) => Math.hypot(re[k]!, im[k]!))
    const peak = mags.indexOf(Math.max(...mags))
    expect(peak).toBe(k0)
  })

  test('length one is a no-op rather than an error', () => {
    const re = Float32Array.from([3])
    const im = new Float32Array(1)
    expect(() => fft(re, im)).not.toThrow()
    expect(re[0]).toBe(3)
  })

  test('a non-power-of-two length is refused rather than silently wrong', () => {
    expect(() => fft(new Float32Array(6), new Float32Array(6))).toThrow(/power of two/)
  })

  test('mismatched lengths are refused', () => {
    expect(() => fft(new Float32Array(8), new Float32Array(4))).toThrow(/same length/)
  })
})

describe('hann window', () => {
  test('starts at zero and peaks in the middle', () => {
    const w = hann(8)
    expect(w[0]!).toBeCloseTo(0, 6)
    expect(w[4]!).toBeCloseTo(1, 6)
  })

  test('is periodic, not symmetric', () => {
    // The periodic form never repeats its zero at the end — that is what keeps a
    // bin-centred sinusoid in one bin.
    const w = hann(8)
    expect(w[7]!).toBeGreaterThan(0)
  })
})

describe('power spectrum', () => {
  test('returns n/2 + 1 bins', () => {
    const n = 256
    expect(powerSpectrum(new Float32Array(n), hann(n)).length).toBe(n / 2 + 1)
  })

  test('peaks at the bin holding the tone', () => {
    const n = 1024
    const rate = 44100
    const freq = 1000
    const frame = new Float32Array(n)
    for (let i = 0; i < n; i++) frame[i] = Math.sin((2 * Math.PI * freq * i) / rate)

    const power = powerSpectrum(frame, hann(n))
    let peak = 0
    for (let k = 1; k < power.length; k++) if (power[k]! > power[peak]!) peak = k

    expect(binFrequency(peak, n, rate)).toBeCloseTo(freq, -2)
  })

  test('silence has no energy', () => {
    const power = powerSpectrum(new Float32Array(128), hann(128))
    expect(power.every((v) => v === 0)).toBe(true)
  })
})
