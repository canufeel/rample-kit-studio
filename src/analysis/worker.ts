import { extractFeatures } from './features'

/**
 * Feature extraction, off the main thread.
 *
 * Only the DSP is offloaded. Decoding stays on the main thread because the Web Audio API
 * is not available to workers at all — but `decodeAudioData` does its work on the
 * browser's own decoding thread, so the thing that would actually block is already off it.
 * What remains is this: a few hundred FFTs and a YIN pass per sample, tens of milliseconds
 * each, which across a two-thousand-file card is exactly the kind of arithmetic that would
 * freeze the interface if left in front of it.
 */

export interface AnalyseRequest {
  /** Echoed back, so the caller can match a result to its request. */
  id: string
  samples: Float32Array
  sampleRate: number
}

export type AnalyseResponse =
  | { id: string; ok: true; features: ReturnType<typeof extractFeatures> }
  | { id: string; ok: false; error: string }

self.onmessage = (event: MessageEvent<AnalyseRequest>) => {
  const { id, samples, sampleRate } = event.data
  try {
    const features = extractFeatures(samples, sampleRate)
    const response: AnalyseResponse = { id, ok: true, features }
    self.postMessage(response)
  } catch (error) {
    const response: AnalyseResponse = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
    self.postMessage(response)
  }
}
