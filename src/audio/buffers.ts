import type { SampleId } from '~/domain/types'
import { requireAudio } from '~/storage/audioStore'
import { getAudioContext } from './context'
import { decodeInContext } from './decode'

/**
 * Decoded-audio cache, shared by row audition and the sequencer.
 *
 * The sequencer needs buffers *synchronously*: the lookahead scheduler runs ~100 ms
 * ahead of the audio clock, and an IndexedDB read plus a decode can easily exceed that,
 * so a hit would arrive late or not at all. Everything is therefore preloaded before the
 * transport starts, and scheduled triggers only ever read from this map.
 *
 * What is cached is the *converted* file's decode — the exact bytes we would write to
 * the SD card — so preview and export cannot disagree about how a sample sounds.
 */

const buffers = new Map<SampleId, AudioBuffer>()

export function getBufferSync(id: SampleId): AudioBuffer | undefined {
  return buffers.get(id)
}

export async function loadBuffer(id: SampleId): Promise<AudioBuffer> {
  const cached = buffers.get(id)
  if (cached) return cached
  const bytes = await requireAudio(id)
  const buffer = await decodeInContext(bytes, getAudioContext())
  buffers.set(id, buffer)
  return buffer
}

/** Conversion rewrites a sample's bytes, so its cached decode is stale. */
export function invalidateBuffer(id: SampleId): void {
  buffers.delete(id)
}

export function forgetBuffers(ids: readonly SampleId[]): void {
  for (const id of ids) buffers.delete(id)
}

/**
 * Decode everything the transport might trigger, before it starts.
 *
 * Resolves to the ids that could not be loaded rather than throwing: one unreadable
 * sample should cost that layer, not the whole session.
 */
export async function preload(ids: readonly SampleId[]): Promise<SampleId[]> {
  const failed: SampleId[] = []
  await Promise.all(
    ids.map(async (id) => {
      try {
        await loadBuffer(id)
      } catch {
        failed.push(id)
      }
    }),
  )
  return failed
}
