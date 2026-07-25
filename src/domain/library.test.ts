import { describe, expect, test } from 'bun:test'
import {
  cloneSequence,
  createPattern,
  createPreset,
  defaultPatternName,
  defaultPresetName,
  describeSequence,
  emptySequence,
  hydratePattern,
  hydratePreset,
  hydrateSequence,
  isSilent,
  normaliseName,
  patternForRecall,
  presetForRecall,
  presetMatchesLive,
} from './library'
import { DEFAULT_BPM, MAX_LENGTH, createSequence, hitCount, resolvePattern } from './sequence'
import type { ChannelSequence } from './types'

function userSequence(steps: boolean[]): ChannelSequence {
  return { ...createSequence(), kind: 'user', length: steps.length, steps: [...steps] }
}

/** Channel names in slot order, as the panel passes them. */
const NAMES = ['CH1', 'CH2', 'CH3', 'CH4']

describe('copy semantics', () => {
  test('a cloned sequence does not share its step array', () => {
    const live = userSequence([true, false, false, false])
    const copy = cloneSequence(live)

    live.steps[1] = true

    expect(copy.steps).toEqual([true, false, false, false])
    expect(live.steps).toEqual([true, true, false, false])
  })

  test('a queued randomise is not part of a pattern', () => {
    const live: ChannelSequence = { ...createSequence(), pendingRandomise: 'disco' }
    expect(cloneSequence(live).pendingRandomise).toBeNull()
  })

  test('editing the live channel after saving never reaches the saved entry', () => {
    const live = userSequence([true, false, true, false])
    const saved = createPattern('Hats', live, 'CH1', 'p1')

    live.steps[1] = true
    live.length = 32
    live.kind = 'euclidean'

    expect(saved.sequence.steps).toEqual([true, false, true, false])
    expect(saved.sequence.length).toBe(4)
    expect(saved.sequence.kind).toBe('user')
  })

  test('recalling one entry twice does not alias the two channels', () => {
    const saved = createPattern('Kick', userSequence([true, false]), 'CH1', 'p1')

    const first = patternForRecall(saved)
    const second = patternForRecall(saved)
    first.steps[1] = true

    expect(second.steps).toEqual([true, false])
    expect(saved.sequence.steps).toEqual([true, false])
  })

  test('a preset does not share step arrays with the channels it captured', () => {
    const channels = [
      userSequence([true, false]),
      userSequence([false, true]),
      userSequence([true, true]),
      userSequence([false, false]),
    ]
    const preset = createPreset('Scene', channels, NAMES, 140, [], 'x1')

    channels[0]!.steps[1] = true

    expect(preset.channels[0]!.steps).toEqual([true, false])
    expect(preset.bpm).toBe(140)
  })

  test('recalling a preset yields four independent sequences', () => {
    const preset = createPreset('Scene', [userSequence([true, false])], NAMES, 120, [], 'x1')
    const { sequences } = presetForRecall(preset)

    sequences[0]!.steps[1] = true

    expect(preset.channels[0]!.steps).toEqual([true, false])
    expect(sequences).toHaveLength(4)
  })
})

describe('preset shape', () => {
  test('always holds exactly four channels, padding short input with silence', () => {
    const preset = createPreset('Scene', [createSequence()], NAMES, 120, [], 'x1')
    expect(preset.channels).toHaveLength(4)
    expect(isSilent(preset.channels[1]!)).toBe(true)
    expect(isSilent(preset.channels[0]!)).toBe(false)
  })

  test('trims input longer than four channels', () => {
    const many = Array.from({ length: 7 }, () => createSequence())
    expect(createPreset('Scene', many, NAMES, 120, [], 'x1').channels).toHaveLength(4)
  })

  test('an out-of-range tempo is clamped on both save and recall', () => {
    expect(createPreset('Scene', [], NAMES, 9000, [], 'x1').bpm).toBe(300)
    expect(presetForRecall({ ...createPreset('Scene', [], NAMES, 120, [], 'x1'), bpm: -5 }).bpm).toBe(20)
  })

  test('a silent channel loads as silent rather than leaving the live channel alone', () => {
    const preset = createPreset('Scene', [emptySequence()], NAMES, 120, [], 'x1')
    expect(presetForRecall(preset).sequences.every(isSilent)).toBe(true)
  })
})

