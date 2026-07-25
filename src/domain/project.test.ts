import { describe, expect, test } from 'bun:test'
import { DEFAULT_BPM } from './sequence'
import { createSequence } from './sequence'
import { createPattern } from './library'
import { PROJECT_FORMAT, buildManifest, hydrateProject, hydrateSample } from './project'
import type { AudioMeta, Kit, Sample, SavedPattern, SavedPreset, Session } from './types'
import { createKit, makeSlot } from './voice'

const meta: AudioMeta = {
  container: 'wav',
  codec: 'pcm',
  sampleRate: 44100,
  bitDepth: 16,
  channels: 1,
  durationSec: 0.6,
  sizeBytes: 52964,
}

function sample(id: string, name = `${id}.wav`): Sample {
  return { id, name, meta, converted: false, status: 'ready' }
}

/** A kit with the given sample ids on SP1. */
function kitWith(ids: string[]): Kit {
  const kit = createKit('A0')
  for (const id of ids) kit.samples[id] = sample(id)
  kit.voices[0]!.layers = ids.map(makeSlot)
  kit.bpm = 140
  return kit
}

function sessionWith(kit: Kit): Session {
  return {
    kits: [kit],
    activeKitId: kit.id,
    transport: { playing: true },
    master: { volume: 0.5 },
    keepAlive: false,
  }
}

const emptyLibrary: { patterns: SavedPattern[]; presets: SavedPreset[] } = {
  patterns: [],
  presets: [],
}

/** What the manifest looks like after a real JSON round trip through the archive. */
function wire(session: Session, library = emptyLibrary): unknown {
  return JSON.parse(JSON.stringify(buildManifest(session, library)))
}

describe('project round trip', () => {
  test('a session survives export and import', () => {
    const session = sessionWith(kitWith(['s1', 's2']))
    const result = hydrateProject(wire(session), new Set(['s1', 's2']))!

    expect(result.session.kits).toHaveLength(1)
    expect(result.session.kits[0]!.code).toBe('A0')
    expect(result.session.kits[0]!.voices[0]!.layers.map((s) => s.sampleId)).toEqual(['s1', 's2'])
    expect(result.session.kits[0]!.bpm).toBe(140)
    expect(result.session.master.volume).toBe(0.5)
    expect(result.session.keepAlive).toBe(false)
    expect(result.missingAudio).toEqual([])
  })

  test('never imports as playing', () => {
    const session = sessionWith(kitWith(['s1']))
    expect(session.transport.playing).toBe(true)
    expect(hydrateProject(wire(session), new Set(['s1']))!.session.transport.playing).toBe(false)
  })

  test('the library travels with the project', () => {
    const pattern = createPattern('Hats', createSequence(), 'Hi-hat', 'p1')
    const session = sessionWith(kitWith(['s1']))
    const result = hydrateProject(wire(session, { patterns: [pattern], presets: [] }), new Set(['s1']))!

    expect(result.library.patterns).toHaveLength(1)
    expect(result.library.patterns[0]!.name).toBe('Hats')
    expect(result.library.patterns[0]!.sourceChannel).toBe('Hi-hat')
  })
})

describe('samples without audio', () => {
  test('are dropped from both the sample map and the layer order', () => {
    const session = sessionWith(kitWith(['s1', 's2', 's3']))
    const result = hydrateProject(wire(session), new Set(['s1', 's3']))!

    expect(Object.keys(result.session.kits[0]!.samples).sort()).toEqual(['s1', 's3'])
    // The gap closes rather than leaving a hole in the device's layer numbering.
    expect(result.session.kits[0]!.voices[0]!.layers.map((s) => s.sampleId)).toEqual(['s1', 's3'])
  })

  test('are reported by name so the user knows what was lost', () => {
    const kit = kitWith(['s1', 's2'])
    kit.samples.s2!.name = 'ghost-snare.wav'
    const result = hydrateProject(wire(sessionWith(kit)), new Set(['s1']))!
    expect(result.missingAudio).toEqual(['ghost-snare.wav'])
  })

  test('a project whose audio is entirely absent still imports, just empty', () => {
    const result = hydrateProject(wire(sessionWith(kitWith(['s1']))), new Set())!
    expect(result.session.kits[0]!.voices[0]!.layers).toEqual([])
    expect(result.missingAudio).toEqual(['s1.wav'])
  })
})

