import { describe, expect, test } from 'bun:test'
import type { AudioMeta, Kit, Sample } from '~/domain/types'
import { hasBlockingWarning, kitWarnings } from '~/domain/validation'
import { createKit, makeSlot, setSlotWeight } from '~/domain/voice'
import { planFiles } from './buildKit'

const validMeta: AudioMeta = {
  container: 'wav',
  codec: 'pcm',
  sampleRate: 44100,
  bitDepth: 16,
  channels: 1,
  durationSec: 1,
  sizeBytes: 1000,
}

/** Add a sample to a voice and return its id. */
function addSample(kit: Kit, voice: number, name: string, meta: AudioMeta = validMeta): string {
  const id = `id-${name}-${voice}-${Math.round(meta.durationSec * 1e6)}-${kit.voices[voice - 1]!.layers.length}`
  const sample: Sample = { id, name, meta, converted: true, status: 'ready' }
  kit.samples[id] = sample
  kit.voices[voice - 1]!.layers.push(makeSlot(id))
  return id
}

describe('planFiles', () => {
  test('names files with the voice digit first and a padded slot', () => {
    const kit = createKit('A0')
    addSample(kit, 1, 'kick.wav')
    addSample(kit, 1, 'snare.wav')

    const { files } = planFiles(kit)
    expect(files.map((f) => f.filename)).toEqual(['1-01_kick.wav', '1-02_snare.wav'])
    expect(files.map((f) => f.path)).toEqual(['A0/1-01_kick.wav', 'A0/1-02_snare.wav'])
  })

  test('slot numbering closes up around a skipped invalid sample', () => {
    // A hole in the sequence would still sort correctly, but the numbering is meant to
    // describe layer order on the device — 01, 03, 04 misrepresents it.
    const kit = createKit('A0')
    addSample(kit, 1, 'good1.wav')
    addSample(kit, 1, 'bad.wav', { ...validMeta, sampleRate: 48000 })
    addSample(kit, 1, 'good2.wav')

    const { files, excluded } = planFiles(kit)
    expect(files.map((f) => f.filename)).toEqual(['1-01_good1.wav', '1-02_good2.wav'])
    expect(excluded).toEqual([
      { slot: 1, channelName: 'CH1', sourceName: 'bad.wav', reason: 'invalid' },
    ])
  })

  test('queued layers past the 12-layer cap are excluded, not renamed', () => {
    const kit = createKit('A0')
    for (let i = 0; i < 14; i++) addSample(kit, 1, `s${i}.wav`)

    const { files, excluded } = planFiles(kit)
    expect(files).toHaveLength(12)
    expect(files[11]!.filename).toBe('1-12_s11.wav')
    expect(excluded.filter((e) => e.reason === 'queued')).toHaveLength(2)
  })

  test('each voice numbers its slots independently', () => {
    const kit = createKit('B7')
    addSample(kit, 1, 'kick.wav')
    addSample(kit, 3, 'hat.wav')

    const { files } = planFiles(kit)
    expect(files.map((f) => f.filename)).toEqual(['1-01_kick.wav', '3-01_hat.wav'])
  })

  test('a stereo voice accepts 2-channel samples and rejects mono ones', () => {
    const kit = createKit('A0')
    kit.voices[0]!.mode = 'stereo'
    addSample(kit, 1, 'wide.wav', { ...validMeta, channels: 2 })
    addSample(kit, 1, 'narrow.wav', { ...validMeta, channels: 1 })

    const { files, excluded } = planFiles(kit)
    expect(files.map((f) => f.filename)).toEqual(['1-01_wide.wav'])
    expect(excluded[0]!.sourceName).toBe('narrow.wav')
  })

  test('source names are slugified on the way out', () => {
    const kit = createKit('A0')
    addSample(kit, 1, 'Kick (Deep) #2.wav')
    expect(planFiles(kit).files[0]!.filename).toBe('1-01_Kick_Deep_2.wav')
  })

  test('an empty kit plans nothing rather than failing', () => {
    expect(planFiles(createKit('A0')).files).toEqual([])
  })
})

