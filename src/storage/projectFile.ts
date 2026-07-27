import JSZip from 'jszip'
import { contentKey, putCached } from '~/analysis/cache'
import { FEATURES_VERSION } from '~/analysis/features'
import type { AudioFeatures } from '~/analysis/features'
import { AUDIO_DIR, buildManifest, hydrateProject } from '~/domain/project'
import type { ProjectImport } from '~/domain/project'
import type { SampleId, SavedPattern, SavedPreset, Session } from '~/domain/types'
import { referencedSampleIds } from '~/domain/voice'
import { triggerDownload } from '~/export/writers'
import { getAudio, putAudio } from './audioStore'

/**
 * Read and write the portable project archive.
 *
 * A ZIP rather than a lone .json because the session's audio lives in IndexedDB, and a
 * JSON file carrying only structure would import as a session where every sample row
 * points at bytes that aren't there. The archive holds the manifest plus the actual WAVs,
 * so a project can move between machines and come back whole.
 */

const MANIFEST_NAME = 'project.json'

/**
 * Cached analysis, carried alongside the audio.
 *
 * Its own entry rather than a field in the manifest, because it is the one part of the
 * archive that is *derived*: a reader that cannot parse it, or does not know what it is,
 * must be able to skip it and still open the project. Keeping it out of `project.json`
 * makes that structural rather than a matter of careful coding.
 *
 * Keyed by content hash for the same reason the cache is: it lands straight in the
 * recipient's cache, and samples they already own cost nothing twice.
 */
const ANALYSIS_NAME = 'analysis.json'

/** What the archive carries: content hash to measurements. */
export type AnalysisArchive = Record<string, AudioFeatures>

export class NotAProjectFile extends Error {
  constructor(detail: string) {
    super(detail)
    this.name = 'NotAProjectFile'
  }
}

/** Slug for the download filename — kit codes, so the file says what's in it. */
function projectFilename(session: Session): string {
  const codes = session.kits.map((k) => k.code).join('-')
  const stamp = new Date().toISOString().slice(0, 10)
  return `rample-project-${codes || 'empty'}-${stamp}.zip`
}

/**
 * Assemble the archive. Separated from the download so the pack/unpack pair can be tested
 * without a DOM — this is the layer where a naming mistake would silently lose audio.
 */
export async function packProject(
  manifest: unknown,
  audio: ReadonlyMap<SampleId, ArrayBuffer>,
  analysis?: AnalysisArchive,
): Promise<ArrayBuffer> {
  const zip = new JSZip()
  zip.file(MANIFEST_NAME, JSON.stringify(manifest, null, 2))
  if (analysis && Object.keys(analysis).length > 0) {
    zip.file(ANALYSIS_NAME, JSON.stringify(analysis))
  }
  const folder = zip.folder(AUDIO_DIR)!
  for (const [id, bytes] of audio) folder.file(`${id}.wav`, bytes)

  // Bytes rather than a Blob so pack and unpack are symmetric and testable outside a
  // browser; the Blob is only needed at the download boundary.
  //
  // STORE for the same reason the kit export uses it: PCM barely deflates, and
  // compressing tens of megabytes stalls the main thread to save a few percent.
  return zip.generateAsync({ type: 'arraybuffer', compression: 'STORE' })
}

/** Read an archive back into its manifest and audio. Throws NotAProjectFile if it isn't one. */
export async function unpackProject(
  file: Blob | ArrayBuffer | Uint8Array,
): Promise<{ manifest: unknown; audio: Map<SampleId, ArrayBuffer>; analysis: AnalysisArchive }> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(file)
  } catch {
    throw new NotAProjectFile('That file is not a readable ZIP archive.')
  }

  const manifestEntry = zip.file(MANIFEST_NAME)
  if (!manifestEntry) {
    throw new NotAProjectFile(`No ${MANIFEST_NAME} inside the archive — is this a kit export?`)
  }

  let manifest: unknown
  try {
    manifest = JSON.parse(await manifestEntry.async('string'))
  } catch {
    throw new NotAProjectFile(`${MANIFEST_NAME} is not valid JSON.`)
  }

  const audio = new Map<SampleId, ArrayBuffer>()
  for (const entry of zip.file(new RegExp(`^${AUDIO_DIR}/[^/]+\\.wav$`, 'i'))) {
    const id = entry.name.slice(AUDIO_DIR.length + 1).replace(/\.wav$/i, '')
    if (id) audio.set(id, await entry.async('arraybuffer'))
  }

  return { manifest, audio, analysis: await readAnalysis(zip) }
}

