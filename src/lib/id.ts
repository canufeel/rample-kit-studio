/**
 * Stable unique ids for kits and samples.
 *
 * `crypto.randomUUID` only exists in a secure context. That covers https, localhost and
 * Tauri's asset protocol — every way this app is meant to run — but a plain http:// or
 * file:// open would throw on the very first import and take the whole feature down, so
 * fall back rather than fail.
 */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  }

  // Ids only need to be unique within a session, never unguessable — nothing here is a
  // security boundary — so a counter is an acceptable last resort.
  fallbackCounter += 1
  return `id-${fallbackCounter}-${String(performance.now()).replace('.', '')}`
}

let fallbackCounter = 0
