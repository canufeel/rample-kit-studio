import { describe, expect, test } from 'bun:test'
import { KIT_CODE_RE, VOICE_INDICES } from './device'
import { exportFilename, slugifySampleName, stripExtension } from './filename'
import { isKitCode, nextAvailableKitCode, validateKitCode } from './kitCode'
import type { AudioMeta, ConversionTarget, Kit, Voice } from './types'
import { formatSize } from '~/lib/format'
import { describeCapacity, sampleIssues, targetForVoice } from './validation'
import {
  MAX_CHANNEL_NAME_LENGTH,
  activeLayers,
  channelInSlot,
  channelsInSlotOrder,
  createKit,
  createVoice,
  moveLayer,
  availableWeights,
  collapseDuplicateSlots,
  distinctSamples,
  duplicateSlotAt,
  freeSlotCount,
  isChannelAudible,
  isSoloing,
  makeSlot,
  selectionProbability,
  setSlotWeight,
  slotCopyPosition,
  slotGroups,
  slotWeight,
  normaliseChannelName,
  queuedLayers,
  slotOf,
} from './voice'

describe('kit code', () => {
  test('accepts every form the manual documents', () => {
    for (const code of ['A0', 'E10', 'R7', 'G69', 'Z99']) {
      expect(isKitCode(code)).toBe(true)
    }
  })

  test('rejects zero-padded numbers', () => {
    // The manual promises "up to 2600 folders" = 26 letters x 100 numbers, which only
    // holds if A0 and A00 aren't two spellings of the same kit.
    expect(isKitCode('A00')).toBe(false)
    expect(isKitCode('A01')).toBe(false)
  })

  test('rejects out-of-range and malformed codes', () => {
    for (const code of ['', 'A', 'a0', 'A100', '0A', 'AA0', 'A-1', 'A0 ']) {
      expect(isKitCode(code)).toBe(false)
    }
  })

  test('the regex spans exactly 2600 codes', () => {
    let count = 0
    for (let letter = 65; letter <= 90; letter++) {
      for (let n = 0; n < 100; n++) {
        if (KIT_CODE_RE.test(`${String.fromCharCode(letter)}${n}`)) count++
      }
    }
    expect(count).toBe(2600)
  })

  test('validation reports duplicates and normalises case', () => {
    expect(validateKitCode('a0', ['A0'])).toBe('duplicate')
    expect(validateKitCode(' b1 ', ['A0'])).toBeNull()
    expect(validateKitCode('A100', [])).toBe('format')
    expect(validateKitCode('', [])).toBe('empty')
  })

  test('next available code skips taken ones in device order', () => {
    expect(nextAvailableKitCode([])).toBe('A0')
    expect(nextAvailableKitCode(['A0', 'A1'])).toBe('A2')
  })
})

describe('export filenames', () => {
  test('strips extensions without mangling dotless names', () => {
    expect(stripExtension('kick.wav')).toBe('kick')
    expect(stripExtension('no-ext')).toBe('no-ext')
    expect(stripExtension('.hidden')).toBe('.hidden')
    expect(stripExtension('two.dots.wav')).toBe('two.dots')
  })

  test('slugifies to FAT-safe characters', () => {
    expect(slugifySampleName('Kick (Deep) #2.wav')).toBe('Kick_Deep_2')
    expect(slugifySampleName('Café Crème.wav')).toBe('Cafe_Creme')
    expect(slugifySampleName('  spaces  everywhere .wav')).toBe('spaces_everywhere')
    expect(slugifySampleName('a---b.wav')).toBe('a_b')
  })

  test('falls back rather than producing an empty name', () => {
    expect(slugifySampleName('🥁.wav')).toBe('sample')
    expect(slugifySampleName('___.wav')).toBe('sample')
  })

  test('never leaves a trailing underscore after truncation', () => {
    const long = `${'a'.repeat(47)}_${'b'.repeat(20)}.wav`
    const slug = slugifySampleName(long)
    expect(slug.endsWith('_')).toBe(false)
    expect(slug.length).toBeLessThanOrEqual(48)
  })

  test('first character is the voice digit, as the device requires', () => {
    for (const voice of [1, 2, 3, 4] as const) {
      expect(exportFilename(voice, 0, 'kick.wav')[0]).toBe(String(voice))
    }
  })

  test('slot numbering sorts correctly under numeric-then-alphabetic ordering', () => {
    const names = Array.from({ length: 12 }, (_, i) => exportFilename(1, i, 'x.wav'))
    expect([...names].sort()).toEqual(names)
    expect(names[0]).toBe('1-01_x.wav')
    expect(names[11]).toBe('1-12_x.wav')
  })

  test('identical source names cannot collide', () => {
    const a = exportFilename(1, 0, 'kick.wav')
    const b = exportFilename(1, 1, 'kick.wav')
    expect(a).not.toBe(b)
  })
})