describe('empty vs default', () => {
  test('the default sequence plays but the empty one does not', () => {
    expect(hitCount(createSequence())).toBe(4)
    expect(hitCount(emptySequence())).toBe(0)
  })

  test('an empty sequence keeps a drawable grid', () => {
    expect(resolvePattern(emptySequence())).toHaveLength(createSequence().length)
  })
})

describe('naming', () => {
  test('collapses whitespace and caps length', () => {
    expect(normaliseName('  four   on the  floor ')).toBe('four on the floor')
    expect(normaliseName('x'.repeat(80))).toHaveLength(48)
  })

  test('an unnamed pattern describes itself', () => {
    const sequence = userSequence([true, false, true, false])
    expect(createPattern('   ', sequence, 'Snare', 'p1').name).toBe('Unnamed · Snare')
    expect(defaultPatternName(createSequence(), 'CH1')).toBe('Unnamed · CH1')
  })

  test('an unnamed preset takes the first free counter', () => {
    const existing = [
      { ...createPreset('Scene 1', [], NAMES, 120, [], 'a') },
      { ...createPreset('Scene 3', [], NAMES, 120, [], 'b') },
    ]
    expect(defaultPresetName(existing)).toBe('Scene 2')
    expect(createPreset('', [], NAMES, 120, existing, 'c').name).toBe('Scene 2')
  })
})

describe('preview text', () => {
  test('euclidean names its generating parameters', () => {
    const sequence: ChannelSequence = { ...createSequence(), triggers: 5, rotation: 3 }
    expect(describeSequence(sequence)).toBe('Euclid · 16 steps · 1/16 · 5 trig · rot 3')
  })

  test('rotation is omitted when there is none', () => {
    expect(describeSequence(createSequence())).toBe('Euclid · 16 steps · 1/16 · 4 trig')
  })

  test('user patterns name their hit count, since the grid shows the shape', () => {
    expect(describeSequence(userSequence([true, false, true]))).toBe('User · 3 steps · 1/16 · 2 hits')
  })
})