describe('kit warnings', () => {
  test('a kit with no valid voice-1 sample is blocked', () => {
    // The manual: "you will not be allowed to open this kit."
    const kit = createKit('A0')
    addSample(kit, 2, 'snare.wav')
    expect(hasBlockingWarning(kitWarnings(kit))).toBe(true)
  })

  test('an invalid voice-1 sample does not satisfy the guard', () => {
    const kit = createKit('A0')
    addSample(kit, 1, 'wrong.wav', { ...validMeta, sampleRate: 22050 })
    expect(hasBlockingWarning(kitWarnings(kit))).toBe(true)
  })

  test('one valid voice-1 sample clears the guard', () => {
    const kit = createKit('A0')
    addSample(kit, 1, 'kick.wav')
    expect(hasBlockingWarning(kitWarnings(kit))).toBe(false)
  })

  test('stereo on a voice whose neighbour is populated warns without blocking', () => {
    const kit = createKit('A0')
    addSample(kit, 1, 'kick.wav')
    kit.voices[2]!.mode = 'stereo'
    addSample(kit, 3, 'wide.wav', { ...validMeta, channels: 2 })
    addSample(kit, 4, 'shadowed.wav')

    const warnings = kitWarnings(kit)
    const adjacency = warnings.find((w) => w.code === 'stereoAdjacency')
    expect(adjacency).toBeDefined()
    expect(adjacency!.voice).toBe(3)
    expect(adjacency!.blocking).toBe(false)
    expect(hasBlockingWarning(warnings)).toBe(false)
  })

  test('stereo on the last voice has no neighbour to occupy', () => {
    const kit = createKit('A0')
    addSample(kit, 1, 'kick.wav')
    kit.voices[3]!.mode = 'stereo'
    addSample(kit, 4, 'wide.wav', { ...validMeta, channels: 2 })

    expect(kitWarnings(kit).some((w) => w.code === 'stereoOnLastVoice')).toBe(true)
  })

  test('stereo with an empty neighbour is not flagged', () => {
    const kit = createKit('A0')
    kit.voices[0]!.mode = 'stereo'
    addSample(kit, 1, 'wide.wav', { ...validMeta, channels: 2 })
    expect(kitWarnings(kit).some((w) => w.code === 'stereoAdjacency')).toBe(false)
  })
})

/**
 * Channel position, not channel identity, is what the device sees.
 *
 * These are the tests that would catch the export silently ignoring a reorder — the whole
 * point of separating identity from slot is that dragging a channel changes what the
 * Rample calls it.
 */
describe('slot order drives the exported voice number', () => {
  test('reordering channels renumbers the files', () => {
    const kit = createKit('A0')
    addSample(kit, 1, 'kick.wav')
    addSample(kit, 3, 'hat.wav')

    // Drag the channel with identity 3 into SP1, pushing 1 into SP2.
    kit.voiceOrder = [3, 1, 2, 4]

    const { files } = planFiles(kit)
    expect(files.map((f) => f.filename).sort()).toEqual(['1-01_hat.wav', '2-01_kick.wav'])
  })

  test('renaming a channel changes nothing about the export', () => {
    const kit = createKit('A0')
    addSample(kit, 1, 'kick.wav')
    const before = planFiles(kit).files.map((f) => f.filename)

    kit.voices[0]!.name = 'Thumper'
    const after = planFiles(kit)

    expect(after.files.map((f) => f.filename)).toEqual(before)
    // …but the plan still reports the name, so the dialog can say where a file came from.
    expect(after.files[0]!.channelName).toBe('Thumper')
    expect(after.files[0]!.slot).toBe(1)
  })

  test('a channel dragged out of SP1 no longer satisfies the voice-1 guard', () => {
    const kit = createKit('A0')
    addSample(kit, 1, 'kick.wav')
    expect(hasBlockingWarning(kitWarnings(kit))).toBe(false)

    // Move the only populated channel to SP2, leaving SP1 empty.
    kit.voiceOrder = [2, 1, 3, 4]
    expect(hasBlockingWarning(kitWarnings(kit))).toBe(true)
  })

  test('stereo adjacency follows slots, not identity', () => {
    const kit = createKit('A0')
    kit.voices[3]!.mode = 'stereo'
    addSample(kit, 4, 'pad.wav')
    addSample(kit, 1, 'kick.wav')

    // Identity 4 sits in SP4 by default, so it has nothing after it to occupy.
    expect(kitWarnings(kit).map((w) => w.code)).toContain('stereoOnLastVoice')

    // Dragged to SP1, the same channel now eats the slot behind it instead.
    kit.voiceOrder = [4, 1, 2, 3]
    const codes = kitWarnings(kit).map((w) => w.code)
    expect(codes).toContain('stereoAdjacency')
    expect(codes).not.toContain('stereoOnLastVoice')
  })

  test('a damaged slot order still exports every channel exactly once', () => {
    const kit = createKit('A0')
    addSample(kit, 1, 'a.wav')
    addSample(kit, 2, 'b.wav')
    addSample(kit, 3, 'c.wav')
    addSample(kit, 4, 'd.wav')

    kit.voiceOrder = [3, 3] as never

    const { files } = planFiles(kit)
    expect(files).toHaveLength(4)
    expect(files.map((f) => f.slot).sort()).toEqual([1, 2, 3, 4])
  })
})