const wavMeta = (overrides: Partial<AudioMeta> = {}): AudioMeta => ({
  container: 'wav',
  codec: 'pcm',
  sampleRate: 44100,
  bitDepth: 16,
  channels: 1,
  durationSec: 1,
  sizeBytes: 1000,
  ...overrides,
})

const monoTarget: ConversionTarget = { sampleRate: 44100, bitDepth: 16, channels: 1 }
const stereoTarget: ConversionTarget = { sampleRate: 44100, bitDepth: 16, channels: 2 }

describe('sample validation', () => {
  test('a conforming mono file is valid', () => {
    expect(sampleIssues(wavMeta(), monoTarget)).toEqual([])
  })

  test('8-bit is valid — the manual allows "16-bit or 8-bit"', () => {
    expect(sampleIssues(wavMeta({ bitDepth: 8 }), monoTarget)).toEqual([])
  })

  test('24-bit and 32-bit are not', () => {
    expect(sampleIssues(wavMeta({ bitDepth: 24 }), monoTarget)).toContain('bitDepth')
    expect(sampleIssues(wavMeta({ bitDepth: 32 }), monoTarget)).toContain('bitDepth')
  })

  test('a 32-bit float WAV is caught by codec, not bit depth alone', () => {
    // This is the case decodeAudioData cannot see: it decodes perfectly and would look
    // valid without the header parse.
    const issues = sampleIssues(wavMeta({ codec: 'ieee-float', bitDepth: 32 }), monoTarget)
    expect(issues).toContain('codec')
  })

  test('wrong sample rate is flagged', () => {
    expect(sampleIssues(wavMeta({ sampleRate: 48000 }), monoTarget)).toContain('sampleRate')
  })

  test('channel count is judged against the voice target, both ways', () => {
    expect(sampleIssues(wavMeta({ channels: 2 }), monoTarget)).toContain('channels')
    expect(sampleIssues(wavMeta({ channels: 1 }), stereoTarget)).toContain('channels')
    expect(sampleIssues(wavMeta({ channels: 2 }), stereoTarget)).toEqual([])
  })

  test('sub-50ms samples are flagged', () => {
    expect(sampleIssues(wavMeta({ durationSec: 0.02 }), monoTarget)).toContain('tooShort')
    expect(sampleIssues(wavMeta({ durationSec: 0.05 }), monoTarget)).not.toContain('tooShort')
  })

  test('a non-WAV container reports one reason, not five', () => {
    const issues = sampleIssues(
      { container: 'mp3', codec: 'compressed', sampleRate: null, bitDepth: null, channels: 2, durationSec: 1, sizeBytes: 500 },
      monoTarget,
    )
    expect(issues).toEqual(['container'])
  })

  test('flipping a voice to stereo invalidates its mono samples', () => {
    const voice = createVoice(1)
    expect(sampleIssues(wavMeta({ channels: 1 }), targetForVoice(voice))).toEqual([])
    voice.mode = 'stereo'
    expect(sampleIssues(wavMeta({ channels: 1 }), targetForVoice(voice))).toContain('channels')
  })
})

/** The sample ids a voice's slots hold, in order. */
function sampleIdsOf(voice: Voice): string[] {
  return voice.layers.map((slot) => slot.sampleId)
}

