import { describe, expect, test } from 'bun:test'
import { characterOf, characterWords } from './character'
import { classify } from './classify'
import type { AudioFeatures } from './features'
import { FEATURES_VERSION } from './features'

/**
 * The thresholds these exercise were sited by profiling a 2,373-file factory card, so the
 * fixtures below are that card's measured medians per family rather than invented numbers.
 * A rule that stops matching its own family's median has drifted.
 */
function features(over: Partial<AudioFeatures> = {}): AudioFeatures {
  return {
    version: FEATURES_VERSION,
    duration: 1,
    peak: 0.9,
    rms: 0.1,
    crest: 9,
    attack: 0.001,
    decay: 0.3,
    centroid: 1500,
    rolloff: 4000,
    flatness: 0.1,
    zcr: 3000,
    bands: { sub: 0.1, low: 0.2, lowMid: 0.2, mid: 0.3, high: 0.2 },
    pitchHz: null,
    pitchConfidence: 0,
    silent: false,
    ...over,
  }
}

/** Card medians: kick centroid 100 Hz, sub+low 0.98, decay 306 ms. */
const KICK = features({
  centroid: 100,
  decay: 0.306,
  flatness: 0,
  bands: { sub: 0.6, low: 0.38, lowMid: 0.02, mid: 0, high: 0 },
})

/** Card medians: hat centroid 5477 Hz, high band 0.69, decay 145 ms. */
const HAT = features({
  centroid: 5477,
  decay: 0.145,
  flatness: 0.3,
  bands: { sub: 0, low: 0, lowMid: 0.05, mid: 0.26, high: 0.69 },
})

/** Card medians: snare centroid 1153 Hz, sub+low 0.25, decay 179 ms. */
const SNARE = features({
  centroid: 1153,
  decay: 0.179,
  flatness: 0.07,
  bands: { sub: 0.05, low: 0.2, lowMid: 0.3, mid: 0.4, high: 0.05 },
})

/** Card medians: cymbal centroid 2576 Hz, high band 0.23, decay 1518 ms. */
const CYMBAL = features({
  centroid: 2576,
  decay: 1.518,
  flatness: 0.17,
  bands: { sub: 0, low: 0, lowMid: 0.17, mid: 0.6, high: 0.23 },
})

/** Card medians: bass centroid 136 Hz, sub+low 0.89, decay 2 s, usually pitched. */
const BASS = features({
  centroid: 136,
  decay: 2,
  flatness: 0,
  bands: { sub: 0.4, low: 0.49, lowMid: 0.1, mid: 0.01, high: 0 },
  pitchHz: 55,
  pitchConfidence: 0.95,
})

/** A sustained mid-register note — the shape that used to be misread as a snare. */
const PAD = features({
  centroid: 582,
  decay: 3,
  flatness: 0,
  bands: { sub: 0.05, low: 0.29, lowMid: 0.4, mid: 0.26, high: 0 },
  pitchHz: 220,
  pitchConfidence: 0.95,
})

describe('families', () => {
  test('a kick is low', () => {
    expect(classify(KICK).family).toBe('low')
  })

  test('a hi-hat is bright', () => {
    expect(classify(HAT).family).toBe('bright')
  })

  test('a snare is body', () => {
    expect(classify(SNARE).family).toBe('body')
  })

  test('a ringing cymbal is bright, not body', () => {
    // It is far less top-heavy than a hat, so the main bright rule misses it. Before the
    // decay rule was added, every cymbal on the card fell through into `body`.
    expect(classify(CYMBAL).family).toBe('bright')
  })

  test('a bass note is low even though it is pitched', () => {
    expect(classify(BASS).family).toBe('low')
  })

  test('a sustained mid note is tonal, not body', () => {
    expect(classify(PAD).family).toBe('tonal')
  })
})

describe('declining', () => {
  test('silence is unknown with no confidence', () => {
    const verdict = classify(features({ silent: true }))
    expect(verdict.family).toBe('unknown')
    expect(verdict.confidence).toBe(0)
  })

  test('a sample that fits nothing is unknown rather than forced into a family', () => {
    // Mid-low, sustained, unpitched: none of the four rules should claim it.
    const verdict = classify(
      features({
        centroid: 450,
        decay: 2,
        bands: { sub: 0.2, low: 0.4, lowMid: 0.3, mid: 0.1, high: 0 },
      }),
    )
    expect(verdict.family).toBe('unknown')
  })

  test('an unconfident pitch does not make a sample tonal', () => {
    const verdict = classify(features({ ...PAD, pitchConfidence: 0.5 }))
    expect(verdict.family).not.toBe('tonal')
  })
})

describe('confidence', () => {
  test('a clearer example scores higher than a marginal one', () => {
    const clear = classify(features({ ...KICK, bands: { sub: 0.7, low: 0.28, lowMid: 0.02, mid: 0, high: 0 } }))
    const marginal = classify(
      features({ ...KICK, bands: { sub: 0.4, low: 0.45, lowMid: 0.15, mid: 0, high: 0 } }),
    )
    expect(clear.confidence).toBeGreaterThan(marginal.confidence)
  })

  test('every verdict that names a family carries confidence', () => {
    for (const f of [KICK, HAT, SNARE, CYMBAL, BASS, PAD]) {
      expect(classify(f).confidence).toBeGreaterThan(0)
    }
  })
})

describe('character', () => {
  test('brightness tracks the centroid', () => {
    expect(characterOf(KICK)!.brightness).toBe('dark')
    expect(characterOf(SNARE)!.brightness).toBe('warm')
    expect(characterOf(CYMBAL)!.brightness).toBe('bright')
    expect(characterOf(HAT)!.brightness).toBe('crisp')
  })

  test('texture names only the ends of the scale', () => {
    expect(characterOf(KICK)!.texture).toBe('tonal')
    expect(characterOf(HAT)!.texture).toBe('noisy')
    // 0.1 is unremarkable, and saying so would be noise on every row.
    expect(characterOf(features({ flatness: 0.1 }))!.texture).toBeNull()
  })

  test('length tracks decay', () => {
    expect(characterOf(HAT)!.length).toBe('tight')
    expect(characterOf(KICK)!.length).toBe('short')
    expect(characterOf(CYMBAL)!.length).toBe('long')
    expect(characterOf(BASS)!.length).toBe('long')
    expect(characterOf(PAD)!.length).toBe('sustained')
  })

  test('a note is only claimed when the pitch was trusted', () => {
    expect(characterOf(BASS)!.note).toBe('A1')
    expect(characterOf(HAT)!.note).toBeNull()
    expect(characterOf(features({ ...BASS, pitchConfidence: 0.5 }))!.note).toBeNull()
  })

  test('a slow attack is called out, a fast one is not', () => {
    expect(characterOf(features({ attack: 0.2 }))!.swell).toBe(true)
    expect(characterOf(KICK)!.swell).toBe(false)
  })

  test('silence has no character at all', () => {
    expect(characterOf(features({ silent: true }))).toBeNull()
    expect(characterWords(null)).toEqual([])
  })

  test('words omit the axes that had nothing to say', () => {
    expect(characterWords(characterOf(KICK))).toEqual(['dark', 'tonal', 'short'])
    expect(characterWords(characterOf(features({ flatness: 0.1, centroid: 1000, decay: 0.3 })))).toEqual([
      'warm',
      'short',
    ])
  })
})