describe('rejecting what is not a project', () => {
  test('a foreign or malformed manifest is refused', () => {
    expect(hydrateProject(null, new Set())).toBeNull()
    expect(hydrateProject({}, new Set())).toBeNull()
    expect(hydrateProject({ format: 'something-else', version: 1 }, new Set())).toBeNull()
    expect(hydrateProject('a string', new Set())).toBeNull()
  })

  test('a future version is refused rather than half-read', () => {
    const manifest = wire(sessionWith(kitWith(['s1']))) as Record<string, unknown>
    expect(hydrateProject({ ...manifest, version: 2 }, new Set(['s1']))).toBeNull()
  })

  test('a manifest with no usable kit is refused', () => {
    expect(hydrateProject({ format: PROJECT_FORMAT, version: 1, kits: [] }, new Set())).toBeNull()
    // A kit without an id cannot be addressed, so it is not a kit.
    expect(
      hydrateProject({ format: PROJECT_FORMAT, version: 1, kits: [{ code: 'A0' }] }, new Set()),
    ).toBeNull()
  })
})

describe('repairing damaged contents', () => {
  const base = { format: PROJECT_FORMAT, version: 1, kits: [{ id: 'k1', code: 'A0' }] }

  test('an invalid kit code falls back to a legal one', () => {
    const result = hydrateProject({ ...base, kits: [{ id: 'k1', code: 'nope!' }] }, new Set())!
    expect(result.session.kits[0]!.code).toBe('A0')
  })

  test('missing voices are created and the panel order is completed', () => {
    const result = hydrateProject({ ...base, kits: [{ id: 'k1', voiceOrder: [3, 3] }] }, new Set())!
    expect(result.session.kits[0]!.voices.map((v) => v.index)).toEqual([1, 2, 3, 4])
    expect(result.session.kits[0]!.voiceOrder).toEqual([3, 1, 2, 4])
  })

  test('an out-of-range tempo and volume are clamped', () => {
    const result = hydrateProject({ ...base, bpm: 9000, masterVolume: 40 }, new Set())!
    expect(result.session.kits[0]!.bpm).toBe(300)
    expect(result.session.master.volume).toBe(1)
  })

  test('a non-numeric tempo falls back to the default', () => {
    expect(hydrateProject({ ...base, bpm: 'fast' }, new Set())!.session.kits[0]!.bpm).toBe(
      DEFAULT_BPM,
    )
  })

  test('an unknown active kit id falls back to the first kit', () => {
    expect(hydrateProject({ ...base, activeKitId: 'gone' }, new Set())!.session.activeKitId).toBe('k1')
  })

  test('an unknown voice mode or bit depth falls back', () => {
    const result = hydrateProject(
      { ...base, kits: [{ id: 'k1', voices: [{ index: 1, mode: 'quad', targetBitDepth: 24 }] }] },
      new Set(),
    )!
    expect(result.session.kits[0]!.voices[0]!.mode).toBe('mono')
    expect(result.session.kits[0]!.voices[0]!.targetBitDepth).toBe(16)
  })

  test('sequences are rebuilt to four channels however many were stored', () => {
    expect(hydrateProject({ ...base, sequences: [] }, new Set())!.session.kits[0]!.sequences).toHaveLength(4)
    expect(
      hydrateProject({ ...base, sequences: [1, 2, 3, 4, 5, 6] }, new Set())!.session.kits[0]!
        .sequences,
    ).toHaveLength(4)
  })

  test('a garbage library section imports as an empty library', () => {
    const result = hydrateProject({ ...base, library: 'nope' }, new Set())!
    expect(result.library).toEqual({ patterns: [], presets: [] })
  })
})

