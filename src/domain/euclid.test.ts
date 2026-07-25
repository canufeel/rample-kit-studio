import { describe, expect, test } from 'bun:test'
import { bjorklund, euclideanPattern, patternToString, rotate } from './euclid'

const str = (length: number, pulses: number) => patternToString(bjorklund(length, pulses))

describe('bjorklund', () => {
  test('reproduces the canonical patterns from the literature', () => {
    // Toussaint, "The Euclidean Algorithm Generates Traditional Musical Rhythms".
    expect(str(8, 3)).toBe('x..x..x.')
    expect(str(8, 5)).toBe('x.xx.xx.')
    expect(str(16, 5)).toBe('x..x..x..x..x...')
    expect(str(16, 7)).toBe('x..x.x.x..x.x.x.')
  })

  test('an even division alternates', () => {
    expect(str(8, 4)).toBe('x.x.x.x.')
    expect(str(16, 8)).toBe('x.x.x.x.x.x.x.x.')
  })

  test('degenerate counts do not throw', () => {
    expect(str(8, 0)).toBe('........')
    expect(str(8, 8)).toBe('xxxxxxxx')
    expect(str(8, 12)).toBe('xxxxxxxx')
    expect(str(8, -3)).toBe('........')
    expect(bjorklund(0, 0)).toEqual([])
  })

  test('always returns exactly `length` steps with `pulses` hits', () => {
    for (let length = 1; length <= 32; length++) {
      for (let pulses = 0; pulses <= length; pulses++) {
        const pattern = bjorklund(length, pulses)
        expect(pattern).toHaveLength(length)
        expect(pattern.filter(Boolean)).toHaveLength(pulses)
      }
    }
  })

  test('hits are maximally even — gaps differ by at most one step', () => {
    // This is the defining property of a Euclidean rhythm: the intervals between
    // successive hits take at most two distinct values, and those differ by 1.
    for (let length = 2; length <= 32; length++) {
      for (let pulses = 1; pulses <= length; pulses++) {
        const pattern = bjorklund(length, pulses)
        const positions = pattern.flatMap((on, i) => (on ? [i] : []))
        const gaps = positions.map((p, i) =>
          i === positions.length - 1 ? length - p + positions[0]! : positions[i + 1]! - p,
        )
        const distinct = [...new Set(gaps)].sort((a, b) => a - b)
        expect(distinct.length).toBeLessThanOrEqual(2)
        if (distinct.length === 2) {
          expect(distinct[1]! - distinct[0]!).toBe(1)
        }
      }
    }
  })

  test('always starts on the downbeat when there is at least one hit', () => {
    for (let length = 1; length <= 24; length++) {
      for (let pulses = 1; pulses <= length; pulses++) {
        expect(bjorklund(length, pulses)[0]).toBe(true)
      }
    }
  })
})

describe('rotate', () => {
  test('moves the pattern earlier', () => {
    expect(patternToString(rotate(bjorklund(8, 3), 1))).toBe('..x..x.x')
    expect(patternToString(rotate(bjorklund(8, 3), 3))).toBe('x..x.x..')
  })

  test('a full turn is the identity', () => {
    const pattern = bjorklund(16, 5)
    expect(rotate(pattern, 16)).toEqual(pattern)
    expect(rotate(pattern, 0)).toEqual(pattern)
  })

  test('negative rotation wraps rather than producing holes', () => {
    // JS % keeps the dividend's sign, so this is the case a naive modulo gets wrong.
    const pattern = bjorklund(8, 3)
    expect(rotate(pattern, -1)).toEqual(rotate(pattern, 7))
    expect(rotate(pattern, -9)).toEqual(rotate(pattern, 7))
  })

  test('rotation preserves the hit count', () => {
    for (let r = -20; r <= 20; r++) {
      expect(rotate(bjorklund(13, 5), r).filter(Boolean)).toHaveLength(5)
    }
  })

  test('an empty pattern rotates to an empty pattern', () => {
    expect(rotate([], 3)).toEqual([])
  })
})

describe('euclideanPattern', () => {
  test('clamps triggers above the length instead of overflowing', () => {
    expect(patternToString(euclideanPattern(4, 99, 0))).toBe('xxxx')
    expect(patternToString(euclideanPattern(4, -5, 0))).toBe('....')
  })

  test('rotation takes hits off the downbeat', () => {
    expect(euclideanPattern(8, 3, 0)[0]).toBe(true)
    expect(euclideanPattern(8, 3, 1)[0]).toBe(false)
  })
})
