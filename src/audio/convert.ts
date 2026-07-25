import { DEVICE_SAMPLE_RATE, MIN_SAMPLE_SEC, PAD_TARGET_FRAMES } from '~/domain/device'
import type { AudioMeta, ConversionTarget } from '~/domain/types'
import { decodeAtDeviceRate, resampleBuffer } from './decode'
import { encodeWav } from './wavEncoder'

/**
 * The conversion pipeline: decode → resample → fold → pad → quantise → encode.
 *
 * Output is always a plain PCM WAV at 44.1 kHz in the voice's channel count and bit
 * depth — the only thing the Rample will load.
 */

/**
 * The shape of an AudioBuffer that the folding and padding stages actually depend on.
 *
 * Declaring it separately keeps those stages — the only part of the pipeline with real
 * signal logic in it — testable outside a browser. `AudioBuffer` satisfies this
 * structurally, so nothing at the call site changes.
 */
export interface ChannelSource {
  length: number
  numberOfChannels: number
  getChannelData(channel: number): Float32Array
}

export interface ConversionResult {
  bytes: ArrayBuffer
  meta: AudioMeta
  /** True if the source was under 50 ms and we padded it with silence. */
  padded: boolean
}

/**
 * Fold an arbitrary channel count to the target.
 *
 * Mono: average all channels, which preserves loudness better than picking one and
 * silently discarding whatever was panned away from it.
 *
 * Stereo from mono: duplicate. Stereo from >2: take the first two channels. A proper
 * surround downmix needs per-format channel-order metadata and centre/LFE coefficients;
 * for a drum-kit sampler, L/R is the honest answer and multichannel input is rare.
 */
export function foldChannels(buffer: ChannelSource, targetChannels: 1 | 2): Float32Array[] {
  const frames = buffer.length
  const sourceChannels = buffer.numberOfChannels

  if (targetChannels === 1) {
    if (sourceChannels === 1) return [buffer.getChannelData(0).slice()]

    const mixed = new Float32Array(frames)
    for (let ch = 0; ch < sourceChannels; ch++) {
      const data = buffer.getChannelData(ch)
      for (let i = 0; i < frames; i++) mixed[i]! += data[i]!
    }
    for (let i = 0; i < frames; i++) mixed[i]! /= sourceChannels
    return [mixed]
  }

  if (sourceChannels === 1) {
    const mono = buffer.getChannelData(0)
    return [mono.slice(), mono.slice()]
  }
  return [buffer.getChannelData(0).slice(), buffer.getChannelData(1).slice()]
}

/**
 * Append silence until the sample clears the device's 50 ms floor.
 *
 * Padding rather than rejecting is a deliberate call: very short one-shots (clicks,
 * ticks, closed hats) are legitimate kit material, and the device's minimum is a
 * loader constraint rather than a musical one. We land slightly past 50 ms so no
 * rounding on the device's side can push it back under.
 */
export function padToMinimum(channels: Float32Array[]): { channels: Float32Array[]; padded: boolean } {
  const frames = channels[0]?.length ?? 0
  if (frames >= PAD_TARGET_FRAMES) return { channels, padded: false }

  const padded = channels.map((data) => {
    const grown = new Float32Array(PAD_TARGET_FRAMES)
    grown.set(data, 0)
    return grown
  })
  return { channels: padded, padded: true }
}

export async function convertToTarget(
  source: ArrayBuffer,
  target: ConversionTarget,
): Promise<ConversionResult> {
  // Decoding at 44.1 kHz means an already-correct file resamples zero times.
  const decoded = await decodeAtDeviceRate(source)

  // Belt and braces: every browser we support resamples on decode, but the Web Audio spec
  // words it as a "may", so verify rather than assume.
  const atRate =
    decoded.sampleRate === DEVICE_SAMPLE_RATE
      ? decoded
      : await resampleBuffer(decoded, DEVICE_SAMPLE_RATE)

  const folded = foldChannels(atRate, target.channels)
  const { channels, padded } = padToMinimum(folded)

  const bytes = encodeWav(channels, DEVICE_SAMPLE_RATE, target.bitDepth)
  const frames = channels[0]?.length ?? 0

  return {
    bytes,
    padded,
    meta: {
      container: 'wav',
      codec: 'pcm',
      sampleRate: DEVICE_SAMPLE_RATE,
      bitDepth: target.bitDepth,
      channels: target.channels,
      durationSec: frames / DEVICE_SAMPLE_RATE,
      sizeBytes: bytes.byteLength,
    },
  }
}

/** Whether converting this sample would pad it, for the pre-convert notice. */
export function wouldPad(meta: AudioMeta): boolean {
  return meta.durationSec < MIN_SAMPLE_SEC
}
