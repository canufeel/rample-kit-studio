/**
 * A radix-2 FFT, and the magnitude spectrum built on it.
 *
 * Hand-written rather than pulled in. The feature set below needs exactly one transform
 * and four statistics over it, and a general-purpose DSP library would arrive with a
 * frame-oriented API, its own opinions about buffer sizes, and units to convert out of —
 * for more code than this file, on a static site where every kilobyte is downloaded before
 * anything plays. It is also small enough to check against a direct DFT, which the tests do.
 */

/** Largest power of two that is not greater than `n`. */
export function floorPow2(n: number): number {
  if (n < 1) return 0
  return 2 ** Math.floor(Math.log2(n))
}

export function isPow2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0
}

/**
 * In-place iterative Cooley–Tukey. `re` and `im` are both modified.
 *
 * Length must be a power of two — callers frame the signal, so they choose it.
 */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length
  if (n !== im.length) throw new Error('fft: re and im must be the same length')
  if (!isPow2(n)) throw new Error(`fft: length must be a power of two, got ${n}`)
  if (n === 1) return

  // Bit-reversal permutation, so the butterflies below can run in place.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j]!, re[i]!]
      ;[im[i], im[j]] = [im[j]!, im[i]!]
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len
    const wRe = Math.cos(angle)
    const wIm = Math.sin(angle)
    for (let i = 0; i < n; i += len) {
      // Recurrence rather than a cos/sin per butterfly. The drift over a 1024-point
      // transform is far below what any of these features can resolve.
      let curRe = 1
      let curIm = 0
      for (let k = 0; k < len / 2; k++) {
        const aRe = re[i + k]!
        const aIm = im[i + k]!
        const bRe = re[i + k + len / 2]!
        const bIm = im[i + k + len / 2]!

        const tRe = bRe * curRe - bIm * curIm
        const tIm = bRe * curIm + bIm * curRe

        re[i + k] = aRe + tRe
        im[i + k] = aIm + tIm
        re[i + k + len / 2] = aRe - tRe
        im[i + k + len / 2] = aIm - tIm

        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
}

/**
 * A periodic Hann window of the given size.
 *
 * Periodic (`/ n`) rather than symmetric (`/ (n - 1)`) because these frames are analysed,
 * not resynthesised, and the periodic form is the one that makes a bin-centred sinusoid
 * land in a single bin.
 */
export function hann(n: number): Float32Array {
  const w = new Float32Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / n))
  return w
}

/**
 * Power spectrum of one windowed frame: `|X(k)|²` for bins 0..n/2 inclusive.
 *
 * Power rather than magnitude because everything downstream sums energy, and squaring
 * once here is cheaper and better conditioned than squaring at each use.
 */
export function powerSpectrum(frame: Float32Array, window: Float32Array): Float32Array {
  const n = frame.length
  const re = new Float32Array(n)
  const im = new Float32Array(n)
  for (let i = 0; i < n; i++) re[i] = frame[i]! * window[i]!

  fft(re, im)

  const bins = n / 2 + 1
  const power = new Float32Array(bins)
  for (let k = 0; k < bins; k++) power[k] = re[k]! * re[k]! + im[k]! * im[k]!
  return power
}

/** Centre frequency of bin `k` for an `n`-point transform at `sampleRate`. */
export function binFrequency(k: number, n: number, sampleRate: number): number {
  return (k * sampleRate) / n
}