describe('layer list', () => {
  function voiceWith(count: number): Voice {
    const voice = createVoice(1)
    voice.layers = Array.from({ length: count }, (_, i) => makeSlot(`s${i}`))
    return voice
  }

  test('the first twelve are active and the rest queue', () => {
    const voice = voiceWith(15)
    expect(activeLayers(voice)).toHaveLength(12)
    expect(queuedLayers(voice)).toEqual(['s12', 's13', 's14'])
  })

  test('removing an active layer promotes the first queued one', () => {
    const voice = voiceWith(13)
    expect(activeLayers(voice)).not.toContain('s12')
    voice.layers = voice.layers.filter((slot) => slot.sampleId !== 's0')
    expect(activeLayers(voice)).toContain('s12')
    expect(queuedLayers(voice)).toEqual([])
  })

  test('capacity caption reads as intended', () => {
    expect(describeCapacity(voiceWith(0))).toBe('12 active slots left')
    expect(describeCapacity(voiceWith(11))).toBe('1 active slot left')
    expect(describeCapacity(voiceWith(32))).toBe('0 active slots left, 20 queued')
  })

  test('moving within a voice matches arrayMove semantics', () => {
    const kit = createKit('A0')
    kit.voices[0]!.layers = ['a', 'b', 'c', 'd'].map(makeSlot)
    moveLayer(kit, { voice: 1, index: 0 }, { voice: 1, index: 2 })
    expect(sampleIdsOf(kit.voices[0]!)).toEqual(['b', 'c', 'a', 'd'])
  })

  test('moving across voices removes from one and inserts in the other', () => {
    const kit = createKit('A0')
    kit.voices[0]!.layers = ['a', 'b'].map(makeSlot)
    kit.voices[1]!.layers = ['x'].map(makeSlot)
    moveLayer(kit, { voice: 1, index: 0 }, { voice: 2, index: 0 })
    expect(sampleIdsOf(kit.voices[0]!)).toEqual(['b'])
    expect(sampleIdsOf(kit.voices[1]!)).toEqual(['a', 'x'])
  })

  test('dragging past the active boundary queues a layer', () => {
    const kit = createKit('A0')
    kit.voices[0]!.layers = Array.from({ length: 13 }, (_, i) => makeSlot(`s${i}`))
    moveLayer(kit, { voice: 1, index: 0 }, { voice: 1, index: 12 })
    expect(queuedLayers(kit.voices[0]!)).toEqual(['s0'])
  })

  test('an out-of-range destination clamps instead of corrupting the list', () => {
    const kit = createKit('A0')
    kit.voices[0]!.layers = ['a', 'b'].map(makeSlot)
    moveLayer(kit, { voice: 1, index: 0 }, { voice: 1, index: 99 })
    expect(sampleIdsOf(kit.voices[0]!)).toEqual(['b', 'a'])
  })
})

describe('channel identity vs SP slot', () => {
  test('a new channel is named CH<identity>', () => {
    const kit = createKit('A0')
    expect(kit.voices.map((v) => v.name)).toEqual(['CH1', 'CH2', 'CH3', 'CH4'])
  })

  test('slot order follows voiceOrder, identity does not move', () => {
    const kit = createKit('A0')
    kit.voiceOrder = [4, 2, 1, 3]

    expect(channelsInSlotOrder(kit).map((v) => v.index)).toEqual([4, 2, 1, 3])
    expect(kit.voices.map((v) => v.index)).toEqual([1, 2, 3, 4])
    expect(slotOf(kit, 4)).toBe(1)
    expect(slotOf(kit, 3)).toBe(4)
    expect(channelInSlot(kit, 1)!.index).toBe(4)
  })

  test('a missing entry in the slot order still yields four channels', () => {
    const kit = createKit('A0')
    kit.voiceOrder = [2]
    expect(channelsInSlotOrder(kit).map((v) => v.index)).toEqual([2, 1, 3, 4])
  })

  test('a duplicated entry cannot place one channel in two slots', () => {
    const kit = createKit('A0')
    kit.voiceOrder = [1, 1, 1, 1]
    expect(channelsInSlotOrder(kit).map((v) => v.index)).toEqual([1, 2, 3, 4])
  })

  test('an unknown entry is ignored rather than creating a hole', () => {
    const kit = createKit('A0')
    kit.voiceOrder = [9 as never, 3]
    expect(channelsInSlotOrder(kit).map((v) => v.index)).toEqual([3, 1, 2, 4])
  })

  test('channel names are trimmed, capped, and never left blank', () => {
    expect(normaliseChannelName('  Deep   Kick ', 1)).toBe('Deep Kick')
    expect(normaliseChannelName('', 3)).toBe('CH3')
    expect(normaliseChannelName('   ', 2)).toBe('CH2')
    expect(normaliseChannelName('x'.repeat(40), 1)).toHaveLength(MAX_CHANNEL_NAME_LENGTH)
  })
})

