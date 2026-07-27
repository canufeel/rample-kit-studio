import { beforeEach, describe, expect, mock, test } from 'bun:test'

/**
 * The queue, with the actual analysis stubbed out.
 *
 * Everything below the store — decode, worker, IndexedDB — needs a browser, and none of it
 * is what goes wrong here. What goes wrong here is queue bookkeeping: analysing the same
 * sample twice, retrying a failure on every render, or two drains running at once.
 */

let calls: string[] = []
let behaviour: (id: string) => Promise<unknown> = async () => ({ ok: true })

void mock.module('~/analysis/runner', () => ({
  analyseSample: (id: string) => {
    calls.push(id)
    return behaviour(id)
  },
}))

const { useAnalysis } = await import('./useAnalysis')

/** Let the drain loop run to completion. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const fakeFeatures = (id: string) => ({ version: 1, id }) as never

beforeEach(() => {
  calls = []
  behaviour = async (id) => fakeFeatures(id)
  useAnalysis.setState({ features: {}, queue: [], burstTotal: 0, running: false, failed: {} })
})

describe('queueing', () => {
  test('analyses each requested sample once', async () => {
    useAnalysis.getState().request(['a', 'b'])
    await settle()

    expect(calls).toEqual(['a', 'b'])
    expect(Object.keys(useAnalysis.getState().features).sort()).toEqual(['a', 'b'])
  })

  test('a repeated request does not analyse again', async () => {
    useAnalysis.getState().request(['a'])
    await settle()
    useAnalysis.getState().request(['a'])
    await settle()

    expect(calls).toEqual(['a'])
  })

  test('requesting the same id twice before it runs queues it once', async () => {
    // The panel re-renders freely, so this is the common case, not an edge one.
    useAnalysis.getState().request(['a'])
    useAnalysis.getState().request(['a', 'b'])
    await settle()

    expect(calls).toEqual(['a', 'b'])
  })

  test('a request arriving mid-drain is picked up by the running loop', async () => {
    useAnalysis.getState().request(['a'])
    useAnalysis.getState().request(['b'])
    await settle()

    expect(calls).toEqual(['a', 'b'])
    expect(useAnalysis.getState().queue).toEqual([])
  })

  test('the queue empties and the loop stops', async () => {
    useAnalysis.getState().request(['a', 'b', 'c'])
    await settle()

    expect(useAnalysis.getState().queue).toEqual([])
    expect(useAnalysis.getState().running).toBe(false)
  })
})

describe('failure', () => {
  test('a sample that yields nothing is recorded, not retried', async () => {
    behaviour = async () => null
    useAnalysis.getState().request(['a'])
    await settle()

    expect(useAnalysis.getState().failed.a).toBe(true)

    // Without the failure record this would re-analyse on every panel render.
    useAnalysis.getState().request(['a'])
    await settle()
    expect(calls).toEqual(['a'])
  })

  test('a thrown error does not stall the queue behind it', async () => {
    behaviour = async (id) => {
      if (id === 'a') throw new Error('boom')
      return fakeFeatures(id)
    }
    useAnalysis.getState().request(['a', 'b'])
    await settle()

    expect(useAnalysis.getState().failed.a).toBe(true)
    expect(useAnalysis.getState().features.b).toBeDefined()
    expect(useAnalysis.getState().running).toBe(false)
  })
})

describe('progress', () => {
  test('the denominator counts the whole burst, not what is left', async () => {
    // Recorded rather than asserted in place: an expectation thrown inside the stub would
    // be caught by the drain loop's own try/catch and the test would pass regardless.
    const seen: number[] = []
    behaviour = async (id) => {
      seen.push(useAnalysis.getState().burstTotal)
      return fakeFeatures(id)
    }
    useAnalysis.getState().request(['a', 'b', 'c'])
    await settle()

    expect(seen).toEqual([3, 3, 3])
  })

  test('a request arriving mid-burst raises the denominator', async () => {
    useAnalysis.getState().request(['a', 'b'])
    useAnalysis.getState().request(['c'])
    expect(useAnalysis.getState().burstTotal).toBe(3)
    await settle()
  })

  test('it resets once the queue empties, so the next burst counts from zero', async () => {
    useAnalysis.getState().request(['a', 'b'])
    await settle()
    expect(useAnalysis.getState().burstTotal).toBe(0)

    useAnalysis.getState().request(['c'])
    expect(useAnalysis.getState().burstTotal).toBe(1)
    await settle()
  })

  test('a request that queues nothing new does not move the denominator', async () => {
    useAnalysis.getState().request(['a'])
    await settle()
    useAnalysis.getState().request(['a'])
    expect(useAnalysis.getState().burstTotal).toBe(0)
  })
})
