import { EXPORT_FILENAME_SLOT_DIGITS } from './device'
import type { VoiceIndex } from './device'

/**
 * Cap on the slug portion. The device places no documented limit on filename length,
 * but SD cards are FAT-formatted and long-filename entries cost directory space, so
 * keep the whole name comfortably short and readable on the device's screen.
 */
const MAX_SLUG_LENGTH = 48

const FALLBACK_SLUG = 'sample'

/** Strips the last extension, if any. "kick.wav" -> "kick", "no-ext" -> "no-ext". */
export function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot > 0 ? filename.slice(0, dot) : filename
}

/**
 * Reduce an arbitrary filename to characters that are safe on a FAT-formatted card
 * and unambiguous in the device's numeric-then-alphabetic sort.
 *
 *   "Kick (Deep) #2.wav"  -> "Kick_Deep_2"
 *   "Café Crème.wav"      -> "Cafe_Creme"
 *   "🥁.wav"              -> "sample"
 *
 * Case is preserved — FAT is case-insensitive, so it costs nothing and reads better.
 */
export function slugifySampleName(filename: string): string {
  const slug = stripExtension(filename)
    // Decompose accents into base letter + combining mark, then drop the marks,
    // so "é" survives as "e" rather than being replaced wholesale by an underscore.
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/_$/, '')

  return slug || FALLBACK_SLUG
}

/**
 * Build the exported filename for one layer.
 *
 * Shape: `{voice}-{slot}_{slug}.wav`, e.g. `1-01_Kick_Deep_2.wav`.
 *
 * The leading character is the voice digit, satisfying the manual's rule. The
 * zero-padded slot index that follows pins layer order under numeric-then-alphabetic
 * sorting, and — because slots are unique within a voice — makes collisions impossible
 * even when two layers share a source name.
 *
 * @param slot zero-based position within the voice's active layers
 */
export function exportFilename(voice: VoiceIndex, slot: number, sourceName: string): string {
  const index = String(slot + 1).padStart(EXPORT_FILENAME_SLOT_DIGITS, '0')
  return `${voice}-${index}_${slugifySampleName(sourceName)}.wav`
}

/** Full path within the export bundle: `A0/1-01_Kick.wav`. Kits sit at the card root. */
export function exportPath(kitCode: string, filename: string): string {
  return `${kitCode}/${filename}`
}
