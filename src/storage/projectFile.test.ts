import { describe, expect, test } from 'bun:test'
import JSZip from 'jszip'
import { buildManifest, hydrateProject } from '~/domain/project'
import type { Sample, SampleId, Session } from '~/domain/types'
import { createKit, makeSlot } from '~/domain/voice'
import { NotAProjectFile, packProject, unpackProject } from './projectFile'

/**
 * The archive layer, end to end. `hydrateProject` is covered in project.test.ts; what
 * matters here is that bytes written under a sample id come back under the same id —
 * a naming slip in this pair would silently drop audio on every import.
 */

const meta = {
  container: 'wav' as const,
  codec: 'pcm' as const,
  sampleRate: 44100,
  bitDepth: 16,
  channels: 1,
  durationSec: 0.6,
  sizeBytes: 8,
}

function sample(id: string): Sample {
  return { id, name: `${id}.wav`, meta, converted: true, status: 'ready' }
}

function sessionWith(ids: string[]): Session {
  const kit = createKit('B7')
  for (const id of ids) kit.samples[id] = sample(id)
  kit.voices[0]!.layers = ids.map(makeSlot)
  kit.bpm = 96
  return {
    kits: [kit],
    activeKitId: kit.id,
    transport: { playing: false },
    master: { volume: 0.7 },
    keepAlive: true,
  }
}

/** Distinct bytes per id, so a mix-up shows up as wrong content rather than passing. */
function bytesFor(id: string, fill: number): ArrayBuffer {
  const buffer = new ArrayBuffer(8)
  new Uint8Array(buffer).fill(fill)
  new Uint8Array(buffer)[0] = id.charCodeAt(0)
  return buffer
}

const emptyLibrary = { patterns: [], presets: [] }

describe('pack / unpack round trip', () => {
  test('audio comes back keyed by the same sample ids', async () => {
    const audio = new Map<SampleId, ArrayBuffer>([
      ['s1', bytesFor('s1', 11)],
      ['s2', bytesFor('s2', 22)],
    ])
    const archive = await packProject(buildManifest(sessionWith(['s1', 's2']), emptyLibrary), audio)

    const read = await unpackProject(archive)
    expect([...read.audio.keys()].sort()).toEqual(['s1', 's2'])
    expect(new Uint8Array(read.audio.get('s1')!)).toEqual(new Uint8Array(bytesFor('s1', 11)))
    expect(new Uint8Array(read.audio.get('s2')!)).toEqual(new Uint8Array(bytesFor('s2', 22)))
  })

  test('the manifest survives and rehydrates into the same session', async () => {
    const session = sessionWith(['s1'])
    const archive = await packProject(buildManifest(session, emptyLibrary), new Map([['s1', bytesFor('s1', 1)]]))

    const { manifest, audio } = await unpackProject(archive)
    const result = hydrateProject(manifest, new Set(audio.keys()))!

    expect(result.session.kits[0]!.code).toBe('B7')
    expect(result.session.kits[0]!.voices[0]!.layers.map((s) => s.sampleId)).toEqual(['s1'])
    expect(result.session.kits[0]!.bpm).toBe(96)
    expect(result.missingAudio).toEqual([])
  })

  test('ids containing regex-significant characters survive', async () => {
    // Ids are generated, but an id that broke the folder pattern would lose its audio
    // silently, so pin the behaviour rather than assume the generator never changes.
    const id = 'a.b-c_d'
    const archive = await packProject({}, new Map([[id, bytesFor(id, 5)]]))
    expect([...(await unpackProject(archive)).audio.keys()]).toEqual([id])
  })

  test('an empty project packs and unpacks without audio', async () => {
    const archive = await packProject(buildManifest(sessionWith([]), emptyLibrary), new Map())
    const read = await unpackProject(archive)
    expect(read.audio.size).toBe(0)
    expect(hydrateProject(read.manifest, new Set())).not.toBeNull()
  })
})

describe('rejecting files that are not projects', () => {
  test('a non-ZIP is rejected with a readable reason', async () => {
    const notAZip = new Blob(['this is not a zip'], { type: 'text/plain' })
    await expect(unpackProject(notAZip)).rejects.toBeInstanceOf(NotAProjectFile)
  })

  test('a ZIP without a manifest — a kit export, say — is rejected', async () => {
    const zip = new JSZip()
    zip.folder('A0')!.file('1_01_kick.wav', new ArrayBuffer(4))
    const archive = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' })

    await expect(unpackProject(archive)).rejects.toThrow(/project\.json/)
  })

  test('a manifest that is not JSON is rejected', async () => {
    const zip = new JSZip()
    zip.file('project.json', '{ not json')
    const archive = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' })

    await expect(unpackProject(archive)).rejects.toThrow(/not valid JSON/)
  })

  test('stray files outside the audio folder are ignored', async () => {
    const zip = new JSZip()
    zip.file('project.json', '{}')
    zip.file('readme.wav', new ArrayBuffer(4))
    zip.folder('audio')!.file('s1.wav', bytesFor('s1', 3))
    zip.folder('audio')!.folder('nested')!.file('s2.wav', new ArrayBuffer(4))
    const archive = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' })

    // Only audio/<id>.wav counts — not a stray root file, not a nested one whose id
    // would otherwise be read as "nested/s2".
    expect([...(await unpackProject(archive)).audio.keys()]).toEqual(['s1'])
  })
})
