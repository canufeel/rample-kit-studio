import { describe, expect, test } from 'bun:test'
import { patternToString } from './euclid'
import { selectLayer } from './layerSelect'
import {
  DENSITY_BANDS,
  DEFAULT_BPM,
  MAX_BPM,
  MIN_BPM,
  MIN_RANDOM_HITS,
  clampBpm,
  clampLength,
  createSequence,
  divisionBeats,
  hitCount,
  isPolymetric,
  randomSteps,
  randomiseSequence,
  resolvePattern,
  stepSeconds,
  targetHits,
} from './sequence'
import type { ChannelSequence, DensityMode } from './types'

/** Deterministic RNG so randomisation can be asserted rather than merely smoke-tested. */
function seeded(values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]!
}

describe('time divisions', () => {
  test('a quarter note is one beat', () => {
    expect(divisionBeats('1/4')).toBe(1)
  })

  test('divisions halve as the denominator doubles', () => {
    expect(divisionBeats('1/8')).toBe(0.5)
    expect(divisionBeats('1/16')).toBe(0.25)
    expect(divisionBeats('1/32')).toBe(0.125)
    expect(divisionBeats('1/1')).toBe(4)
  })

  test('a dotted value is one and a half times its plain form', () => {
    expect(divisionBeats('1/8.')).toBeCloseTo(divisionBeats('1/8') * 1.5, 10)
    expect(divisionBeats('1/4.')).toBeCloseTo(divisionBeats('1/4') * 1.5, 10)
  })

  test('a triplet is two thirds of its plain form', () => {
    expect(divisionBeats('1/8T')).toBeCloseTo(divisionBeats('1/8') * (2 / 3), 10)
    // Three triplet eighths occupy exactly one beat — the point of a triplet.
    expect(divisionBeats('1/8T') * 3).toBeCloseTo(1, 10)
  })

  test('step length tracks tempo', () => {
    expect(stepSeconds('1/4', 120)).toBeCloseTo(0.5, 10)
    expect(stepSeconds('1/16', 120)).toBeCloseTo(0.125, 10)
    // Doubling the tempo halves the step.
    expect(stepSeconds('1/16', 240)).toBeCloseTo(stepSeconds('1/16', 120) / 2, 10)
  })

  test('sixteen 1/16 steps make one bar of 4/4', () => {
    expect(stepSeconds('1/16', 120) * 16).toBeCloseTo(2, 10)
  })
})

describe('clamping', () => {
  test('bpm stays inside the supported range', () => {
    expect(clampBpm(1)).toBe(MIN_BPM)
    expect(clampBpm(9999)).toBe(MAX_BPM)
    expect(clampBpm(128)).toBe(128)
    expect(clampBpm(Number.NaN)).toBe(DEFAULT_BPM)
  })

  test('length stays inside the supported range and is whole', () => {
    expect(clampLength(0)).toBe(1)
    expect(clampLength(1000)).toBe(64)
    expect(clampLength(15.6)).toBe(16)
    expect(clampLength(Number.NaN)).toBe(16)
  })
})

