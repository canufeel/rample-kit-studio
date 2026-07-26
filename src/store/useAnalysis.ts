import { create } from 'zustand'
import { analyseSample } from '~/analysis/runner'
import type { AudioFeatures } from '~/analysis/features'
import type { SampleId } from '~/domain/types'

/**
 * Analysis results for the samples currently open, and the queue that fills them in.
 *
 * Kept out of the session store deliberately. This is derived data: it is rebuilt from the
 * audio whenever it is missing, it must never make the session dirty, and it must never
 * end up in an undo step. Holding it here means none of that has to be remembered at every
 * call site in the session store.
 */

interface AnalysisState {
  features: Record<SampleId, AudioFeatures>
  /** Ids queued or in flight, so the UI can show progress and callers can avoid re-queuing. */
  queue: SampleId[]
  running: boolean
  /** Ids that produced nothing, so a failure is not retried on every render. */
  failed: Record<SampleId, true>

  /** Queue anything not already known, analysed or failed. Returns immediately. */
  request: (ids: readonly SampleId[]) => void
  /** Drop everything for samples that are no longer open. */
  forget: (ids: readonly SampleId[]) => void
}

export const useAnalysis = create<AnalysisState>((set, get) => ({
  features: {},
  queue: [],
  running: false,
  failed: {},

  request: (ids) => {
    const { features, failed, queue } = get()
    const queued = new Set(queue)
    const wanted = ids.filter((id) => !features[id] && !failed[id] && !queued.has(id))
    if (wanted.length === 0) return

    set((state) => ({ queue: [...state.queue, ...wanted] }))
    if (!get().running) void drain(set, get)
  },

  forget: (ids) => {
    if (ids.length === 0) return
    set((state) => {
      const features = { ...state.features }
      const failed = { ...state.failed }
      for (const id of ids) {
        delete features[id]
        delete failed[id]
      }
      return { features, failed }
    })
  },
}))

/**
 * Work the queue to empty, one sample at a time.
 *
 * A single loop rather than a per-item promise chain, so the "is something running" flag
 * has exactly one owner and re-entrancy is impossible.
 */
async function drain(
  set: (partial: Partial<AnalysisState>) => void,
  get: () => AnalysisState,
): Promise<void> {
  set({ running: true })
  try {
    for (;;) {
      const next = get().queue[0]
      if (next === undefined) break

      let features: AudioFeatures | null = null
      try {
        features = await analyseSample(next)
      } catch {
        features = null
      }

      set(
        features
          ? {
              features: { ...get().features, [next]: features },
              queue: get().queue.slice(1),
            }
          : {
              failed: { ...get().failed, [next]: true },
              queue: get().queue.slice(1),
            },
      )
    }
  } finally {
    set({ running: false })
  }
}

/** Features for one sample, or undefined while it is still unknown. */
export function useFeatures(id: SampleId): AudioFeatures | undefined {
  return useAnalysis((s) => s.features[id])
}

/** How many samples are still waiting, for a progress readout. */
export function useAnalysisPending(): number {
  return useAnalysis((s) => s.queue.length)
}
