import { FEATURES_VERSION } from './features'
import type { AudioFeatures } from './features'

/**
 * Analysis results, cached by what the audio *is* rather than by which sample points at it.
 *
 * Keying on a hash of the bytes is what makes a card import bearable. A factory card holds
 * literal duplicate files, the same kit can be imported twice, and one sample may sit in
 * several slots — all of which collapse to a single analysis. It also means re-importing a
 * project someone else sent you costs nothing if you already have those samples.
 *
 * Its own database, not a store inside the audio one, for three reasons: this is derived
 * data with its own version and its own lifecycle, it must be discardable without touching
 * anything the user would miss, and "forget all analysis" is then one `deleteDatabase` call
 * rather than a cursor sweep.
 */

const DB_NAME = 'rample-kit-studio-analysis'
const DB_VERSION = 1
const STORE = 'features'

/** Long enough that a collision is not a practical concern, short enough to read in a log. */
const KEY_LENGTH = 16

/** See the note in `runner.ts`: silent by design in production, loud in development. */
function trace(reason: string, detail?: unknown): void {
  if (import.meta.env.DEV) console.warn(`[analysis cache] ${reason}`, detail ?? '')
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || indexedDB === null) {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open the analysis cache'))
    request.onblocked = () => reject(new Error('The analysis cache is blocked by another tab'))
  })
  // A failed open must not be remembered, or every later call inherits the failure.
  dbPromise.catch(() => {
    dbPromise = null
  })
  return dbPromise
}

/**
 * Content key for a sample's bytes.
 *
 * SHA-256 via SubtleCrypto rather than a hand-rolled fast hash: it is built in, available
 * in workers, and hundreds of megabytes a second — far cheaper than the decode that
 * follows it, so nothing is gained by being cleverer.
 */
export async function contentKey(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest, 0, KEY_LENGTH / 2))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Look up a cached analysis.
 *
 * A result from an older feature version is treated as absent: the numbers would be
 * subtly different from freshly computed ones, and a library half-analysed by two
 * different versions is worse than one that recomputes.
 */
export async function getCached(key: string): Promise<AudioFeatures | undefined> {
  try {
    const db = await openDb()
    const stored = await new Promise<AudioFeatures | undefined>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      request.onsuccess = () => resolve(request.result as AudioFeatures | undefined)
      request.onerror = () => reject(request.error)
    })
    return stored?.version === FEATURES_VERSION ? stored : undefined
  } catch (error) {
    // A cache miss and an unreachable cache are the same thing to the caller: analyse it.
    trace('could not read', error)
    return undefined
  }
}

export async function putCached(key: string, features: AudioFeatures): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite')
      transaction.objectStore(STORE).put(features, key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  } catch (error) {
    // Failing to cache is not worth surfacing — the analysis already succeeded, and the
    // only cost is doing it again next time.
    trace('could not write', error)
  }
}

/** Throw the whole cache away. Everything in it is recomputable. */
export async function clearCache(): Promise<void> {
  dbPromise = null
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}
