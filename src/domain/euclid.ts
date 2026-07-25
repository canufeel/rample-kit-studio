/**
 * Euclidean rhythms via Bjorklund's algorithm.
 *
 * Distributes `triggers` hits as evenly as possible across `length` steps — the
 * primitive behind Pamela's PRO Workout and every Euclidean sequencer since Toussaint's
 * paper. E(3,8) is `x..x..x.`, E(5,8) is `x.xx.xx.`.
 *
 * The algorithm repeatedly pairs groups of hits with groups of rests, exactly like
 * Euclid's GCD procedure, until at most one remainder group is left. What survives is
 * the maximally even distribution.
 */

/**
 * Bjorklund proper. Returns `length` booleans with `pulses` of them true.
 *
 * Implemented iteratively rather than recursively so a pathological length can't blow
 * the stack — the recursion depth is bounded by the Euclidean algorithm, but there is
 * no reason to rely on that.
 */
export function bjorklund(length: number, pulses: number): boolean[] {
  if (length <= 0) return []
  if (pulses <= 0) return new Array<boolean>(length).fill(false)
  if (pulses >= length) return new Array<boolean>(length).fill(true)

  let aCount = pulses
  let bCount = length - pulses
  let a: boolean[] = [true]
  let b: boolean[] = [false]

  // Each pass folds one group into the other, the way Euclid's algorithm folds the
  // smaller number into the larger. It terminates for the same reason.
  while (bCount > 1) {
    const nextACount = Math.min(aCount, bCount)
    const nextBCount = Math.abs(aCount - bCount)
    const nextA = [...a, ...b]
    const nextB = aCount <= bCount ? b : a

    aCount = nextACount
    bCount = nextBCount
    a = nextA
    b = nextB
  }

  const pattern: boolean[] = []
  for (let i = 0; i < aCount; i++) pattern.push(...a)
  for (let i = 0; i < bCount; i++) pattern.push(...b)
  return pattern
}

/**
 * Shift a pattern so its hits land elsewhere in the bar.
 *
 * Positive rotation moves the pattern earlier: rotating `x..x..x.` by 1 gives
 * `..x..x.x`, taking the hit off the downbeat. This is core rather than decorative —
 * every Euclidean pattern starts on the downbeat otherwise, and four channels that all
 * start on the downbeat is not a groove.
 */
export function rotate<T>(pattern: readonly T[], amount: number): T[] {
  const length = pattern.length
  if (length === 0) return []
  // JS % keeps the sign of the dividend, so a negative rotation needs normalising.
  const shift = ((amount % length) + length) % length
  return pattern.map((_, i) => pattern[(i + shift) % length]!)
}

/** A rotated Euclidean pattern — what a channel in Euclidean mode actually plays. */
export function euclideanPattern(length: number, triggers: number, rotation: number): boolean[] {
  const clamped = Math.max(0, Math.min(triggers, length))
  return rotate(bjorklund(length, clamped), rotation)
}

/** Compact rendering for tests, logs and pattern-library thumbnails. */
export function patternToString(pattern: readonly boolean[]): string {
  return pattern.map((step) => (step ? 'x' : '.')).join('')
}
