import type { BitDepth } from '~/domain/device'

/**
 * Hand-written RIFF/PCM encoder. There is no browser API that writes WAV, and the
 * device only reads WAV, so this is the one place kits actually become files.
 *
 * Writes the canonical 44-byte header: RIFF > fmt (16-byte PCM) > data. No LIST or
 * fact chunks — the device wants the plainest possible file, and extra chunks are
 * only more surface for a firmware parser to trip over.
 *
 * Reference: http://soundfile.sapp.stanford.edu/doc/WaveFormat/
 */

const HEADER_BYTES = 44

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
}

/**
 * Float sample in [-1, 1] to signed 16-bit.
 *
 * The asymmetric scale is deliberate: two's-complement 16-bit spans -32768..32767, so
 * scaling negatives by 32768 and positives by 32767 uses the full range without ever
 * wrapping a full-scale peak around to the opposite sign.
 */
function toInt16(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample))
  return Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff)
}

/**
 * Float sample in [-1, 1] to unsigned 8-bit.
 *
 * 8-bit WAV is unsigned with silence at 128 — unlike every other depth, which is
 * signed. Getting this backwards produces a file that plays as full-scale noise.
 */
function toUint8(sample: number): number {
  const clamped = Math.max(-1, Math.min(1, sample))
  return Math.max(0, Math.min(255, Math.round((clamped + 1) * 127.5)))
}

/**
 * Interleave planar channel data and quantise it into a complete WAV file.
 *
 * @param channelData one Float32Array per channel, all the same length
 */
export function encodeWav(
  channelData: readonly Float32Array[],
  sampleRate: number,
  bitDepth: BitDepth,
): ArrayBuffer {
  const channels = channelData.length
  if (channels === 0) throw new Error('encodeWav: no channel data')

  const frames = channelData[0]!.length
  const bytesPerSample = bitDepth / 8
  const blockAlign = channels * bytesPerSample
  const dataBytes = frames * blockAlign

  const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true) // file size minus the 8-byte RIFF preamble
  writeAscii(view, 8, 'WAVE')

  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // PCM fmt chunk size
  view.setUint16(20, 1, true) // WAVE_FORMAT_PCM
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true) // byte rate
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitDepth, true)

  writeAscii(view, 36, 'data')
  view.setUint32(40, dataBytes, true)

  let offset = HEADER_BYTES
  if (bitDepth === 16) {
    for (let frame = 0; frame < frames; frame++) {
      for (let ch = 0; ch < channels; ch++) {
        view.setInt16(offset, toInt16(channelData[ch]![frame]!), true)
        offset += 2
      }
    }
  } else {
    for (let frame = 0; frame < frames; frame++) {
      for (let ch = 0; ch < channels; ch++) {
        view.setUint8(offset, toUint8(channelData[ch]![frame]!))
        offset += 1
      }
    }
  }

  return buffer
}
