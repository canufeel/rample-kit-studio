import { decodeAtDeviceRate } from '~/audio/decode'
import { getAudio } from '~/storage/audioStore'
import type { SampleId } from '~/domain/types'
import { contentKey, getCached, putCached } from './cache'
import type { AudioFeatures } from './features'
import type { AnalyseRequest, AnalyseResponse } from './worker'

/**
 * Drives analysis for one sample at a time: cache, decode, worker, cache.
 *
 * Serial on purpose. The work is already off the main thread, so a second worker would
 * only compete for cores with audio playback — and this runs while the user is doing
 * something else, so finishing sooner is worth less than never being noticed.
 */

/**
 * Diagnostics, development only.
 *
 * Every failure below is deliberately non-fatal — a sample the browser cannot decode
 * simply has no character line, which is the right behaviour and not worth interrupting
 * anyone over. But silent-by-design is undiagnosable when the whole pipeline is broken:
 * a worker that fails to spawn produced no output whatsoever. In development it says so.
 */
function trace(reason: string, detail?: unknown): void {
  if (import.meta.env.DEV) console.warn(`[analysis] ${reason}`, detail ?? '')
}

let worker: Worker | null = null
const pending = new Map<string, (response: AnalyseResponse) => void>()

function ensureWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<AnalyseResponse>) => {
    const resolve = pending.get(event.data.id)
    if (!resolve) return
    pending.delete(event.data.id)
    resolve(event.data)
  }
  worker.onerror = (event) => {
    trace('worker failed to start or crashed', event.message || event)
    // The worker is gone; fail everything waiting on it rather than hanging, and let the
    // next call build a fresh one.
    for (const [id, resolve] of pending) resolve({ id, ok: false, error: 'Analysis worker failed' })
    pending.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

function runInWorker(request: AnalyseRequest): Promise<AnalyseResponse> {
  return new Promise((resolve) => {
    pending.set(request.id, resolve)
    // Transferred, not copied — a 30-second buffer is 5 MB, and structured-cloning that
    // per sample would cost more than the analysis.
    ensureWorker().postMessage(request, [request.samples.buffer])
  })
}

/** Fold to mono. How to combine channels is a question about the file, not the measurement. */
function toMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return new Float32Array(buffer.getChannelData(0))
  const mixed = new Float32Array(buffer.length)
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const channel = buffer.getChannelData(c)
    for (let i = 0; i < mixed.length; i++) mixed[i]! += channel[i]!
  }
  for (let i = 0; i < mixed.length; i++) mixed[i]! /= buffer.numberOfChannels
  return mixed
}

/**
 * Analyse one sample, or return what was already known about it.
 *
 * Resolves to null when the sample has no bytes, cannot be decoded, or the worker failed.
 * All three are ordinary — an unconverted mp3 that the browser declines is not an error
 * worth interrupting anyone over, it just has no character line.
 */
export async function analyseSample(id: SampleId): Promise<AudioFeatures | null> {
  const bytes = await getAudio(id)
  if (!bytes) {
    trace('no stored audio for sample', id)
    return null
  }

  const key = await contentKey(bytes)
  const cached = await getCached(key)
  if (cached) return cached

  let samples: Float32Array
  let sampleRate: number
  try {
    const buffer = await decodeAtDeviceRate(bytes)
    samples = toMono(buffer)
    sampleRate = buffer.sampleRate
  } catch (error) {
    trace('could not decode sample', { id, error })
    return null
  }

  const response = await runInWorker({ id, samples, sampleRate })
  if (!response.ok) {
    trace('worker returned no features', { id, error: response.error })
    return null
  }

  await putCached(key, response.features)
  return response.features
}