/**
 * Duplicate slots are how both random weighting and cyclic sequencing are expressed, and
 * the card is where they become real: the same sample written more than once. The device has
 * no other way to do either, which is the whole reason the model works this way.
 */
describe('duplicate slots reach the card as duplicate files', () => {
  test('a sample holding three slots is written three times', () => {
    const kit = createKit('A0')
    const id = addSample(kit, 1, 'kick.wav')
    setSlotWeight(kit.voices[0]!, id, 3)

    const { files } = planFiles(kit)
    // Distinct names come free from the layer index, so nothing collides on a FAT card.
    expect(files.map((f) => f.filename)).toEqual([
      '1-01_kick.wav',
      '1-02_kick.wav',
      '1-03_kick.wav',
    ])
    // Every copy points at the same stored audio — one file's bytes, written three times.
    expect(new Set(files.map((f) => f.sampleId)).size).toBe(1)
  })

  test('the cyclic order is preserved in the layer numbering', () => {
    // In Cyclic mode the list order *is* the sequence, so the device must load it in that
    // order — which is what the numeric prefix pins down.
    const kit = createKit('A0')
    const kick = addSample(kit, 1, 'kick.wav')
    const snare = addSample(kit, 1, 'snare.wav')
    kit.voices[0]!.layers = [kick, snare, kick, snare, snare].map(makeSlot)

    expect(planFiles(kit).files.map((f) => f.filename)).toEqual([
      '1-01_kick.wav',
      '1-02_snare.wav',
      '1-03_kick.wav',
      '1-04_snare.wav',
      '1-05_snare.wav',
    ])
  })

  test('a weighted voice still respects the twelve-layer cap', () => {
    const kit = createKit('A0')
    const a = addSample(kit, 1, 'a.wav')
    addSample(kit, 1, 'b.wav')
    setSlotWeight(kit.voices[0]!, a, 11)

    const { files, excluded } = planFiles(kit)
    expect(files).toHaveLength(12)
    expect(excluded).toEqual([])
  })

  test('slots past the cap are excluded as queued, however they got there', () => {
    const kit = createKit('A0')
    const a = addSample(kit, 1, 'a.wav')
    addSample(kit, 1, 'b.wav')
    // Hand-built past the cap, as a drag across the boundary would.
    kit.voices[0]!.layers = [...Array.from({ length: 12 }, () => makeSlot(a)), makeSlot('extra')]
    kit.samples.extra = { id: 'extra', name: 'extra.wav', meta: validMeta, converted: true, status: 'ready' }

    const { files, excluded } = planFiles(kit)
    expect(files).toHaveLength(12)
    expect(excluded).toEqual([
      { slot: 1, channelName: 'CH1', sourceName: 'extra.wav', reason: 'queued' },
    ])
  })
})
