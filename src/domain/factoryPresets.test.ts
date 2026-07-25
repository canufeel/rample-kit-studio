import { describe, expect, test } from 'bun:test'
import { VOICE_COUNT } from './device'
import { FACTORY_PRESETS, findFactoryPreset } from './factoryPresets'
import { isSilent } from './library'
import {
  DIVISIONS,
  MAX_BPM,
  MAX_LENGTH,
  MIN_BPM,
  MIN_LENGTH,
  hitCount,
  isPolymetric,
  resolvePattern,
} from './sequence'
import { MAX_CHANNEL_NAME_LENGTH } from './voice'

/**
 * The factory bank is data, and data typos ship silently — a stray character in a step map
 * reads as a rest, an out-of-range length gets clamped somewhere far away. These tests are
 * the only thing standing between a mistake in that table and a broken preset.
 */

const DIVISION_IDS = new Set(DIVISIONS.map((d) => d.id))

describe('every factory preset is structurally valid', () => {
  test('there are enough of them to be a library', () => {
    expect(FACTORY_PRESETS.length).toBeGreaterThanOrEqual(50)
  })

  test.each(FACTORY_PRESETS.map((p) => [p.name, p] as const))('%s', (_name, preset) => {
    expect(preset.channels).toHaveLength(VOICE_COUNT)
    expect(preset.channelNames).toHaveLength(VOICE_COUNT)
    expect(preset.bpm).toBeGreaterThanOrEqual(MIN_BPM)
    expect(preset.bpm).toBeLessThanOrEqual(MAX_BPM)
    expect(preset.note && preset.note.length).toBeGreaterThan(0)

    for (const name of preset.channelNames) {
      expect(name.length).toBeGreaterThan(0)
      // A longer name than the rename field allows would be unreachable to edit back.
      expect(name.length).toBeLessThanOrEqual(MAX_CHANNEL_NAME_LENGTH)
    }

    for (const sequence of preset.channels) {
      expect(DIVISION_IDS.has(sequence.division)).toBe(true)
      expect(sequence.length).toBeGreaterThanOrEqual(MIN_LENGTH)
      expect(sequence.length).toBeLessThanOrEqual(MAX_LENGTH)
      expect(sequence.triggers).toBeLessThanOrEqual(sequence.length)
      expect(sequence.rotation).toBeLessThan(sequence.length)
      expect(sequence.pendingRandomise).toBeNull()

      // A hand-drawn map whose array disagrees with its length would render a ragged grid.
      if (sequence.kind === 'user') {
        expect(sequence.steps).toHaveLength(sequence.length)
        // Every drawn pattern is meant to play something; an all-rest map means a typo,
        // since a deliberately silent channel would be written as euclidean with 0 hits.
        expect(hitCount(sequence)).toBeGreaterThan(0)
      }
    }

    // A preset where nothing plays is not a preset.
    expect(preset.channels.every(isSilent)).toBe(false)
  })
})

describe('the bank is coherent', () => {
  test('ids and names are unique', () => {
    expect(new Set(FACTORY_PRESETS.map((p) => p.id)).size).toBe(FACTORY_PRESETS.length)
    expect(new Set(FACTORY_PRESETS.map((p) => p.name)).size).toBe(FACTORY_PRESETS.length)
  })

  test('ids are namespaced so they cannot collide with a user preset', () => {
    for (const preset of FACTORY_PRESETS) expect(preset.id.startsWith('factory:')).toBe(true)
  })

  test('no two presets are the same groove', () => {
    // The point of the bank is coverage, so a duplicate is a wasted slot.
    const fingerprints = FACTORY_PRESETS.map((preset) =>
      [
        preset.bpm,
        ...preset.channels.map(
          (c) => `${c.division}:${resolvePattern(c).map((on) => (on ? 1 : 0)).join('')}`,
        ),
      ].join('|'),
    )
    expect(new Set(fingerprints).size).toBe(FACTORY_PRESETS.length)
  })

  test('lookup by id works and unknown ids miss', () => {
    expect(findFactoryPreset('factory:house-909')?.name).toBe('House 909')
    expect(findFactoryPreset('nope')).toBeUndefined()
  })
})

