import { describe, expect, test } from 'bun:test'
import { PAD_TARGET_FRAMES } from '~/domain/device'
import { foldChannels, padToMinimum, wouldPad } from './convert'
import type { ChannelSource } from './convert'
import { encodeWav } from './wavEncoder'
import { parseWavHeader } from './wavHeader'

/**
 * Covers the stages of the pipeline that carry real signal logic. Decoding and
 * resampling are delegated to the browser's own implementations and have nothing of
 * ours to test — but the channel fold, the 50 ms pad, and the quantise/encode step are
 * all ours, and all three change what lands on the SD card.
 */

function source(...channels: number[][]): ChannelSource {
  const data = channels.map((c) => Float32Array.from(c))
  return {
    length: data[0]?.length ?? 0,
    numberOfChannels: data.length,
    getChannelData: (i) => data[i]!,
  }
}

describe('foldChannels', () => {
  test('mono passes through untouched', () => {
    const result = foldChannels(source([0.25, -0.5]), 1)
    expect(result).toHaveLength(1)
    expect(Array.from(result[0]!)).toEqual([0.25, -0.5])
  })

  test('stereo folds to mono by averaging, not by dropping a side', () => {
    // Picking one channel would silence anything panned to the other.
    const result = foldChannels(source([1, 0], [0, 1]), 1)
    expect(Array.from(result[0]!)).toEqual([0.5, 0.5])
  })

  test('a hard-panned stereo source survives the mono fold', () => {
    const result = foldChannels(source([0, 0], [1, -1]), 1)
    expect(Array.from(result[0]!)).toEqual([0.5, -0.5])
  })

  test('mono to stereo duplicates into both channels', () => {
    const result = foldChannels(source([0.5, -0.25]), 2)
    expect(result).toHaveLength(2)
    expect(Array.from(result[0]!)).toEqual([0.5, -0.25])
    expect(Array.from(result[1]!)).toEqual([0.5, -0.25])
  })

  test('stereo to stereo is preserved per channel', () => {
    const result = foldChannels(source([1, 1], [-1, -1]), 2)
    expect(Array.from(result[0]!)).toEqual([1, 1])
    expect(Array.from(result[1]!)).toEqual([-1, -1])
  })

  test('multichannel folds to mono across every channel', () => {
    const result = foldChannels(source([1], [1], [1], [1]), 1)
    expect(Array.from(result[0]!)).toEqual([1])
  })

  test('multichannel to stereo takes the first two channels', () => {
    const result = foldChannels(source([1], [2], [3], [4]), 2)
    expect(Array.from(result[0]!)).toEqual([1])
    expect(Array.from(result[1]!)).toEqual([2])
  })

  test('the result never aliases the source buffer', () => {
    const src = source([1, 2])
    const result = foldChannels(src, 1)
    result[0]![0] = 99
    expect(src.getChannelData(0)[0]).toBe(1)
  })
})

describe('padToMinimum', () => {
  test('pads a short sample past the device\'s 50 ms floor', () => {
    const { channels, padded } = padToMinimum([new Float32Array(100)])
    expect(padded).toBe(true)
    expect(channels[0]!.length).toBe(PAD_TARGET_FRAMES)
    // Landing past 50 ms rather than exactly on it means no rounding can push the
    // file back under the device's minimum.
    expect(PAD_TARGET_FRAMES / 44100).toBeGreaterThan(0.05)
  })

  test('leaves a long-enough sample alone', () => {
    const input = [new Float32Array(PAD_TARGET_FRAMES)]
    const { channels, padded } = padToMinimum(input)
    expect(padded).toBe(false)
    expect(channels[0]).toBe(input[0]!)
  })

  test('pads every channel to the same length', () => {
    const { channels } = padToMinimum([new Float32Array(10), new Float32Array(10)])
    expect(channels[0]!.length).toBe(PAD_TARGET_FRAMES)
    expect(channels[1]!.length).toBe(PAD_TARGET_FRAMES)
  })

  test('padding is silence appended after the original audio', () => {
    const { channels } = padToMinimum([Float32Array.from([0.5, 0.5])])
    expect(channels[0]![0]).toBe(0.5)
    expect(channels[0]![1]).toBe(0.5)
    expect(channels[0]![2]).toBe(0)
    expect(channels[0]![PAD_TARGET_FRAMES - 1]).toBe(0)
  })

  test('wouldPad agrees with the device minimum', () => {
    const meta = { durationSec: 0.04 } as never
    expect(wouldPad(meta)).toBe(true)
    expect(wouldPad({ durationSec: 0.06 } as never)).toBe(false)
  })
})

describe('fold + pad + encode end to end', () => {
  test('a short 4-channel source becomes a device-legal mono file', () => {
    const folded = foldChannels(source([1], [1], [1], [1]), 1)
    const { channels, padded } = padToMinimum(folded)
    const bytes = encodeWav(channels, 44100, 16)

    expect(padded).toBe(true)

    const header = parseWavHeader(bytes)!
    expect(header.codec).toBe('pcm')
    expect(header.sampleRate).toBe(44100)
    expect(header.bitDepth).toBe(16)
    expect(header.channels).toBe(1)
    expect(header.durationSec).toBeGreaterThanOrEqual(0.05)
  })

  test('a stereo target produces a two-channel device-legal file', () => {
    const folded = foldChannels(source([0.5, -0.5]), 2)
    const { channels } = padToMinimum(folded)
    const header = parseWavHeader(encodeWav(channels, 44100, 16))!
    expect(header.channels).toBe(2)
    expect(header.durationSec).toBeGreaterThanOrEqual(0.05)
  })
})
