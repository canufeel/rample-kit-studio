import { hydratePattern, hydratePreset } from '~/domain/library'
import type { SavedPattern, SavedPreset } from '~/domain/types'

/**
 * The library's localStorage layer.
 *
 * Patterns and presets are parameters only — no audio — so unlike the session they fit
 * localStorage comfortably: a 64-step pattern is a few hundred bytes of JSON. They are
 * kept under their own keys rather than inside the session because the library is global
 * by design; clearing or overwriting a session must not take the library with it.
 */

const PATTERN_KEY = 'rks:patterns:v1'
const PRESET_KEY = 'rks:presets:v1'

interface Envelope<T> {
  version: 1
  entries: T[]
}

/**
 * Entries that fail to hydrate are dropped, not fatal.
 *
 * One corrupt row costs the user that row; throwing would cost them the whole library,
 * and there is no way to repair it from the UI.
 */
function read<T>(key: string, hydrate: (raw: unknown) => T | null): T[] {
  const raw = localStorage.getItem(key)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as Envelope<unknown>
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return []
    return parsed.entries.map(hydrate).filter((entry): entry is T => entry !== null)
  } catch {
    return []
  }
}

/** Throws on a full quota so the caller can tell the user the save did not happen. */
function write<T>(key: string, entries: readonly T[]): void {
  const payload: Envelope<T> = { version: 1, entries: [...entries] }
  localStorage.setItem(key, JSON.stringify(payload))
}

export function loadPatterns(): SavedPattern[] {
  return read(PATTERN_KEY, hydratePattern)
}

export function savePatterns(entries: readonly SavedPattern[]): void {
  write(PATTERN_KEY, entries)
}

export function loadPresets(): SavedPreset[] {
  return read(PRESET_KEY, hydratePreset)
}

export function savePresets(entries: readonly SavedPreset[]): void {
  write(PRESET_KEY, entries)
}

/** Used by the reset path, which clears the session but leaves the library alone by default. */
export function clearLibrary(): void {
  localStorage.removeItem(PATTERN_KEY)
  localStorage.removeItem(PRESET_KEY)
}
