import { describe, expect, test } from 'bun:test'
import { countLayers, planCardImport, resolveCode } from './cardImport'
import type { PickedFile } from './cardImport'

/** A picked file, as a directory pick hands it over. */
function at(path: string): PickedFile {
  return { name: path.split('/').pop()!, webkitRelativePath: path }
}

/** Layer filenames of one kit in the plan, in the order the device would sort them. */
function layers(plan: ReturnType<typeof planCardImport<PickedFile>>, code: string): string[] {
  return plan.kits.find((k) => k.code === code)!.layers.map((l) => l.file.name)
}

describe('reading a card', () => {
  test('groups files by kit folder and voice digit', () => {
    const plan = planCardImport([
      at('CARD/A0/1 KICK 01.wav'),
      at('CARD/A0/2 SNARE 01.wav'),
      at('CARD/A0/1 KICK 02.wav'),
      at('CARD/B7/4 HAT.wav'),
    ])

    expect(plan.kits.map((k) => k.code)).toEqual(['A0', 'B7'])
    expect(layers(plan, 'A0')).toEqual(['1 KICK 01.wav', '1 KICK 02.wav', '2 SNARE 01.wav'])
    expect(plan.kits.find((k) => k.code === 'A0')!.layers.map((l) => l.voice)).toEqual([1, 1, 2])
    expect(countLayers(plan)).toBe(4)
  })

  test('a single kit folder picked on its own works too', () => {
    const plan = planCardImport([at('A0/1 kick.wav'), at('A0/3 hat.wav')])
    expect(plan.kits.map((k) => k.code)).toEqual(['A0'])
    expect(countLayers(plan)).toBe(2)
  })

  test('the deepest kit-looking folder wins, so nesting cannot confuse it', () => {
    const plan = planCardImport([at('B2/backup/A0/1 kick.wav')])
    expect(plan.kits.map((k) => k.code)).toEqual(['A0'])
  })

  test('layer order is numeric, not lexicographic', () => {
    // The device sorts "numerically and alphabetically", so 10 must follow 2, not precede it.
    const plan = planCardImport([
      at('A0/1 hit 10.wav'),
      at('A0/1 hit 2.wav'),
      at('A0/1 hit 1.wav'),
    ])
    expect(layers(plan, 'A0')).toEqual(['1 hit 1.wav', '1 hit 2.wav', '1 hit 10.wav'])
  })

  test('kits come back in card order', () => {
    const plan = planCardImport([
      at('C10/1 a.wav'),
      at('C2/1 a.wav'),
      at('A0/1 a.wav'),
      at('B1/1 a.wav'),
    ])
    expect(plan.kits.map((k) => k.code)).toEqual(['A0', 'B1', 'C2', 'C10'])
  })

  test('the factory card has more than twelve layers on some voices', () => {
    // Not an error: everything past the device's twelve lands in the queue, and the import
    // must not silently drop it.
    const many = Array.from({ length: 18 }, (_, i) => at(`A0/1 kick ${i + 1}.wav`))
    expect(countLayers(planCardImport(many))).toBe(18)
  })
})

describe('what a card contains besides samples', () => {
  test('the credits files at the card root are skipped, not failed', () => {
    const plan = planCardImport([at('CARD/A - ALWIS.rtf'), at('CARD/A0/1 kick.wav')])
    expect(countLayers(plan)).toBe(1)
    expect(plan.skipped).toEqual([{ path: 'CARD/A - ALWIS.rtf', reason: 'notAudio' }])
  })

  test("the device's own save folder is skipped", () => {
    // `_save` is not a kit code, so nothing inside it can be mistaken for a kit.
    const plan = planCardImport([at('CARD/_save/autosave_K2.rpl'), at('CARD/K2/1 kick.wav')])
    expect(plan.kits.map((k) => k.code)).toEqual(['K2'])
    expect(plan.skipped.map((s) => s.reason)).toEqual(['notAudio'])
  })

  test('macOS metadata is skipped', () => {
    const plan = planCardImport([at('CARD/A0/.DS_Store'), at('CARD/.DS_Store')])
    expect(plan.kits).toEqual([])
    expect(plan.skipped).toHaveLength(2)
  })

  test('audio outside any kit folder is reported as such', () => {
    const plan = planCardImport([at('CARD/loose.wav')])
    expect(plan.skipped).toEqual([{ path: 'CARD/loose.wav', reason: 'notInKitFolder' }])
  })

  test('audio in a kit folder without a leading voice digit is reported as such', () => {
    const plan = planCardImport([at('CARD/A0/kick.wav'), at('CARD/A0/5 nope.wav')])
    expect(plan.kits).toEqual([])
    expect(plan.skipped.map((s) => s.reason)).toEqual(['noVoiceDigit', 'noVoiceDigit'])
  })

  test('a lowercase bank letter is not a kit folder', () => {
    // Kit codes are upper case on the device; treating `a0` as `A0` would invent a kit.
    expect(planCardImport([at('CARD/a0/1 kick.wav')]).skipped[0]!.reason).toBe('notInKitFolder')
  })

  test('an empty pick plans nothing', () => {
    expect(planCardImport([])).toEqual({ kits: [], skipped: [] })
  })
})

describe('reconciling incoming codes with what is already open', () => {
  const empty = { id: 'k1', code: 'A0', sampleCount: 0 }
  const full = { id: 'k2', code: 'A0', sampleCount: 6 }

  test('a code nobody is using is taken as-is', () => {
    expect(resolveCode('B7', [empty], new Set())).toEqual({ kind: 'fresh', code: 'B7' })
  })

  test('an empty kit with the same code is taken over', () => {
    // A fresh session is always holding one empty A0, and that is exactly what the user
    // means to replace when importing a card that has an A0 on it.
    expect(resolveCode('A0', [empty], new Set())).toEqual({
      kind: 'takeover',
      code: 'A0',
      kitId: 'k1',
    })
  })

  test('a kit with samples in it is never overwritten', () => {
    expect(resolveCode('A0', [full], new Set())).toEqual({
      kind: 'renamed',
      code: 'A1',
      from: 'A0',
    })
  })

  test('renaming stays in the same bank and skips codes already claimed', () => {
    const taken = new Set(['A1', 'A2'])
    expect(resolveCode('A0', [full], taken)).toEqual({ kind: 'renamed', code: 'A3', from: 'A0' })
  })

  test('a full bank spills into the next one rather than refusing', () => {
    const existing = [full]
    const taken = new Set(Array.from({ length: 100 }, (_, n) => `A${n}`))
    const result = resolveCode('A0', existing, taken)
    expect(result.kind).toBe('renamed')
    expect(result.code.startsWith('A')).toBe(false)
  })
})