describe('hydration from untrusted storage', () => {
  test('a well-formed sequence round-trips', () => {
    const original = userSequence([true, false, true, true])
    expect(hydrateSequence(JSON.parse(JSON.stringify(original)))).toEqual(original)
  })

  test('junk falls back to the default sequence', () => {
    expect(hydrateSequence(null)).toEqual(createSequence())
    expect(hydrateSequence('nope')).toEqual(createSequence())
    expect(hydrateSequence(42)).toEqual(createSequence())
  })

  test('an unknown division or density falls back rather than poisoning the channel', () => {
    const hydrated = hydrateSequence({ division: '1/5', densityMode: 'techno' })
    expect(hydrated.division).toBe('1/16')
    expect(hydrated.densityMode).toBe('bar')
  })

  test('length is clamped and the step map is re-derived to match it', () => {
    const hydrated = hydrateSequence({ kind: 'user', length: 9999, steps: [true, true] })
    expect(hydrated.length).toBe(MAX_LENGTH)
    expect(hydrated.steps).toHaveLength(MAX_LENGTH)
    expect(hydrated.steps.filter(Boolean)).toHaveLength(2)
  })

  test('a step map longer than the length is truncated, not left ragged', () => {
    const hydrated = hydrateSequence({ kind: 'user', length: 2, steps: [true, true, true, true] })
    expect(hydrated.steps).toEqual([true, true])
  })

  test('non-boolean steps read as off', () => {
    expect(hydrateSequence({ kind: 'user', length: 3, steps: [1, 'yes', null] }).steps).toEqual([
      false,
      false,
      false,
    ])
  })

  test('triggers cannot exceed the length and rotation wraps into it', () => {
    const hydrated = hydrateSequence({ length: 8, triggers: 40, rotation: 19 })
    expect(hydrated.triggers).toBe(8)
    expect(hydrated.rotation).toBe(3)
  })

  test('a negative rotation wraps forward', () => {
    expect(hydrateSequence({ length: 8, rotation: -3 }).rotation).toBe(5)
  })

  test('a stored pending randomise is dropped', () => {
    expect(hydrateSequence({ pendingRandomise: 'disco' }).pendingRandomise).toBeNull()
  })

  test('an entry without an id is unusable and dropped', () => {
    expect(hydratePattern({ name: 'x', sequence: createSequence() })).toBeNull()
    expect(hydratePattern({ id: '', name: 'x' })).toBeNull()
    expect(hydratePreset({ name: 'x' })).toBeNull()
  })

  test('a stored channel name is used as provenance', () => {
    expect(hydratePattern({ id: 'p', sourceChannel: '  Hi-hat ' })!.sourceChannel).toBe('Hi-hat')
  })

  test('entries written before channels had names read their number as a CH default', () => {
    expect(hydratePattern({ id: 'p', sourceVoice: 3 })!.sourceChannel).toBe('CH3')
    expect(hydratePattern({ id: 'p', sourceVoice: 9 })!.sourceChannel).toBe('CH1')
    expect(hydratePattern({ id: 'p', sourceVoice: 'two' })!.sourceChannel).toBe('CH1')
  })

  test('a nameless stored entry is given a descriptive one', () => {
    expect(hydratePattern({ id: 'p', name: '   ' })!.name).toBe('Unnamed · CH1')
    expect(hydratePreset({ id: 'x', name: '' })!.name).toBe('Scene')
  })

  test('a preset with missing or extra channels is normalised to four', () => {
    expect(hydratePreset({ id: 'x', channels: [] })!.channels).toHaveLength(4)
    expect(hydratePreset({ id: 'x', channels: [1, 2, 3, 4, 5, 6] })!.channels).toHaveLength(4)
    expect(hydratePreset({ id: 'x' })!.channels).toHaveLength(4)
  })

  test('a preset with a bad tempo falls back to the default', () => {
    expect(hydratePreset({ id: 'x', bpm: 'fast' })!.bpm).toBe(DEFAULT_BPM)
    expect(hydratePreset({ id: 'x', bpm: 5 })!.bpm).toBe(20)
  })

  test('a full entry survives a real JSON round trip', () => {
    const saved = createPattern('Ghost snare', userSequence([false, true, false, true]), 'CH2', 'p9')
    const revived = hydratePattern(JSON.parse(JSON.stringify(saved)))
    expect(revived).toEqual(saved)
  })
})

describe('channel names in the library', () => {
  test('a pattern records the channel it came from', () => {
    expect(createPattern('Backbeat', createSequence(), 'Snare', 'p1').sourceChannel).toBe('Snare')
  })

  test('a preset records all four channel names in slot order', () => {
    const preset = createPreset('Scene', [], ['Kick', 'Snare', 'Hat'], 120, [], 'x1')
    expect(preset.channelNames).toEqual(['Kick', 'Snare', 'Hat', 'CH4'])
  })

  test('a saved pattern remembers its own name, so re-saving suggests it again', () => {
    const saved = createPattern('Four on the floor', createSequence(), 'Kick', 'p1')
    expect(saved.sequence.name).toBe('Four on the floor')
    // Recalled onto another channel, the suggestion carries the pattern name across.
    expect(defaultPatternName(patternForRecall(saved), 'Hat')).toBe('Four on the floor · Hat')
  })

  test('a never-named pattern suggests Unnamed plus the channel', () => {
    expect(defaultPatternName(createSequence(), 'CH2')).toBe('Unnamed · CH2')
  })

  test('re-saving from the same channel does not stack the channel name', () => {
    const once = createPattern('', createSequence(), 'Kick', 'p1')
    expect(once.name).toBe('Unnamed · Kick')
    // The suggestion for a second save from Kick is the same name, not "… · Kick · Kick".
    expect(defaultPatternName(once.sequence, 'Kick')).toBe('Unnamed · Kick')
    // Saved onto a different channel it does still pick up that channel.
    expect(defaultPatternName(once.sequence, 'Hat')).toBe('Unnamed · Kick · Hat')
  })
})

