import type { Codec, Container } from '~/domain/types'

/**
 * Minimal RIFF/WAVE header reader.
 *
 * Exists because `decodeAudioData` throws away everything we need to police the export
 * contract: an `AudioBuffer` is Float32 by definition, so the source bit depth and
 * codec are simply gone. A 32-bit float WAV and a 24-bit WAV both decode flawlessly in
 * the browser and neither one plays on the device — only the header can tell them apart.
 *
 * Reading the header is also ~instant, so the metadata readout fills in the moment a
 * file lands rather than after a multi-second decode.
 *
 * Reference: http://soundfile.sapp.stanford.edu/doc/WaveFormat/
 */

const WAVE_FORMAT_PCM = 0x0001
const WAVE_FORMAT_IEEE_FLOAT = 0x0003
const WAVE_FORMAT_ALAW = 0x0006
const WAVE_FORMAT_MULAW = 0x0007
const WAVE_FORMAT_EXTENSIBLE = 0xfffe

export interface WavHeader {
  codec: Codec
  sampleRate: number
  bitDepth: number
  channels: number
  durationSec: number
}

function fourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  )
}

function codecFromFormatTag(tag: number): Codec {
  switch (tag) {
    case WAVE_FORMAT_PCM:
      return 'pcm'
    case WAVE_FORMAT_IEEE_FLOAT:
      return 'ieee-float'
    case WAVE_FORMAT_ALAW:
      return 'alaw'
    case WAVE_FORMAT_MULAW:
      return 'mulaw'
    case 0x0002:
    case 0x0011:
      return 'adpcm'
    default:
      return 'unknown'
  }
}

/**
 * Identify the container from magic bytes rather than the file extension, so a
 * mislabelled `.wav` that's really an mp3 is caught before it reaches the exporter.
 */
export function detectContainer(bytes: ArrayBuffer): Container {
  if (bytes.byteLength < 12) return 'unknown'
  const view = new DataView(bytes)
  const head = fourCC(view, 0)

  if (head === 'RIFF' && fourCC(view, 8) === 'WAVE') return 'wav'
  if (head === 'fLaC') return 'flac'
  if (head === 'OggS') return 'ogg'
  if (head === 'FORM') {
    const form = fourCC(view, 8)
    if (form === 'AIFF' || form === 'AIFC') return 'aiff'
  }
  if (fourCC(view, 4) === 'ftyp') return 'm4a'
  if (head.startsWith('ID3')) return 'mp3'
  // Bare MPEG audio frame sync: 11 set bits.
  if (view.getUint8(0) === 0xff && (view.getUint8(1) & 0xe0) === 0xe0) return 'mp3'

  return 'unknown'
}

/**
 * Walk the RIFF chunk list for `fmt ` and `data`. Chunks must be walked rather than
 * read at fixed offsets — real-world WAVs carry `LIST`/`fact`/`bext` chunks of varying
 * size before the audio, and assuming the canonical 44-byte layout misreads them.
 *
 * Returns null if the buffer isn't a parseable WAVE.
 */
export function parseWavHeader(bytes: ArrayBuffer): WavHeader | null {
  if (detectContainer(bytes) !== 'wav') return null

  const view = new DataView(bytes)
  const end = bytes.byteLength

  let formatTag = 0
  let channels = 0
  let sampleRate = 0
  let bitDepth = 0
  let dataBytes = 0
  let sawFmt = false

  let offset = 12
  while (offset + 8 <= end) {
    const id = fourCC(view, offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8

    if (id === 'fmt ' && body + 16 <= end) {
      formatTag = view.getUint16(body, true)
      channels = view.getUint16(body + 2, true)
      sampleRate = view.getUint32(body + 4, true)
      bitDepth = view.getUint16(body + 14, true)
      sawFmt = true

      // WAVE_FORMAT_EXTENSIBLE hides the real format in a GUID whose first two bytes
      // are the classic format tag. Without this, every extensible PCM file — which is
      // what most 24-bit and multichannel exports are — would be rejected as unknown.
      if (formatTag === WAVE_FORMAT_EXTENSIBLE && body + 26 <= end) {
        formatTag = view.getUint16(body + 24, true)
      }
    } else if (id === 'data') {
      // Streaming WAVs write 0xFFFFFFFF for unknown length; fall back to what's left.
      dataBytes = size === 0xffffffff || body + size > end ? end - body : size
      // Everything we need is known once fmt and data are both seen.
      if (sawFmt) break
    }

    // Chunk bodies are word-aligned: an odd size is followed by a pad byte.
    offset = body + size + (size % 2)
  }

  if (!sawFmt || channels === 0 || sampleRate === 0 || bitDepth === 0) return null

  const bytesPerFrame = channels * Math.ceil(bitDepth / 8)
  const durationSec = bytesPerFrame > 0 ? dataBytes / bytesPerFrame / sampleRate : 0

  return {
    codec: codecFromFormatTag(formatTag),
    sampleRate,
    bitDepth,
    channels,
    durationSec,
  }
}
