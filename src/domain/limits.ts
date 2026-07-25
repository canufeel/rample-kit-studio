/**
 * Limits this application imposes, as opposed to the ones the device imposes.
 *
 * Kept apart from `device.ts` on purpose: everything in there is quoted from the manual and
 * is not ours to change. Everything here is a judgement call about the UI, and changing it
 * breaks nothing but taste.
 */

/**
 * How many kits one session may hold.
 *
 * The kit tabs live on a single row of the toolbar. Past roughly this many they stop being
 * navigable — the row becomes a horizontal scroll through indistinguishable three-character
 * labels, and picking the right one costs more than it saves. A factory SD card holds 184
 * kits, so "import a whole card" has to be truncated rather than allowed to produce a
 * session nobody can steer.
 *
 * This is a workspace limit, not a device one. The Rample itself takes 2600 folders, and
 * exporting several sessions to the same card is the way to fill it.
 */
export const MAX_KITS_PER_SESSION = 16

/** Fraction of the storage quota at which the footer readout starts warning. */
export const STORAGE_WARN_AT = 0.75

/** Fraction at which it goes from warning to alarming. */
export const STORAGE_CRITICAL_AT = 0.9

export type StorageLevel = 'ok' | 'warn' | 'critical'

export function storageLevel(fraction: number): StorageLevel {
  if (fraction >= STORAGE_CRITICAL_AT) return 'critical'
  if (fraction >= STORAGE_WARN_AT) return 'warn'
  return 'ok'
}
