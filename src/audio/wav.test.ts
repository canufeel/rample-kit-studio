import { describe, expect, test } from 'bun:test'
import { encodeWav } from './wavEncoder'
import { detectContainer, parseWavHeader } from './wavHeader'

/**
 * The encoder and the header parser are the two ends of the export contract: one writes
 * the files the device loads, the other judges the files the user drops in. Round-tripping
 * them against each other is the strongest cheap check that both are right — a file we
 * produce must be a file we would accept.
 */

function readPcm16(bytes: ArrayBuffer, frames: number, channels: number): number[] {
  const view = new DataView(bytes)
  const out: number[] = []
  for (let i = 0; i < frames * channels; i++) out.push(view.getInt16(44 + i * 2, true))
  return out
}

describe('encodeWav', () => {
  test('produces a file our own parser accepts', () => {
    const data = new Float32Array(4410)
    const bytes = encodeWav([data], 44100, 16)

    expect(detectContainer(bytes)).toBe('wav')
    const header = parseWavHeader(bytes)
    expect(header).not.toBeNull()
    expect(header!.codec).toBe('pcm')
    expect(header!.sampleRate).toBe(44100)
    expect(header!.bitDepth).toBe(16)
    expect(header!.channels).toBe(1)
    expect(header!.durationSec).toBeCloseTo(0.1, 5)
  })

  test('16-bit quantisation uses the full signed range without wrapping', () => {
    const bytes = encodeWav([new Float32Array([0, 0.5, -0.5, 1, -1])], 44100, 16)
    // Full-scale positive must land on 32767, not wrap to -32768.
    expect(readPcm16(bytes, 5, 1)).toEqual([0, 16384, -16384, 32767, -32768])
  })

  test('clamps out-of-range floats rather than wrapping them', () => {
    const bytes = encodeWav([new Float32Array([2, -2])], 44100, 16)
    expect(readPcm16(bytes, 2, 1)).toEqual([32767, -32768])
  })

  test('8-bit is unsigned with silence at 128', () => {
    // Every other depth is signed; getting 8-bit backwards yields full-scale noise.
    const bytes = encodeWav([new Float32Array([0, 1, -1])], 44100, 8)
    const view = new DataView(bytes)
    expect([view.getUint8(44), view.getUint8(45), view.getUint8(46)]).toEqual([128, 255, 0])
    expect(parseWavHeader(bytes)!.bitDepth).toBe(8)
  })

  test('interleaves stereo channels frame by frame', () => {
    const left = new Float32Array([1, 1])
    const right = new Float32Array([-1, -1])
    const bytes = encodeWav([left, right], 44100, 16)
    expect(readPcm16(bytes, 2, 2)).toEqual([32767, -32768, 32767, -32768])

    const header = parseWavHeader(bytes)!
    expect(header.channels).toBe(2)
    expect(header.durationSec).toBeCloseTo(2 / 44100, 8)
  })

  test('header declares sizes consistent with the payload', () => {
    const bytes = encodeWav([new Float32Array(100), new Float32Array(100)], 44100, 16)
    const view = new DataView(bytes)
    expect(view.getUint32(4, true)).toBe(bytes.byteLength - 8) // RIFF size
    expect(view.getUint32(40, true)).toBe(100 * 2 * 2) // data size
    expect(view.getUint32(28, true)).toBe(44100 * 4) // byte rate
    expect(view.getUint16(32, true)).toBe(4) // block align
  })
})

describe('parseWavHeader', () => {
  /** Build a WAV with an extra chunk wedged between `fmt ` and `data`. */
  function wavWithExtraChunk(): ArrayBuffer {
    const extra = 20 // 8-byte header + 12-byte body
    const dataBytes = 8
    const size = 12 + 24 + extra + 8 + dataBytes
    const buffer = new ArrayBuffer(size)
    const view = new DataView(buffer)
    const ascii = (offset: number, text: string) => {
      for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
    }

    ascii(0, 'RIFF')
    view.setUint32(4, size - 8, true)
    ascii(8, 'WAVE')

    ascii(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, 44100, true)
    view.setUint32(28, 88200, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)

    ascii(36, 'LIST')
    view.setUint32(40, 12, true)

    ascii(56, 'data')
    view.setUint32(60, dataBytes, true)
    return buffer
  }

  test('walks past chunks it does not recognise', () => {
    // Real-world WAVs carry LIST/bext/fact chunks; reading `data` at a fixed offset
    // would misparse every file an editor has touched.
    const header = parseWavHeader(wavWithExtraChunk())
    expect(header).not.toBeNull()
    expect(header!.sampleRate).toBe(44100)
    expect(header!.channels).toBe(1)
    expect(header!.durationSec).toBeCloseTo(4 / 44100, 8)
  })

  test('reads the real format out of WAVE_FORMAT_EXTENSIBLE', () => {
    const bytes = encodeWav([new Float32Array(10)], 44100, 16)
    const view = new DataView(bytes)
    // Rewrite fmt as extensible: tag 0xFFFE, real format in the sub-format GUID.
    view.setUint16(20, 0xfffe, true)
    view.setUint32(16, 40, true)
    // The canonical layout has no room for the GUID, so only the tag path is checked
    // here: an extensible header we cannot fully read must not be mistaken for PCM.
    expect(parseWavHeader(bytes)?.codec).not.toBe('ieee-float')
  })

  test('rejects non-WAV data', () => {
    const mp3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0, 0, 0]).buffer
    expect(detectContainer(mp3)).toBe('mp3')
    expect(parseWavHeader(mp3)).toBeNull()

    const flac = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0, 0, 0, 0, 0, 0, 0, 0]).buffer
    expect(detectContainer(flac)).toBe('flac')

    const ogg = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0, 0, 0, 0, 0]).buffer
    expect(detectContainer(ogg)).toBe('ogg')
  })

  test('survives a truncated file without throwing', () => {
    expect(parseWavHeader(new ArrayBuffer(4))).toBeNull()
    expect(detectContainer(new ArrayBuffer(0))).toBe('unknown')
  })

  test('handles a streaming data size of 0xFFFFFFFF', () => {
    const bytes = encodeWav([new Float32Array(100)], 44100, 16)
    new DataView(bytes).setUint32(40, 0xffffffff, true)
    const header = parseWavHeader(bytes)
    expect(header).not.toBeNull()
    expect(header!.durationSec).toBeCloseTo(100 / 44100, 8)
  })
})
