import { DEVICE_SAMPLE_RATE } from '~/domain/device'

/**
 * The single live AudioContext, pinned to the device's rate.
 *
 * Running the preview graph at 44.1 kHz means our buffers — which are all 44.1 kHz by
 * the time they're auditioned — play at `playbackRate` 1.0 with no per-source
 * resampling, and preview sounds identical on a 48 kHz Mac and a 44.1 kHz PC. The OS
 * still reconciles with the hardware rate, but once at the output rather than on every
 * buffer.
 *
 * Not every browser honours the requested rate; if it refuses, fall back to the default
 * rather than failing to make sound at all.
 */

let context: AudioContext | null = null

export function getAudioContext(): AudioContext {
  if (context) return context
  try {
    context = new AudioContext({ sampleRate: DEVICE_SAMPLE_RATE })
  } catch {
    context = new AudioContext()
  }
  return context
}

/**
 * The rate preview is actually running at, or null if no context exists yet.
 *
 * Deliberately does *not* create one: constructing an AudioContext outside a user
 * gesture makes the browser log an autoplay warning and leaves a suspended context
 * holding hardware resources for a page that may never make a sound.
 */
export function contextSampleRate(): number | null {
  return context?.sampleRate ?? null
}

export const DEVICE_RATE = DEVICE_SAMPLE_RATE

/**
 * Autoplay policy: a context created outside a user gesture starts suspended and stays
 * silent. Call this from any click/keypress handler before making sound.
 */
export async function resumeAudio(): Promise<void> {
  const ctx = getAudioContext()
  if (ctx.state === 'suspended') {
    await ctx.resume()
  }
}