describe('density randomisation', () => {
  const modes: DensityMode[] = ['mezzanine', 'bar', 'disco']

  test('hit counts land inside the requested band', () => {
    for (const mode of modes) {
      const band = DENSITY_BANDS[mode]
      for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
        const hits = targetHits(64, mode, () => r)
        const fraction = hits / 64
        expect(fraction).toBeGreaterThanOrEqual(Math.min(band.lo, MIN_RANDOM_HITS / 64))
        expect(fraction).toBeLessThanOrEqual(band.hi + 0.01)
      }
    }
  })

  test('busier bands produce more hits than sparser ones', () => {
    const mid = () => 0.5
    expect(targetHits(32, 'disco', mid)).toBeGreaterThan(targetHits(32, 'bar', mid))
    expect(targetHits(32, 'bar', mid)).toBeGreaterThan(targetHits(32, 'mezzanine', mid))
  })

  test('never randomises a channel to silence', () => {
    // The floor exists so a dice roll can never mute a voice outright.
    for (const mode of modes) {
      for (let length = 1; length <= 64; length++) {
        expect(targetHits(length, mode, () => 0)).toBeGreaterThanOrEqual(MIN_RANDOM_HITS)
      }
    }
  })

  test('never asks for more hits than the pattern has steps', () => {
    for (const mode of modes) {
      for (let length = 1; length <= 64; length++) {
        expect(targetHits(length, mode, () => 0.999)).toBeLessThanOrEqual(length)
      }
    }
  })

  test('random step placement produces exactly the requested hits', () => {
    for (let hits = 0; hits <= 16; hits++) {
      expect(randomSteps(16, hits).filter(Boolean)).toHaveLength(hits)
    }
  })

  test('randomising a Euclidean channel sets triggers and rotation, never length', () => {
    const sequence: ChannelSequence = { ...createSequence('euclidean'), length: 16 }
    const patch = randomiseSequence(sequence, 'bar', seeded([0.5, 0.25]))

    expect(patch.length).toBeUndefined()
    expect(patch.steps).toBeUndefined()
    expect(patch.triggers).toBe(6)
    expect(patch.rotation).toBe(4)
    expect(patch.densityMode).toBe('bar')
  })

  test('randomising a user channel sets steps, not triggers or rotation', () => {
    const sequence: ChannelSequence = { ...createSequence('user'), length: 16 }
    const patch = randomiseSequence(sequence, 'disco')

    expect(patch.steps).toBeDefined()
    expect(patch.steps).toHaveLength(16)
    expect(patch.triggers).toBeUndefined()
    expect(patch.rotation).toBeUndefined()
  })

  test('the chosen band is remembered so a roll can be repeated in character', () => {
    const sequence = createSequence('euclidean')
    expect(randomiseSequence(sequence, 'disco').densityMode).toBe('disco')
  })

  test('a randomised rotation stays inside the pattern', () => {
    const sequence: ChannelSequence = { ...createSequence('euclidean'), length: 7 }
    for (const r of [0, 0.5, 0.999]) {
      const patch = randomiseSequence(sequence, 'bar', () => r)
      expect(patch.rotation).toBeGreaterThanOrEqual(0)
      expect(patch.rotation).toBeLessThan(7)
    }
  })
})

describe('pattern resolution', () => {
  test('a Euclidean channel resolves through Bjorklund and rotation', () => {
    const sequence: ChannelSequence = {
      ...createSequence('euclidean'),
      length: 8,
      triggers: 3,
      rotation: 0,
    }
    expect(patternToString(resolvePattern(sequence))).toBe('x..x..x.')
    expect(patternToString(resolvePattern({ ...sequence, rotation: 1 }))).toBe('..x..x.x')
  })

  test('a user channel resolves to its own step map', () => {
    const sequence: ChannelSequence = {
      ...createSequence('user'),
      length: 4,
      steps: [true, false, true, false],
    }
    expect(patternToString(resolvePattern(sequence))).toBe('x.x.')
  })

  test('a step map shorter than the length pads with rests rather than crashing', () => {
    // Growing the length must not require rewriting the array on every edit.
    const sequence: ChannelSequence = { ...createSequence('user'), length: 8, steps: [true, true] }
    expect(patternToString(resolvePattern(sequence))).toBe('xx......')
  })

  test('a step map longer than the length is truncated', () => {
    const sequence: ChannelSequence = {
      ...createSequence('user'),
      length: 2,
      steps: [true, true, true, true],
    }
    expect(resolvePattern(sequence)).toHaveLength(2)
  })

  test('switching kind keeps both sets of parameters intact', () => {
    // Toggling Euclid/User must not discard whichever set is currently inactive.
    const sequence: ChannelSequence = {
      ...createSequence('euclidean'),
      length: 4,
      triggers: 2,
      steps: [true, true, true, true],
    }
    expect(hitCount(sequence)).toBe(2)
    expect(hitCount({ ...sequence, kind: 'user' })).toBe(4)
  })
})

