import { describe, expect, test } from 'bun:test'
import { bjorklund } from './euclid'
import { advanceClock, stepSeconds } from './sequence'
import type { ChannelClock } from './sequence'

/**
 * The timing core of the sequencer.
 *
 * Everything here is what a scheduler tick actually does, minus the AudioContext: given
 * where a channel is and how far ahead we are willing to queue, which steps fall due and
 * when. Getting this wrong is the difference between a groove and a stutter, and it is
 * the one part of Stage 4 that can be verified without a browser.
 */

const on = (length: number) => new Array<boolean>(length).fill(true)

/** Run a channel forward through repeated windows, as the real tick loop does. */
function collect(
  pattern: readonly boolean[],
  division: Parameters<typeof advanceClock>[2],
  bpm: number,
  seconds: number,
  windowSec = 0.1,
): number[] {
  let clock: ChannelClock = { nextTime: 0, step: 0 }
  const times: number[] = []
  for (let horizon = windowSec; horizon <= seconds; horizon += windowSec) {
    for (let pass = 0; pass < 64; pass++) {
      const result = advanceClock(clock, pattern, division, bpm, horizon)
      times.push(...result.hits.map((h) => h.time))
      clock = result.clock
      if (!result.wrapped) break
    }
  }
  return times
}

describe('advanceClock', () => {
  test('places hits one step apart', () => {
    const result = advanceClock({ nextTime: 0, step: 0 }, on(4), '1/4', 120, 2)
    expect(result.hits.map((h) => h.time)).toEqual([0, 0.5, 1, 1.5])
  })

  test('only fires steps that are on', () => {
    const pattern = [true, false, true, false]
    const result = advanceClock({ nextTime: 0, step: 0 }, pattern, '1/4', 120, 2)
    expect(result.hits.map((h) => h.step)).toEqual([0, 2])
  })

  test('schedules nothing beyond the horizon', () => {
    const result = advanceClock({ nextTime: 0, step: 0 }, on(16), '1/16', 120, 0.3)
    // 1/16 at 120bpm is 0.125s, so only steps at 0, 0.125 and 0.25 are inside the window.
    expect(result.hits).toHaveLength(3)
    expect(result.clock.nextTime).toBeCloseTo(0.375, 10)
  })

  test('resumes exactly where the previous window stopped — no gap, no overlap', () => {
    const first = advanceClock({ nextTime: 0, step: 0 }, on(64), '1/16', 120, 0.3)
    const second = advanceClock(first.clock, on(64), '1/16', 120, 0.6)
    const times = [...first.hits, ...second.hits].map((h) => h.time)

    expect(new Set(times).size).toBe(times.length)
    for (let i = 1; i < times.length; i++) {
      expect(times[i]! - times[i - 1]!).toBeCloseTo(0.125, 10)
    }
  })

  test('stops at a loop boundary and reports it', () => {
    const result = advanceClock({ nextTime: 0, step: 0 }, on(4), '1/16', 120, 10)
    expect(result.wrapped).toBe(true)
    expect(result.clock.step).toBe(0)
    // Stopping at the boundary is what lets a queued randomise land on the boundary
    // rather than a lookahead window later.
    expect(result.hits).toHaveLength(4)
  })

  test('does not report a wrap when the window ends mid-pattern', () => {
    expect(advanceClock({ nextTime: 0, step: 0 }, on(16), '1/16', 120, 0.3).wrapped).toBe(false)
  })

  test('a tempo change takes effect from the next step', () => {
    const first = advanceClock({ nextTime: 0, step: 0 }, on(64), '1/4', 120, 1)
    const second = advanceClock(first.clock, on(64), '1/4', 240, 2)
    // Steps at 120bpm are 0.5s; after the change they should be 0.25s.
    expect(second.hits[1]!.time - second.hits[0]!.time).toBeCloseTo(0.25, 10)
  })

  test('an empty pattern advances nothing rather than spinning', () => {
    const result = advanceClock({ nextTime: 0, step: 5 }, [], '1/16', 120, 100)
    expect(result.hits).toEqual([])
    expect(result.wrapped).toBe(false)
    expect(result.clock).toEqual({ nextTime: 0, step: 5 })
  })

  test('a silent pattern still advances the clock', () => {
    // A channel with no hits must keep time, or it would never reach its loop boundary
    // and a queued randomise would never land.
    const result = advanceClock({ nextTime: 0, step: 0 }, [false, false], '1/4', 120, 10)
    expect(result.hits).toEqual([])
    expect(result.wrapped).toBe(true)
    expect(result.clock.nextTime).toBeCloseTo(1, 10)
  })
})