describe('channel mute and solo', () => {
  function kitWithFlags(flags: { muted?: boolean; soloed?: boolean }[]): Kit {
    const kit = createKit('A0')
    flags.forEach((f, i) => {
      kit.voices[i]!.muted = f.muted ?? false
      kit.voices[i]!.soloed = f.soloed ?? false
    })
    return kit
  }

  test('with nothing muted or soloed every channel sounds', () => {
    const kit = kitWithFlags([{}, {}, {}, {}])
    expect(VOICE_INDICES.map((i) => isChannelAudible(kit, i))).toEqual([true, true, true, true])
    expect(isSoloing(kit)).toBe(false)
  })

  test('a muted channel does not sound', () => {
    const kit = kitWithFlags([{ muted: true }, {}, {}, {}])
    expect(VOICE_INDICES.map((i) => isChannelAudible(kit, i))).toEqual([false, true, true, true])
  })

  test('one solo silences every channel that is not soloed', () => {
    const kit = kitWithFlags([{}, { soloed: true }, {}, {}])
    expect(VOICE_INDICES.map((i) => isChannelAudible(kit, i))).toEqual([false, true, false, false])
    expect(isSoloing(kit)).toBe(true)
  })

  test('several solos all sound together', () => {
    // The whole point of allowing more than one: soloing is additive, not exclusive.
    const kit = kitWithFlags([{ soloed: true }, {}, { soloed: true }, {}])
    expect(VOICE_INDICES.map((i) => isChannelAudible(kit, i))).toEqual([true, false, true, false])
  })

  test('solo beats mute on the same channel', () => {
    // Pressing solo on a muted channel is the more specific intent, and a solo that
    // produced silence would look broken.
    const kit = kitWithFlags([{ muted: true, soloed: true }, {}, {}, {}])
    expect(isChannelAudible(kit, 1)).toBe(true)
  })

  test('releasing the last solo restores the mutes underneath it', () => {
    const kit = kitWithFlags([{ muted: true }, { soloed: true }, {}, {}])
    expect(VOICE_INDICES.map((i) => isChannelAudible(kit, i))).toEqual([false, true, false, false])

    kit.voices[1]!.soloed = false
    expect(VOICE_INDICES.map((i) => isChannelAudible(kit, i))).toEqual([false, true, true, true])
  })

  test('muting every channel is allowed and silences everything', () => {
    const kit = kitWithFlags([{ muted: true }, { muted: true }, { muted: true }, { muted: true }])
    expect(VOICE_INDICES.some((i) => isChannelAudible(kit, i))).toBe(false)
  })
})

describe('per-sample random mute', () => {
  /** What Random mode would draw from, mirroring the filter in player.ts. */
  function eligible(kit: Kit, index: number): string[] {
    const voice = kit.voices[index]!
    return activeLayers(voice).filter((id) => !kit.samples[id]?.randomMuted)
  }

  function kitWithSamples(names: string[]): Kit {
    const kit = createKit('A0')
    names.forEach((name) => {
      kit.samples[name] = {
        id: name,
        name: `${name}.wav`,
        meta: wavMeta({}),
        converted: true,
        status: 'ready',
      }
      kit.voices[0]!.layers.push(makeSlot(name))
    })
    return kit
  }

  test('an unmuted voice draws from every layer', () => {
    expect(eligible(kitWithSamples(['a', 'b', 'c']), 0)).toEqual(['a', 'b', 'c'])
  })

  test('a muted sample is removed from the draw, shifting the odds onto the rest', () => {
    const kit = kitWithSamples(['a', 'b', 'c'])
    kit.samples.b!.randomMuted = true
    // Two candidates rather than three, so each of the survivors goes from 1/3 to 1/2.
    expect(eligible(kit, 0)).toEqual(['a', 'c'])
  })

  test('muting every sample leaves nothing to draw, which is silence not a crash', () => {
    const kit = kitWithSamples(['a', 'b'])
    for (const id of ['a', 'b']) kit.samples[id]!.randomMuted = true
    expect(eligible(kit, 0)).toEqual([])
  })

  test('the flag lives on the sample, so it survives a mode change', () => {
    // Cyclic and manual ignore it entirely; coming back to Random must find it again.
    const kit = kitWithSamples(['a', 'b'])
    kit.samples.a!.randomMuted = true

    kit.voices[0]!.previewMode = 'cyclic'
    expect(activeLayers(kit.voices[0]!)).toEqual(['a', 'b'])

    kit.voices[0]!.previewMode = 'random'
    expect(eligible(kit, 0)).toEqual(['b'])
  })

  test('a muted sample is still a layer, so it still exports', () => {
    // Preview-only by design: the device has no muted layer, and dropping it from the card
    // would make mute indistinguishable from delete.
    const kit = kitWithSamples(['a', 'b'])
    kit.samples.a!.randomMuted = true
    expect(activeLayers(kit.voices[0]!)).toEqual(['a', 'b'])
  })
})