describe('polymeter detection', () => {
  test('channels of equal cycle length are not polymetric', () => {
    const a: ChannelSequence = { ...createSequence(), length: 16, division: '1/16', triggers: 4 }
    expect(isPolymetric([a, { ...a }])).toBe(false)
  })

  test('differing step counts at the same division phase against each other', () => {
    const a: ChannelSequence = { ...createSequence(), length: 16, division: '1/16', triggers: 4 }
    const b: ChannelSequence = { ...a, length: 12 }
    expect(isPolymetric([a, b])).toBe(true)
  })

  test('different lengths that span the same time are not polymetric', () => {
    // 16 steps of 1/16 and 8 steps of 1/8 both cover one bar.
    const a: ChannelSequence = { ...createSequence(), length: 16, division: '1/16', triggers: 4 }
    const b: ChannelSequence = { ...createSequence(), length: 8, division: '1/8', triggers: 4 }
    expect(isPolymetric([a, b])).toBe(false)
  })

  test('silent channels are ignored — they cannot phase against anything', () => {
    const a: ChannelSequence = { ...createSequence(), length: 16, division: '1/16', triggers: 4 }
    const silent: ChannelSequence = { ...createSequence(), length: 12, triggers: 0 }
    expect(isPolymetric([a, silent])).toBe(false)
  })
})

describe('layer selection', () => {
  const layers = ['a', 'b', 'c']

  test('cyclic walks the layers in order and wraps', () => {
    expect(selectLayer(layers, 'cyclic', 0)?.id).toBe('a')
    expect(selectLayer(layers, 'cyclic', 1)?.id).toBe('b')
    expect(selectLayer(layers, 'cyclic', 2)?.id).toBe('c')
    expect(selectLayer(layers, 'cyclic', 3)?.id).toBe('a')
  })

  test('cyclic hands back the cursor for the next trigger', () => {
    let cursor = 0
    const seen: string[] = []
    for (let i = 0; i < 5; i++) {
      const choice = selectLayer(layers, 'cyclic', cursor)!
      seen.push(choice.id)
      cursor = choice.nextCursor
    }
    expect(seen).toEqual(['a', 'b', 'c', 'a', 'b'])
  })

  test('manual holds its position across repeated triggers', () => {
    const first = selectLayer(layers, 'manual', 1)!
    expect(first.id).toBe('b')
    expect(selectLayer(layers, 'manual', first.nextCursor)!.id).toBe('b')
  })

  test('manual clamps a cursor left behind by a deleted layer', () => {
    expect(selectLayer(layers, 'manual', 99)?.id).toBe('c')
    expect(selectLayer(layers, 'manual', -1)?.id).toBe('a')
  })

  test('random stays in range at both extremes of the RNG', () => {
    expect(selectLayer(layers, 'random', 0, () => 0)?.id).toBe('a')
    // Math.random() can return values arbitrarily close to 1; the index must not run off
    // the end of the array.
    expect(selectLayer(layers, 'random', 0, () => 0.9999999)?.id).toBe('c')
    expect(selectLayer(layers, 'random', 0, () => 1)?.id).toBe('c')
  })

  test('an empty voice selects nothing rather than throwing', () => {
    expect(selectLayer([], 'random', 0)).toBeNull()
    expect(selectLayer([], 'cyclic', 0)).toBeNull()
    expect(selectLayer([], 'manual', 0)).toBeNull()
  })

  test('a single layer works in every mode', () => {
    for (const mode of ['random', 'cyclic', 'manual'] as const) {
      expect(selectLayer(['only'], mode, 0)?.id).toBe('only')
    }
  })
})