describe('the bank covers more than kick-led drum patterns', () => {
  /** Channels named like the kick drum, in any of the spellings the bank uses. */
  const KICK = /kick|sub808|^bd$/i

  test('most presets have no kick at all', () => {
    // A Rample is very often the percussion voice beside a kick coming from another module,
    // and a library where every preset opens with a four-on-the-floor is no use for that.
    const withoutKick = FACTORY_PRESETS.filter((p) => !p.channelNames.some((n) => KICK.test(n)))
    expect(withoutKick.length).toBeGreaterThan(FACTORY_PRESETS.length / 2)
  })

  test('pitched and textural material is represented, not only drums', () => {
    // The factory card carries bass, pads, leads, kalimba, bells, glass and vocals as well
    // as drums, and none of that wants a drum pattern.
    const names = new Set(FACTORY_PRESETS.flatMap((p) => p.channelNames.map((n) => n.toLowerCase())))
    for (const expected of ['bass', 'pad', 'lead', 'vox', 'bell', 'chord', 'arp']) {
      expect(names.has(expected)).toBe(true)
    }
  })

  test('percussion beyond the basic kit is represented', () => {
    const names = new Set(FACTORY_PRESETS.flatMap((p) => p.channelNames.map((n) => n.toLowerCase())))
    for (const expected of ['conga', 'tamb', 'cowbell', 'clave', 'shaker', 'ride', 'rim']) {
      expect(names.has(expected)).toBe(true)
    }
  })
})

describe('the bank covers a range of rhythmic behaviour', () => {
  test('a good number of presets are polymetric, so the set includes evolving grooves', () => {
    const polymetric = FACTORY_PRESETS.filter((p) => isPolymetric(p.channels))
    expect(polymetric.length).toBeGreaterThanOrEqual(15)
  })

  test('both straight and non-straight divisions are represented', () => {
    const divisions = new Set(FACTORY_PRESETS.flatMap((p) => p.channels.map((c) => c.division)))
    expect(divisions.has('1/16')).toBe(true)
    // Triplet and dotted grids are what make the swung and drifting entries feel different.
    expect([...divisions].some((d) => d.endsWith('T'))).toBe(true)
    expect([...divisions].some((d) => d.endsWith('.'))).toBe(true)
  })

  test('both one-bar and two-bar patterns are represented', () => {
    const lengths = new Set(FACTORY_PRESETS.flatMap((p) => p.channels.map((c) => c.length)))
    expect(lengths.has(16)).toBe(true)
    expect(lengths.has(32)).toBe(true)
  })

  test('tempos span the range electronic music actually uses', () => {
    const tempos = FACTORY_PRESETS.map((p) => p.bpm)
    expect(Math.min(...tempos)).toBeLessThanOrEqual(90)
    expect(Math.max(...tempos)).toBeGreaterThanOrEqual(170)
  })
})

describe('the well-known patterns are actually what they claim', () => {
  /** Hit positions of a named channel, for checking a transcription. */
  function hits(presetId: string, channel: string): number[] {
    const preset = findFactoryPreset(presetId)!
    const index = preset.channelNames.indexOf(channel)
    return resolvePattern(preset.channels[index]!).flatMap((on, i) => (on ? [i] : []))
  }

  test('house four-on-the-floor lands on all four beats', () => {
    expect(hits('factory:house-909', 'Kick')).toEqual([0, 4, 8, 12])
  })

  test('the backbeat clap lands on 2 and 4', () => {
    expect(hits('factory:house-909', 'Clap')).toEqual([4, 12])
  })

  test('the open hat sits on the offbeat eighths', () => {
    expect(hits('factory:house-909', 'OpenHat')).toEqual([2, 6, 10, 14])
  })

  test('dembow is three-three-two twice over', () => {
    expect(hits('factory:dembow', 'Kick')).toEqual([0, 3, 6, 8, 11, 14])
  })

  test('the DnB snare falls on beat 3 of each bar', () => {
    expect(hits('factory:dnb-two-step', 'Snare')).toEqual([8, 24])
  })

  test('gabber moves the kick to straight eighths', () => {
    expect(hits('factory:gabber-stomp', 'Kick')).toEqual([0, 2, 4, 6, 8, 10, 12, 14])
  })

  test('the odd-meter preset really is fourteen sixteenths', () => {
    const preset = findFactoryPreset('factory:odd-meter-78')!
    expect(preset.channels.slice(0, 3).map((c) => c.length)).toEqual([14, 14, 14])
  })

  test('the polymeter preset uses coprime lengths', () => {
    const preset = findFactoryPreset('factory:polymeter-5-7-11')!
    expect(preset.channels.map((c) => c.length)).toEqual([5, 7, 11, 13])
    expect(isPolymetric(preset.channels)).toBe(true)
  })
})