describe('whether the live scene still matches its preset', () => {
  const scene = () => [createSequence(), createSequence(), createSequence(), createSequence()]

  test('an untouched scene matches', () => {
    const preset = createPreset('S', scene(), NAMES, 120, [], 'x1')
    expect(presetMatchesLive(preset, scene(), 120)).toBe(true)
  })

  test('a changed tempo counts as modified', () => {
    const preset = createPreset('S', scene(), NAMES, 120, [], 'x1')
    expect(presetMatchesLive(preset, scene(), 121)).toBe(false)
  })

  test('a changed pattern counts as modified', () => {
    const preset = createPreset('S', scene(), NAMES, 120, [], 'x1')
    const live = scene()
    live[2] = { ...live[2]!, triggers: 7 }
    expect(presetMatchesLive(preset, live, 120)).toBe(false)
  })

  test('a changed length or division counts as modified', () => {
    const preset = createPreset('S', scene(), NAMES, 120, [], 'x1')
    const longer = scene()
    longer[0] = { ...longer[0]!, length: 32 }
    expect(presetMatchesLive(preset, longer, 120)).toBe(false)

    const faster = scene()
    faster[0] = { ...faster[0]!, division: '1/8' }
    expect(presetMatchesLive(preset, faster, 120)).toBe(false)
  })

  test('the density setting and a queued randomise do not count as modified', () => {
    // Neither changes a note. Reporting them would leave the indicator permanently lit.
    const preset = createPreset('S', scene(), NAMES, 120, [], 'x1')
    const live = scene()
    live[1] = { ...live[1]!, densityMode: 'disco', pendingRandomise: 'disco' }
    expect(presetMatchesLive(preset, live, 120)).toBe(true)
  })

  test('renaming the pattern does not count as modified', () => {
    const preset = createPreset('S', scene(), NAMES, 120, [], 'x1')
    const live = scene()
    live[0] = { ...live[0]!, name: 'something else' }
    expect(presetMatchesLive(preset, live, 120)).toBe(true)
  })

  test('a hand-drawn pattern matching a generated one is not modified', () => {
    // Equivalence is audible, so the two kinds are compared through their resolved steps.
    const euclid = { ...createSequence(), length: 4, triggers: 2, rotation: 0 }
    const preset = createPreset('S', [euclid, euclid, euclid, euclid], NAMES, 120, [], 'x1')
    const drawn = userSequence(resolvePattern(euclid))
    expect(presetMatchesLive(preset, [drawn, drawn, drawn, drawn], 120)).toBe(true)
  })
})

describe('a recalled scene names its parts after itself', () => {
  test('a channel with no pattern name inherits the preset name', () => {
    // Otherwise saving one of those channels straight after loading a scene suggests
    // "Unnamed · Kick" when the scene it came from has a perfectly good name.
    const preset = createPreset('House 909', [createSequence()], NAMES, 124, [], 'x1')
    const { sequences } = presetForRecall(preset)

    expect(sequences[0]!.name).toBe('House 909')
    expect(defaultPatternName(sequences[0]!, 'Kick')).toBe('House 909 · Kick')
  })

  test('a channel that already has a pattern name keeps it', () => {
    // The channel's own name is more specific than the scene's, so it wins.
    const named = { ...createSequence(), name: 'Four on the floor' }
    const preset = createPreset('House 909', [named], NAMES, 124, [], 'x1')

    expect(presetForRecall(preset).sequences[0]!.name).toBe('Four on the floor')
  })

  test('empty slots padded in on recall are named after the preset too', () => {
    const preset = createPreset('Scene A', [createSequence()], NAMES, 120, [], 'x1')
    // Slot 2 was never given a sequence, so it is padded — and still belongs to the scene.
    expect(presetForRecall(preset).sequences[1]!.name).toBe('Scene A')
  })
})
