import { beforeEach, describe, expect, test } from 'bun:test'
import { MAX_KITS_PER_SESSION, storageLevel } from '~/domain/limits'
import { makeSlot } from '~/domain/voice'
import { useSession } from './useSession'

/**
 * Store-level behaviour that the pure domain tests cannot reach: the kit ceiling, and the
 * reversibility of deleting a layer row.
 *
 * The store imports the audio modules, but none of them touch an AudioContext at import
 * time — the graph is built lazily on first sound — so this runs without a browser.
 */

/** A fresh session, since the store is a module singleton shared across tests. */
function reset(): void {
  useSession.setState(
    {
      ...useSession.getInitialState(),
      notices: [],
    },
    true,
  )
}

beforeEach(reset)

describe('the kit ceiling', () => {
  test('kits can be added up to the limit', () => {
    while (useSession.getState().kits.length < MAX_KITS_PER_SESSION) useSession.getState().addKit()
    expect(useSession.getState().kits).toHaveLength(MAX_KITS_PER_SESSION)
  })

  test('adding past the limit does nothing at all', () => {
    while (useSession.getState().kits.length < MAX_KITS_PER_SESSION) useSession.getState().addKit()
    const before = useSession.getState().activeKitId

    useSession.getState().addKit()

    // Not merely capped in the UI: the store refuses, so no other caller can slip past it,
    // and the active kit does not jump to a kit that was never created.
    expect(useSession.getState().kits).toHaveLength(MAX_KITS_PER_SESSION)
    expect(useSession.getState().activeKitId).toBe(before)
  })
})

describe('deleting a layer row is reversible', () => {
  /** Put three slots on SP1 of the active kit, two of them the same sample. */
  function seed(): { kitId: string; slotIds: string[] } {
    const state = useSession.getState()
    const kit = state.kits[0]!
    const slots = [makeSlot('a'), makeSlot('b'), makeSlot('a')]
    useSession.setState({
      kits: [
        {
          ...kit,
          samples: {
            a: { id: 'a', name: 'a.wav', meta: meta(), converted: true, status: 'ready' },
            b: { id: 'b', name: 'b.wav', meta: meta(), converted: true, status: 'ready' },
          },
          voices: kit.voices.map((v) => (v.index === 1 ? { ...v, layers: slots } : v)),
        },
      ],
    })
    return { kitId: kit.id, slotIds: slots.map((s) => s.id) }
  }

  function meta() {
    return {
      container: 'wav' as const,
      codec: 'pcm' as const,
      sampleRate: 44100,
      bitDepth: 16,
      channels: 1,
      durationSec: 1,
      sizeBytes: 100,
    }
  }

  const layersOf = () =>
    useSession.getState().kits[0]!.voices.find((v) => v.index === 1)!.layers

  test('removing a slot leaves the others, including other copies of the same sample', () => {
    const { slotIds } = seed()
    useSession.getState().removeSlot(1, slotIds[0]!)

    expect(layersOf().map((s) => s.sampleId)).toEqual(['b', 'a'])
  })

  test('the sample survives while another slot still holds it', () => {
    const { slotIds } = seed()
    useSession.getState().removeSlot(1, slotIds[0]!)
    expect(useSession.getState().kits[0]!.samples.a).toBeDefined()
  })

  test('an undo offer is attached to the notice', () => {
    const { slotIds } = seed()
    useSession.getState().removeSlot(1, slotIds[0]!)

    const notice = useSession.getState().notices.at(-1)!
    expect(notice.message).toContain('a.wav')
    expect(notice.action?.label).toBe('Undo')
  })

  test('undo puts the row back where it was, not on the end', () => {
    const { slotIds } = seed()
    // Remove the middle row, so restoring to the end would be visibly wrong.
    useSession.getState().removeSlot(1, slotIds[1]!)
    expect(layersOf().map((s) => s.sampleId)).toEqual(['a', 'a'])

    useSession.getState().notices.at(-1)!.action!.run()
    expect(layersOf().map((s) => s.sampleId)).toEqual(['a', 'b', 'a'])
    expect(layersOf().map((s) => s.id)).toEqual(slotIds)
  })

  test('undo pressed twice does not duplicate the row', () => {
    const { slotIds } = seed()
    useSession.getState().removeSlot(1, slotIds[1]!)
    const undo = useSession.getState().notices.at(-1)!.action!

    undo.run()
    undo.run()

    expect(layersOf()).toHaveLength(3)
  })

  test('undo against a kit that has since been deleted is a no-op, not a crash', () => {
    const { kitId, slotIds } = seed()
    // Remove the row first — adding a kit makes the new one active, which would send the
    // removal to the wrong kit.
    useSession.getState().removeSlot(1, slotIds[0]!)
    const undo = useSession.getState().notices.at(-1)!.action!

    // A second kit, so the first can be deleted at all.
    useSession.getState().addKit()
    useSession.getState().removeKit(kitId)

    expect(() => undo.run()).not.toThrow()
    expect(useSession.getState().kits.some((k) => k.id === kitId)).toBe(false)
  })
})

describe('storage thresholds', () => {
  test('below three quarters is unremarkable', () => {
    expect(storageLevel(0)).toBe('ok')
    expect(storageLevel(0.5)).toBe('ok')
    expect(storageLevel(0.7499)).toBe('ok')
  })

  test('three quarters warns', () => {
    expect(storageLevel(0.75)).toBe('warn')
    expect(storageLevel(0.89)).toBe('warn')
  })

  test('ninety percent is critical', () => {
    expect(storageLevel(0.9)).toBe('critical')
    expect(storageLevel(1)).toBe('critical')
  })
})