describe('sample hydration', () => {
  test('an in-flight conversion does not import as stuck converting', () => {
    expect(hydrateSample({ id: 's1', status: 'converting' })!.status).toBe('ready')
    expect(hydrateSample({ id: 's1', status: 'error' })!.status).toBe('error')
  })

  test('a nameless sample falls back to its id rather than showing blank', () => {
    expect(hydrateSample({ id: 's1' })!.name).toBe('s1')
  })

  test('an unknown container or codec reads as unknown, not as playable', () => {
    const hydrated = hydrateSample({ id: 's1', meta: { container: 'wma', codec: 'vorbis' } })!
    expect(hydrated.meta.container).toBe('unknown')
    expect(hydrated.meta.codec).toBe('unknown')
  })

  test('a missing rate or depth stays null rather than inventing a number', () => {
    const hydrated = hydrateSample({ id: 's1', meta: {} })!
    expect(hydrated.meta.sampleRate).toBeNull()
    expect(hydrated.meta.bitDepth).toBeNull()
  })

  test('an idless sample is unusable', () => {
    expect(hydrateSample({ name: 'x.wav' })).toBeNull()
    expect(hydrateSample(null)).toBeNull()
  })
})

describe('sequences and tempo belong to the kit', () => {
  test('each kit round-trips its own patterns, tempo and preset link', () => {
    const a = kitWith(['s1'])
    a.code = 'A0'
    a.bpm = 90
    a.activePresetId = 'factory:house-909'
    a.sequences[0] = { ...a.sequences[0]!, triggers: 7 }

    const b = createKit('B1')
    b.bpm = 175
    b.activePresetId = null
    b.sequences[0] = { ...b.sequences[0]!, triggers: 2 }

    const session: Session = {
      kits: [a, b],
      activeKitId: a.id,
      transport: { playing: false },
      master: { volume: 0.5 },
      keepAlive: true,
    }

    const result = hydrateProject(wire(session), new Set(['s1']))!
    const [ra, rb] = result.session.kits

    expect([ra!.bpm, rb!.bpm]).toEqual([90, 175])
    expect([ra!.sequences[0]!.triggers, rb!.sequences[0]!.triggers]).toEqual([7, 2])
    expect(ra!.activePresetId).toBe('factory:house-909')
    expect(rb!.activePresetId).toBeNull()
  })

  test('a new kit does not share its sequence array with another', () => {
    const a = createKit('A0')
    const b = createKit('A1')
    a.sequences[0]!.steps[0] = true
    expect(b.sequences[0]!.steps[0]).toBe(false)
  })

  test('a nonsense preset link imports as no link at all', () => {
    const base = { format: PROJECT_FORMAT, version: 1 }
    const result = hydrateProject(
      { ...base, kits: [{ id: 'k1', code: 'A0', activePresetId: 42 }] },
      new Set(),
    )!
    expect(result.session.kits[0]!.activePresetId).toBeNull()
  })
})

describe('migrating a project written before kits owned their sequences', () => {
  // Those manifests carry one set of patterns and one tempo at the top level. Copying them
  // into every kit is what the user was actually hearing; it just becomes per-kit and free
  // to diverge from there.
  const legacy = {
    format: PROJECT_FORMAT,
    version: 1,
    kits: [
      { id: 'k1', code: 'A0' },
      { id: 'k2', code: 'A1' },
    ],
    bpm: 143,
    sequences: [
      { kind: 'user', length: 4, steps: [true, false, true, false] },
      { kind: 'euclidean', length: 16, triggers: 6 },
      {},
      {},
    ],
  }

  test('the top-level tempo lands on every kit', () => {
    const result = hydrateProject(legacy, new Set())!
    expect(result.session.kits.map((k) => k.bpm)).toEqual([143, 143])
  })

  test('the top-level patterns land on every kit', () => {
    const result = hydrateProject(legacy, new Set())!
    for (const kit of result.session.kits) {
      expect(kit.sequences).toHaveLength(4)
      expect(kit.sequences[0]!.steps).toEqual([true, false, true, false])
      expect(kit.sequences[1]!.triggers).toBe(6)
    }
  })

  test("a kit's own values still win over the legacy top-level ones", () => {
    const mixed = {
      ...legacy,
      kits: [{ id: 'k1', code: 'A0', bpm: 100, sequences: [{ kind: 'euclidean', triggers: 3 }] }],
    }
    const kit = hydrateProject(mixed, new Set())!.session.kits[0]!
    expect(kit.bpm).toBe(100)
    expect(kit.sequences[0]!.triggers).toBe(3)
  })
})
