import type { AudioMeta } from '~/domain/types'
import { decodeAtDeviceRate } from './decode'
import { detectContainer, parseWavHeader } from './wavHeader'

export class UnreadableAudioError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnreadableAudioError'
  }
}

const CONTAINER_LABEL: Record<string, string> = {
  wav: 'WAV',
  mp3: 'MP3',
  flac: 'FLAC',
  ogg: 'OGG',
  m4a: 'M4A',
  aiff: 'AIFF',
  unknown: 'Unknown',
}

export function containerLabel(container: string): string {
  return CONTAINER_LABEL[container] ?? container.toUpperCase()
}

/**
 * Read everything the UI needs to describe and judge a file.
 *
 * WAV takes the fast path — the header alone gives rate, depth, channels and duration
 * without touching the decoder, so the readout appears the instant a file is dropped
 * even if it's an hour long.
 *
 * Other containers have to be decoded to learn anything, and we deliberately stop at
 * channels and duration rather than shipping per-format header parsers: those files are
 * invalid by container regardless of what's inside them, so their rate and depth would
 * only ever be trivia. The row shows the format badge instead.
 */
export async function readMetadata(file: File): Promise<{ bytes: ArrayBuffer; meta: AudioMeta }> {
  const bytes = await file.arrayBuffer()
  const container = detectContainer(bytes)

  if (container === 'wav') {
    const header = parseWavHeader(bytes)
    if (!header) {
      throw new UnreadableAudioError('This .wav file has a header we could not read.')
    }
    return {
      bytes,
      meta: {
        container: 'wav',
        codec: header.codec,
        sampleRate: header.sampleRate,
        bitDepth: header.bitDepth,
        channels: header.channels,
        durationSec: header.durationSec,
        sizeBytes: bytes.byteLength,
      },
    }
  }

  // AIFF has no decoder in Chrome/Firefox/Edge, so fail with something actionable
  // rather than letting decodeAudioData return an opaque DOMException.
  if (container === 'aiff') {
    throw new UnreadableAudioError(
      'AIFF is not supported by browser audio decoders. Convert it to WAV first.',
    )
  }

  let decoded: AudioBuffer
  try {
    decoded = await decodeAtDeviceRate(bytes)
  } catch {
    throw new UnreadableAudioError(
      `Could not decode this ${containerLabel(container)} file. It may be corrupt or in a format this browser does not support.`,
    )
  }

  return {
    bytes,
    meta: {
      container,
      codec: 'compressed',
      sampleRate: null,
      bitDepth: null,
      channels: decoded.numberOfChannels,
      durationSec: decoded.duration,
      sizeBytes: bytes.byteLength,
    },
  }
}