describe('duplicate slots: probability and cyclic sequencing', () => {
  function kitWith(entries: string[]): Kit {
    const kit = createKit('A0')
    for (const id of new Set(entries)) {
      kit.samples[id] = { id, name: `${id}.wav`, meta: wavMeta({}), converted: true, status: 'ready' }
    }
    kit.voices[0]!.layers = entries.map(makeSlot)
    return kit
  }

  test("a sample's weight is how many slots it holds", () => {
    const voice = kitWith(['a', 'a', 'b']).voices[0]!
    expect(slotWeight(voice, 'a')).toBe(2)
    expect(slotWeight(voice, 'b')).toBe(1)
    expect(freeSlotCount(voice)).toBe(9)
  })

  test('probability is the slot share, matching the hardware trick it mimics', () => {
    // Two copies of A and one of B is the 66/33 you would get by writing A to the card
    // twice — which is the only way the device can be made to weight a layer at all.
    const kit = kitWith(['a', 'a', 'b'])
    const voice = kit.voices[0]!
    expect(selectionProbability(kit, voice, 'a')).toBeCloseTo(2 / 3, 5)
    expect(selectionProbability(kit, voice, 'b')).toBeCloseTo(1 / 3, 5)
  })

  test('a muted sample has no chance, and its share goes to the others', () => {
    const kit = kitWith(['a', 'a', 'b'])
    kit.samples.a!.randomMuted = true
    expect(selectionProbability(kit, kit.voices[0]!, 'a')).toBe(0)
    expect(selectionProbability(kit, kit.voices[0]!, 'b')).toBe(1)
  })

  test('raising a weight inserts copies beside the sample, not at the end', () => {
    // Position is the sequence in Cyclic mode, so a duplicated sample has to stay together
    // rather than scatter to the bottom of the list.
    const kit = kitWith(['a', 'b'])
    setSlotWeight(kit.voices[0]!, 'a', 3)
    expect(sampleIdsOf(kit.voices[0]!)).toEqual(['a', 'a', 'a', 'b'])
  })

  test('lowering a weight trims from the end, keeping the original slot', () => {
    const kit = kitWith(['a', 'a', 'a', 'b'])
    const firstSlot = kit.voices[0]!.layers[0]!.id
    setSlotWeight(kit.voices[0]!, 'a', 1)
    expect(sampleIdsOf(kit.voices[0]!)).toEqual(['a', 'b'])
    expect(kit.voices[0]!.layers[0]!.id).toBe(firstSlot)
  })

  test('a weight cannot be raised past the free slots', () => {
    // Twelve is the device's budget, and it is spent in slots.
    const kit = kitWith(['a', 'b'])
    setSlotWeight(kit.voices[0]!, 'a', 99)
    expect(kit.voices[0]!.layers).toHaveLength(12)
    expect(slotWeight(kit.voices[0]!, 'a')).toBe(11)
    expect(freeSlotCount(kit.voices[0]!)).toBe(0)
  })

  test('a weight cannot go below one, since that is deletion not a weighting', () => {
    const kit = kitWith(['a', 'b'])
    setSlotWeight(kit.voices[0]!, 'a', 0)
    expect(slotWeight(kit.voices[0]!, 'a')).toBe(1)
  })

  test('a full voice cannot be reweighted at all', () => {
    const kit = kitWith(Array.from({ length: 12 }, (_, i) => `s${i}`))
    expect(availableWeights(kit.voices[0]!, 's0')).toEqual([1])
  })

  test('the offered weights are one up to whatever is free', () => {
    const kit = kitWith(['a', 'a', 'b'])
    // a holds 2 and 9 are free, so 1..11.
    expect(availableWeights(kit.voices[0]!, 'a')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  test('duplicating a slot inserts a copy directly after it', () => {
    const kit = kitWith(['a', 'b', 'c'])
    const second = kit.voices[0]!.layers[1]!.id
    duplicateSlotAt(kit.voices[0]!, second)
    expect(sampleIdsOf(kit.voices[0]!)).toEqual(['a', 'b', 'b', 'c'])
  })

  test('duplicating does nothing when the twelve slots are spent', () => {
    const kit = kitWith(Array.from({ length: 12 }, (_, i) => `s${i}`))
    duplicateSlotAt(kit.voices[0]!, kit.voices[0]!.layers[0]!.id)
    expect(kit.voices[0]!.layers).toHaveLength(12)
  })

  test('every slot gets its own id, so two copies stay distinguishable', () => {
    // React keys and drag-and-drop both depend on this; sharing an id would make the two
    // rows the same row.
    const kit = kitWith(['a'])
    setSlotWeight(kit.voices[0]!, 'a', 3)
    const ids = kit.voices[0]!.layers.map((slot) => slot.id)
    expect(new Set(ids).size).toBe(3)
  })

  test('collapsing keeps one slot per sample in first-appearance order', () => {
    const kit = kitWith(['b', 'a', 'b', 'c', 'a'])
    collapseDuplicateSlots(kit.voices[0]!)
    expect(sampleIdsOf(kit.voices[0]!)).toEqual(['b', 'a', 'c'])
  })

  test('collapsing an already-unique list changes nothing', () => {
    const kit = kitWith(['a', 'b'])
    collapseDuplicateSlots(kit.voices[0]!)
    expect(sampleIdsOf(kit.voices[0]!)).toEqual(['a', 'b'])
  })

  test('distinct samples is the list the UI counts, slots is what the device loads', () => {
    const voice = kitWith(['a', 'a', 'a', 'b']).voices[0]!
    expect(distinctSamples(voice)).toEqual(['a', 'b'])
    expect(activeLayers(voice)).toEqual(['a', 'a', 'a', 'b'])
  })
})

describe('grouping the rows that hold one sample', () => {
  function voiceWith(entries: string[]): Voice {
    const voice = createVoice(1)
    voice.layers = entries.map(makeSlot)
    return voice
  }

  test('only duplicated samples are grouped', () => {
    // A marker on the sole copy of a sample would say nothing.
    const groups = slotGroups(voiceWith(['a', 'a', 'b', 'c', 'c']))
    expect([...groups.keys()].sort()).toEqual(['a', 'c'])
    expect(groups.has('b')).toBe(false)
  })

  test('groups are numbered in first-appearance order', () => {
    const groups = slotGroups(voiceWith(['c', 'c', 'a', 'a']))
    expect(groups.get('c')).toBe(1)
    expect(groups.get('a')).toBe(2)
  })

  test('a voice with nothing duplicated groups nothing', () => {
    expect(slotGroups(voiceWith(['a', 'b', 'c'])).size).toBe(0)
  })

  test('colours cycle rather than running out', () => {
    // Six duplicated samples is the most twelve slots can hold, and there are four colours.
    const entries = ['a', 'a', 'b', 'b', 'c', 'c', 'd', 'd', 'e', 'e', 'f', 'f']
    const groups = slotGroups(voiceWith(entries))
    expect(groups.size).toBe(6)
    expect([...groups.values()]).toEqual([1, 2, 3, 4, 1, 2])
  })

  test('a slot knows which copy it is, even after the rows are dragged apart', () => {
    // Cyclic mode exists to separate them, so the position must be computed from the list
    // rather than assumed contiguous.
    const voice = voiceWith(['a', 'b', 'a', 'b', 'a'])
    const aSlots = voice.layers.filter((s) => s.sampleId === 'a').map((s) => s.id)
    expect(aSlots.map((id) => slotCopyPosition(voice, id))).toEqual([
      { copy: 1, of: 3 },
      { copy: 2, of: 3 },
      { copy: 3, of: 3 },
    ])
  })

  test('a lone sample reports itself as the only copy', () => {
    const voice = voiceWith(['a'])
    expect(slotCopyPosition(voice, voice.layers[0]!.id)).toEqual({ copy: 1, of: 1 })
  })
})

describe('size formatting', () => {
  test('scales through the units a storage readout actually spans', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(2048)).toBe('2 KB')
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB')
    // The quota readout is the reason gigabytes exist here at all.
    expect(formatSize(2 * 1024 * 1024 * 1024)).toBe('2.00 GB')
  })

  test('the megabyte-to-gigabyte boundary does not read as 1024 MB', () => {
    expect(formatSize(1024 * 1024 * 1024 - 1)).toContain('MB')
    expect(formatSize(1024 * 1024 * 1024)).toBe('1.00 GB')
  })
})
