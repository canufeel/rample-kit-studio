import { DEVICE_SAMPLE_RATE } from '~/domain/device'

/**
 * Decoding, done at the device's rate on purpose.
 *
 * `decodeAudioData` resamples to the *context's* sample rate as part of decoding. That
 * detail decides the quality of every conversion: on a machine whose audio device runs
 * at 48 kHz (most Macs), decoding through the live AudioContext turns an already-correct
 * 44.1 kHz file into 48 kHz, and the pipeline then drags it back down to 44.1 kHz — two
 * resampling passes on the single most common input, for no reason.
 *
 * Decoding through an OfflineAudioContext pinned to 44100 collapses that to one pass at
 * most: files that need resampling get exactly one, and files already at 44.1 kHz get
 * none at all and reach the encoder untouched.
 */

/**
 * `decodeAudioData` detaches the ArrayBuffer it's handed, leaving the caller holding a
 * zero-length husk. We keep source bytes around for re-conversion and export, so every
 * decode gets its own copy.
 */
function detachSafe(bytes: ArrayBuffer): ArrayBuffer {
  return bytes.slice(0)
}

/** Decode any browser-supported format, resampled to 44.1 kHz in the process. */
export async function decodeAtDeviceRate(bytes: ArrayBuffer): Promise<AudioBuffer> {
  // Length is irrelevant to decoding — only the context's sampleRate is consulted —
  // so allocate the smallest legal context.
  const ctx = new OfflineAudioContext(1, 1, DEVICE_SAMPLE_RATE)
  return ctx.decodeAudioData(detachSafe(bytes))
}

/**
 * Decode into a specific context's rate. Used for previewing *unconverted* samples, so
 * the user hears the file as-is rather than a resampled approximation of it.
 */
export async function decodeInContext(
  bytes: ArrayBuffer,
  ctx: BaseAudioContext,
): Promise<AudioBuffer> {
  return ctx.decodeAudioData(detachSafe(bytes))
}

/**
 * Explicit resample, for the rare case where a browser hands back a buffer at a rate
 * other than the decoding context's. Rendering a source through an OfflineAudioContext
 * at the target rate is the standard idiom — the graph resamples on playback.
 */
export async function resampleBuffer(
  buffer: AudioBuffer,
  targetRate: number,
): Promise<AudioBuffer> {
  if (buffer.sampleRate === targetRate) return buffer

  const frames = Math.max(1, Math.ceil(buffer.duration * targetRate))
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, frames, targetRate)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  source.start()
  return ctx.startRendering()
}
