import type { SampleId } from '~/domain/types'

/**
 * Audio bytes live in IndexedDB, not localStorage.
 *
 * This is not a future optimisation — localStorage caps at roughly 5 MB and stores
 * strings, so binary would have to be base64'd (a further +33%). A single three-second
 * 44.1 kHz/16-bit stereo sample is about 500 KB, meaning one voice of twelve layers
 * blows the quota outright. Everything else about a session is small, so the split is:
 * bytes here, structure in localStorage.
 */

const DB_NAME = 'rample-kit-studio'
const DB_VERSION = 1
const STORE = 'audio'

/**
 * The browser will not give us a database at all.
 *
 * Distinct from "the write failed" because the remedy is completely different: this one is
 * not something the user can clear space to fix. It happens in hardened privacy modes and
 * in some embedded webviews, and without naming it the failure surfaces once per imported
 * file as "could not read this file", which blames the file.
 */
export class StorageUnavailableError extends Error {
  constructor() {
    super(
      'This browser will not let the app store audio. That usually means private or ' +
        'restricted browsing — try a normal window, or Chrome, Edge or Firefox.',
    )
    this.name = 'StorageUnavailableError'
  }
}

/** Out of room. Recoverable by the user, unlike the above, so it says so differently. */
export class StorageFullError extends Error {
  constructor() {
    super(
      'Out of browser storage. Delete kits or samples you no longer need, or save and ' +
        'reload to reclaim space from deleted ones.',
    )
    this.name = 'StorageFullError'
  }
}

/**
 * Recast a raw IndexedDB failure as one of the two things a user can act on.
 *
 * A quota failure arrives as a `QuotaExceededError` DOMException; anything else at write
 * time is treated as the database being unusable, since by then it has already opened
 * successfully once.
 */
function asStorageError(error: unknown, whenOpening: boolean): Error {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return new StorageFullError()
  }
  if (whenOpening) return new StorageUnavailableError()
  return error instanceof Error ? error : new Error(String(error))
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || indexedDB === null) {
      reject(new StorageUnavailableError())
      return
    }
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (error) {
      // Some privacy modes throw here rather than failing the request.
      reject(asStorageError(error, true))
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(asStorageError(request.error, true))
    // A blocked open never settles on its own, which would hang every import silently.
    request.onblocked = () => reject(new StorageUnavailableError())
  })
  // A failed open must not be cached, or one transient failure would poison the session.
  dbPromise = dbPromise.catch((error: unknown) => {
    dbPromise = null
    throw error
  })
  return dbPromise
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode)
        const request = run(transaction.objectStore(STORE))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(asStorageError(request.error, false))
        transaction.onabort = () => reject(asStorageError(transaction.error, false))
      }),
  )
}

/**
 * Read-through cache. Import, conversion and export all want the same bytes within
 * seconds of each other; round-tripping through IndexedDB each time is pure latency.
 */
const memory = new Map<SampleId, ArrayBuffer>()

/**
 * `cache: false` writes to IndexedDB without populating the read-through cache.
 *
 * Used by the card import, which can walk hundreds of megabytes in one pass. Caching that
 * would pin the entire card in memory to speed up a read that is not coming — the user
 * imported those kits to browse them, not to audition all 2000 samples at once. Everything
 * else caches, because import → convert → audition → export all want the same bytes within
 * seconds of each other.
 */
export async function putAudio(
  id: SampleId,
  bytes: ArrayBuffer,
  { cache = true }: { cache?: boolean } = {},
): Promise<void> {
  if (cache) memory.set(id, bytes)
  else memory.delete(id)
  await tx('readwrite', (store) => store.put(bytes, id))
}

export async function getAudio(id: SampleId): Promise<ArrayBuffer | undefined> {
  const cached = memory.get(id)
  if (cached) return cached
  const stored = await tx<ArrayBuffer | undefined>('readonly', (store) => store.get(id))
  if (stored) memory.set(id, stored)
  return stored
}

/** Throws rather than returning undefined, for call sites that cannot proceed without bytes. */
export async function requireAudio(id: SampleId): Promise<ArrayBuffer> {
  const bytes = await getAudio(id)
  if (!bytes) throw new Error(`Audio data for sample ${id} is missing`)
  return bytes
}

export async function deleteAudio(ids: readonly SampleId[]): Promise<void> {
  for (const id of ids) memory.delete(id)
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite')
    const store = transaction.objectStore(STORE)
    for (const id of ids) store.delete(id)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

/**
 * Drop anything not referenced by the current session. Without this, samples deleted
 * before a reload would leak their bytes forever — IndexedDB has no TTL.
 */
export async function collectGarbage(liveIds: readonly SampleId[]): Promise<number> {
  const live = new Set(liveIds)
  const keys = await tx<IDBValidKey[]>('readonly', (store) => store.getAllKeys())
  const orphans = keys.filter((k): k is string => typeof k === 'string' && !live.has(k))
  if (orphans.length > 0) await deleteAudio(orphans)
  return orphans.length
}

/** Approximate bytes held, for the storage readout. */
export async function estimateUsage(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null
  const { usage = 0, quota = 0 } = await navigator.storage.estimate()
  return { usage, quota }
}
