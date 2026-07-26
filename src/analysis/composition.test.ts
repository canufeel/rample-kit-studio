import { describe, expect, test } from 'bun:test'
import type { Kit, Sample } from '~/domain/types'
import { createKit, makeSlot } from '~/domain/voice'
import { kitComposition } from './composition'

function sample(name: string): Sample {
  return {
    id: name,
    name,
    meta: {
      container: 'wav',
      codec: 'pcm',
      sampleRate: 44100,
      bitDepth: 16,
      channels: 1,
      durationSec: 1,
      sizeBytes: 100,
    },
    converted: true,
    status: 'ready',
  }
}

/** A kit whose first channel holds exactly these files. */
function kitWith(...names: string[]): Kit {
  const base = createKit('A0')
  return {
    ...base,
    samples: Object.fromEntries(names.map((n) => [n, sample(n)])),
    voices: base.voices.map((v) =>
      v.index === 1 ? { ...v, layers: names.map((n) => makeSlot(n)) } : v,
    ),
  }
}

describe('mixed families on one channel', () => {
  test('a kick and a hi-hat together is worth saying', () => {
    const notes = kitComposition(kitWith('1 KICK 01.wav', '2 HH close.wav'))
    expect(notes).toHaveLength(1)
    expect(notes[0]!.code).toBe('mixedFamilies')
    expect(notes[0]!.message).toContain('kicks')
    expect(notes[0]!.message).toContain('hi-hats')
  })

  test('the note explains the hardware consequence, not just the mix', () => {
    // The whole reason this warning exists: one layer sounds per trigger, so the two do
    // not stack. Without that sentence the note is just an opinion about taste.
    const [note] = kitComposition(kitWith('1 KICK 01.wav', '2 HH close.wav'))
    expect(note!.message).toContain('one layer sounds per trigger')
  })

  test('several of the same instrument is the normal case and says nothing', () => {
    expect(kitComposition(kitWith('1 KICK 01.wav', '1 BD lg 6.wav', '2 MM_KICK_808.wav'))).toEqual(
      [],
    )
  })

  test('near neighbours are one family', () => {
    // A snare, a clap and a rimshot on one channel is a snare layer set, not a mistake.
    expect(kitComposition(kitWith('2 SN 01.wav', '3 CP 02.wav', '2 rimshot.wav'))).toEqual([])
    // As are a hat and a ride — both metal.
    expect(kitComposition(kitWith('3 HH close.wav', '3 RIDE LOW 03.wav'))).toEqual([])
  })

  test('fx and loops are wildcards and never trip it', () => {
    // Layering a sweep under a kick is a technique, not an accident.
    expect(kitComposition(kitWith('1 KICK 01.wav', '3. FX 1.wav'))).toEqual([])
    expect(kitComposition(kitWith('1 KICK 01.wav', '1. 175bpm Break one.wav'))).toEqual([])
  })

  test('untagged samples cannot trigger it', () => {
    expect(kitComposition(kitWith('1 KICK 01.wav', '4 JUPI.wav'))).toEqual([])
  })

  test('a low-confidence guess is not evidence enough to warn on', () => {
    // `bar` scores 0.5 as a loop and `cy` 0.7 as a cymbal; neither should be able to tell
    // someone their channel is wrong.
    expect(kitComposition(kitWith('1 KICK 01.wav', '3 bar 2.wav'))).toEqual([])
  })

  test('a channel with one sample is never mixed', () => {
    expect(kitComposition(kitWith('1 KICK 01.wav'))).toEqual([])
  })

  test('an empty kit produces nothing', () => {
    expect(kitComposition(createKit('A0'))).toEqual([])
  })

  test('the note names the channel it is about, by identity', () => {
    const kit = kitWith('1 KICK 01.wav', '2 HH close.wav')
    const named = { ...kit, voices: kit.voices.map((v) => (v.index === 1 ? { ...v, name: 'DRUMS' } : v)) }
    const [note] = kitComposition(named)
    expect(note!.voice).toBe(1)
    expect(note!.message).toStartWith('DRUMS mixes')
  })

  test('three families are all listed', () => {
    const [note] = kitComposition(kitWith('1 KICK 01.wav', '2 SN 01.wav', '3 HH close.wav'))
    expect(note!.message).toContain('kicks, snares and hi-hats')
  })
})
