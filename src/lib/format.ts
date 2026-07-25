import { containerLabel } from '~/audio/metadata'
import type { AudioMeta } from '~/domain/types'

export function formatSampleRate(rate: number | null): string {
  if (rate === null) return '—'
  return `${rate}`
}

export function formatBitDepth(meta: AudioMeta): string {
  // A compressed file has no PCM bit depth to report, so name the format instead of
  // inventing a number.
  if (meta.bitDepth === null) return containerLabel(meta.container)
  return `${meta.bitDepth}-bit`
}

export function formatChannels(channels: number): string {
  if (channels === 1) return 'mono'
  if (channels === 2) return 'stereo'
  return `${channels}ch`
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s'
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`
  if (seconds < 60) return `${seconds.toFixed(2)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `${minutes}m ${rest}s`
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  // A storage quota runs to gigabytes, and "2048.0 MB" is a number you have to convert in
  // your head before it means anything.
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