/**
 * Read the cached analysis, if there is any that this version can use.
 *
 * Every failure path returns an empty archive rather than throwing. Nothing here is
 * load-bearing — a project whose analysis is missing, corrupt, or written by a version
 * that measured things differently opens exactly the same, and re-measures in the
 * background. The version check is the important one: mixing two generations of
 * measurements would be worse than having none.
 */
async function readAnalysis(zip: JSZip): Promise<AnalysisArchive> {
  const entry = zip.file(ANALYSIS_NAME)
  if (!entry) return {}
  try {
    const parsed: unknown = JSON.parse(await entry.async('string'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const usable: AnalysisArchive = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const features = value as AudioFeatures | undefined
      if (features?.version === FEATURES_VERSION) usable[key] = features
    }
    return usable
  } catch {
    return {}
  }
}

export async function exportProject(
  session: Session,
  library: { patterns: readonly SavedPattern[]; presets: readonly SavedPreset[] },
  /**
   * Measurements to carry along, by sample id. Optional — an archive without them is a
   * valid project that simply re-measures on the other side.
   */
  features?: ReadonlyMap<SampleId, AudioFeatures>,
): Promise<{ filename: string; samples: number; missing: string[] }> {
  const audio = new Map<SampleId, ArrayBuffer>()
  const missing: string[] = []

  // Deduplicated: the same id can be referenced from more than one place, and writing it
  // twice would double the archive for nothing.
  for (const id of new Set(referencedSampleIds(session.kits))) {
    const bytes = await getAudio(id)
    if (bytes) audio.set(id, bytes)
    else missing.push(id)
  }

  // Re-keyed from sample id to content hash here, where the bytes are already in hand.
  // Doing it at the call site would mean reading every sample twice.
  const analysis: AnalysisArchive = {}
  if (features) {
    for (const [id, bytes] of audio) {
      const measured = features.get(id)
      if (measured) analysis[await contentKey(bytes)] = measured
    }
  }

  const bytes = await packProject(buildManifest(session, library), audio, analysis)
  const filename = projectFilename(session)
  triggerDownload(new Blob([bytes], { type: 'application/zip' }), filename)
  return { filename, samples: audio.size, missing }
}

/**
 * Read an archive and write its audio into IndexedDB.
 *
 * The audio is stored before the caller swaps in the session, so the restored state never
 * references bytes that aren't in place yet. Anything the manifest claims but the archive
 * lacks is reported rather than silently restored as a dead row.
 */
export async function importProject(file: File): Promise<ProjectImport> {
  // The audio is read first: which samples survive the import depends on what is actually
  // present, so hydration needs that set before it runs.
  const { manifest, audio: bytesById, analysis } = await unpackProject(file)

  const result = hydrateProject(manifest, new Set(bytesById.keys()))
  if (!result) {
    throw new NotAProjectFile('That archive is not a Rample Kit Studio project, or is empty.')
  }

  // Only the audio the hydrated session actually kept — a sample dropped for any other
  // reason should not leave orphan bytes behind for the garbage collector to find.
  const live = new Set(referencedSampleIds(result.session.kits))
  for (const [id, bytes] of bytesById) {
    if (live.has(id)) await putAudio(id, bytes)
  }

  // Seeded after the audio, and never allowed to fail the import: re-measuring a card is
  // a minute of background work, but a project that will not open is the whole thing.
  for (const [key, measured] of Object.entries(analysis)) {
    await putCached(key, measured)
  }

  return result
}