describe('timing over many windows', () => {
  test('hits stay on the grid across hundreds of steps — no drift accumulates', () => {
    const times = collect(on(16), '1/16', 120, 20)
    const step = stepSeconds('1/16', 120)
    expect(times.length).toBeGreaterThan(150)
    times.forEach((time, i) => {
      // Absolute, not relative: each hit is checked against where it should be from t=0,
      // which is what catches drift that per-step comparisons would hide.
      expect(time).toBeCloseTo(i * step, 9)
    })
  })

  test('window size does not affect where hits land', () => {
    // The lookahead is an implementation detail; changing it must not change the music.
    const fine = collect(on(16), '1/16', 137, 10, 0.05)
    const coarse = collect(on(16), '1/16', 137, 10, 0.25)
    const shared = Math.min(fine.length, coarse.length)
    for (let i = 0; i < shared; i++) {
      expect(fine[i]).toBeCloseTo(coarse[i]!, 9)
    }
  })

  test('triplets divide a beat exactly three ways', () => {
    // Three 1/8T steps span one beat — 0.5s at 120bpm — with no rounding residue, which
    // is the whole point of deriving step length from beats rather than from seconds.
    const times = collect(on(3), '1/8T', 120, 4)
    expect(times[3]! - times[0]!).toBeCloseTo(60 / 120, 9)
    expect(times[6]! - times[0]!).toBeCloseTo(2 * (60 / 120), 9)
  })

  test('three triplet quarters span two beats', () => {
    const times = collect(on(3), '1/4T', 120, 8)
    expect(times[3]! - times[0]!).toBeCloseTo(2 * (60 / 120), 9)
  })

  test('a dotted eighth is one and a half plain eighths', () => {
    const dotted = collect(on(8), '1/8.', 120, 4)
    const plain = collect(on(8), '1/8', 120, 4)
    expect(dotted[1]! - dotted[0]!).toBeCloseTo((plain[1]! - plain[0]!) * 1.5, 9)
  })

  test('channels of differing length phase against each other', () => {
    // Polymeter: 16 and 12 steps at the same division share a tempo but not a bar.
    const sixteen = collect(on(16), '1/16', 120, 8)
    const twelve = collect(on(12), '1/16', 120, 8)
    const step = stepSeconds('1/16', 120)

    // Both start together...
    expect(sixteen[0]).toBeCloseTo(twelve[0]!, 9)
    // ...but their loop boundaries separate, and only realign after 48 steps (LCM).
    expect(sixteen[16]).toBeCloseTo(16 * step, 9)
    expect(twelve[12]).toBeCloseTo(12 * step, 9)
    expect(sixteen[48]).toBeCloseTo(twelve[48]!, 9)
  })

  test('a Euclidean pattern fires exactly its hits per loop', () => {
    const pattern = bjorklund(16, 5)
    let clock: ChannelClock = { nextTime: 0, step: 0 }
    const result = advanceClock(clock, pattern, '1/16', 120, 100)
    expect(result.hits).toHaveLength(5)
    expect(result.wrapped).toBe(true)

    clock = result.clock
    expect(advanceClock(clock, pattern, '1/16', 120, 100).hits).toHaveLength(5)
  })
})
