import { create } from 'zustand'
import { forgetBuffers, invalidateBuffer, preload } from '~/audio/buffers'
import {
  setKeepAlive as applyKeepAlive,
  setMasterVolume as applyMasterVolume,
  setVoiceVolume as applyVoiceVolume,
  stopVoice,
} from '~/audio/engine'
import { convertToTarget } from '~/audio/convert'
import { UnreadableAudioError, readMetadata } from '~/audio/metadata'
import { countLayers, resolveCode } from '~/domain/cardImport'
import { MAX_KITS_PER_SESSION } from '~/domain/limits'
import type { CardPlan } from '~/domain/cardImport'
import { VOICE_INDICES } from '~/domain/device'
import type { BitDepth, VoiceIndex } from '~/domain/device'
import { nextAvailableKitCode, normaliseKitCode, validateKitCode } from '~/domain/kitCode'
import type { KitCodeError } from '~/domain/kitCode'
import { cloneSequence, emptySequence } from '~/domain/library'
import { clampBpm, clampLength, randomiseSequence } from '~/domain/sequence'
import type {
  ChannelSequence,
  ConvertMode,
  DensityMode,
  Kit,
  KitId,
  PreviewMode,
  Sample,
  SampleId,
  Session,
  Slot,
  SlotId,
  VoiceMode,
} from '~/domain/types'
import { isSampleValid, targetForVoice } from '~/domain/validation'
import {
  channelsInSlotOrder,
  collapseDuplicateSlots,
  createKit,
  distinctSamples,
  duplicateSlotAt,
  findVoice,
  makeSlot,
  moveLayer,
  normaliseChannelName,
  referencedSampleIds,
  setSlotWeight,
} from '~/domain/voice'
import { newId } from '~/lib/id'
import { collectGarbage, deleteAudio, putAudio, requireAudio } from '~/storage/audioStore'
import { clearSession, loadSession, saveSession } from '~/storage/sessionStore'

export type NoticeKind = 'info' | 'success' | 'warning' | 'error'

/** What an SD card import actually did, for the report afterwards. */
export interface CardImportResult {
  kits: number
  layers: number
  /** Kits whose code was already in use by a kit that had samples in it. */
  renamed: { from: string; to: string }[]
  /** Files that could not be read at all. */
  failed: string[]
  /** Kits left on the card because the session was full. */
  skipped: string[]
}

export interface Notice {
  id: string
  kind: NoticeKind
  message: string
  /**
   * An optional single action, used for undo. Dismissing the notice is what expires the
   * offer, so the notice's lifetime *is* the undo window — there is no second timer to
   * keep in step with it.
   */
  action?: { label: string; run: () => void }
}

interface SessionState extends Session {
  notices: Notice[]
  /** Sample ids with a conversion in flight, so rows can show progress. */
  converting: Record<SampleId, true>
  /** True when state has changed since the last explicit save. */
  dirty: boolean
  lastSavedAt: string | null

  // Kits
  addKit: () => void
  removeKit: (id: KitId) => void
  setActiveKit: (id: KitId) => void
  renameKit: (id: KitId, code: string) => KitCodeError | null

  // Voice settings
  renameChannel: (voice: VoiceIndex, name: string) => void
  setVoiceMode: (voice: VoiceIndex, mode: VoiceMode) => void
  setConvertMode: (voice: VoiceIndex, mode: ConvertMode) => void
  setTargetBitDepth: (voice: VoiceIndex, depth: BitDepth) => void
  setVoiceOrder: (order: VoiceIndex[]) => void
  /** Mixer mute and solo, preview-only. */
  toggleMute: (voice: VoiceIndex) => void
  toggleSolo: (voice: VoiceIndex) => void
  /** Drop every solo at once, for the "release all" affordance. */
  clearSolos: () => void

  // Samples
  importFiles: (voice: VoiceIndex, files: File[]) => Promise<void>
  /** Read kit folders off an SD card into new kits. */
  importCard: (
    plan: CardPlan<File>,
    onProgress?: (done: number, total: number) => void,
  ) => Promise<CardImportResult>
  /** Remove one layer slot, reversibly. The sample survives while any other slot holds it. */
  removeSlot: (voice: VoiceIndex, slotId: SlotId) => void
  /** Put a removed slot back at its old position. */
  restoreSlot: (kitId: KitId, voice: VoiceIndex, at: number, slot: Slot) => void
  moveSample: (
    from: { voice: VoiceIndex; index: number },
    to: { voice: VoiceIndex; index: number },
  ) => void
  /** Exclude or re-include a sample in Random-mode selection. Preview-only. */
  toggleRandomMute: (voice: VoiceIndex, id: SampleId) => void
  /**
   * How many of the voice's twelve slots a sample occupies — its weight in the random draw,
   * and how many copies of it the card receives.
   */
  setSampleWeight: (voice: VoiceIndex, id: SampleId, weight: number) => void
  /** Duplicate one slot in place, to build a cyclic sequence by hand. */
  duplicateSlot: (voice: VoiceIndex, slotId: SlotId) => void
  convertSample: (voice: VoiceIndex, id: SampleId) => Promise<void>
  convertVoice: (voice: VoiceIndex) => Promise<void>

  // Mixer (preview-only, never exported)
  setVoiceVolume: (voice: VoiceIndex, volume: number) => void
  setMasterVolume: (volume: number) => void
  setKeepAlive: (enabled: boolean) => void
  setPreviewMode: (voice: VoiceIndex, mode: PreviewMode) => void
  setPreviewCursor: (voice: VoiceIndex, cursor: number) => void

  // Sequencer (preview-only, never exported)
  setBpm: (bpm: number) => void
  setPlaying: (playing: boolean) => void
  updateSequence: (voice: VoiceIndex, patch: Partial<ChannelSequence>) => void
  toggleStep: (voice: VoiceIndex, step: number) => void
  randomiseChannel: (voice: VoiceIndex, mode: DensityMode) => void
  randomiseAll: () => void
  applyPendingRandomise: (voice: VoiceIndex) => void

  // Library recall. Copy-out is the library's job; these copy again on the way in.
  loadPatternInto: (voice: VoiceIndex, sequence: ChannelSequence) => void
  loadPreset: (
    sequences: readonly ChannelSequence[],
    channelNames: readonly string[],
    bpm: number,
    /** The preset being recalled, recorded on the kit so it knows which scene it is. */
    presetId?: string | null,
  ) => void
  /** Record (or with null, forget) which preset the active kit's channels came from. */
  setActivePreset: (id: string | null) => void
  /** Detach a deleted preset from every kit that still points at it. */
  forgetPreset: (id: string) => void
  /** Record the library name a channel's pattern was saved under. */
  nameSequence: (voice: VoiceIndex, name: string) => void
  clearSequences: () => void

  // Session
  save: () => void
  restore: () => boolean
  /** Swap in a whole session — used by the project-file import. */
  replaceSession: (session: Session) => void
  resetSession: () => void

  // Notices
  notify: (kind: NoticeKind, message: string, action?: Notice['action']) => void
  dismissNotice: (id: string) => void
}

function freshSession(): Session {
  const kit = createKit('A0')
  return {
    kits: [kit],
    activeKitId: kit.id,
    transport: { playing: false },
    master: { volume: 0.8 },
    keepAlive: true,
  }
}

/**
 * Push a session's levels into the live audio graph.
 *
 * Levels are state *and* audio parameters, so applying them is part of loading a session —
 * otherwise the faders would show the loaded positions while the engine still ran at its
 * defaults.
 */
function applySessionToGraph(session: Session): void {
  applyMasterVolume(session.master.volume)
  applyKeepAlive(session.keepAlive)
  const active = session.kits.find((k) => k.id === session.activeKitId)
  for (const voice of active?.voices ?? []) {
    applyVoiceVolume(voice.index, voice.mixer.volume)
  }
}

/**
 * Structural clone of the active kit, applying `mutate` to it.
 *
 * Zustand compares by reference, so mutating a kit in place would leave the UI stale.
 * Cloning the one kit that changed — rather than the whole session — keeps other kits'
 * references stable so their tabs don't re-render.
 */
function withActiveKit(state: SessionState, mutate: (kit: Kit) => void): Partial<SessionState> {
  const index = state.kits.findIndex((k) => k.id === state.activeKitId)
  if (index === -1) return {}

  const clone: Kit = {
    ...state.kits[index]!,
    voices: state.kits[index]!.voices.map((v) => ({ ...v, layers: [...v.layers] })),
    voiceOrder: [...state.kits[index]!.voiceOrder],
    samples: { ...state.kits[index]!.samples },
    sequences: [...state.kits[index]!.sequences],
  }
  mutate(clone)

  const kits = [...state.kits]
  kits[index] = clone
  return { kits, dirty: true }
}

/** The kit every sequencer and mixer action applies to. */
function activeKitOf(state: { kits: Kit[]; activeKitId: KitId }): Kit {
  return state.kits.find((k) => k.id === state.activeKitId) ?? state.kits[0]!
}

/**
 * Rewrite the active kit's sequences.
 *
 * `mutate` is handed each sequence with the identity of the channel it belongs to, and
 * returns its replacement. Every sequencer action goes through here, which is what keeps
 * patterns attached to the kit rather than to the session.
 */
function withSequences(
  state: SessionState,
  mutate: (sequence: ChannelSequence, channel: VoiceIndex) => ChannelSequence,
): Partial<SessionState> {
  return withActiveKit(state, (kit) => {
    kit.sequences = kit.sequences.map((sequence, i) => mutate(sequence, (i + 1) as VoiceIndex))
  })
}

/**
 * Decode audio that arrived while the transport is running.
 *
 * The scheduler's inner loop must stay synchronous, so it only ever reads *already
 * decoded* buffers — everything is decoded up front in `startTransport`. That leaves a
 * gap: a sample imported (or re-encoded by a conversion) mid-playback has no decoded
 * buffer, so `triggerScheduled` silently skips it and the channel stays mute until the
 * transport is restarted.
 *
 * Decoding it here closes the gap. The channel starts sounding as soon as the decode
 * lands, which in practice is the next step or two.
 *
 * Gated on the transport actually running: an idle app should not decode on import, or a
 * card import would decode two thousand files nobody asked to hear.
 */
function decodeIfPlaying(state: { transport: { playing: boolean } }, ids: readonly SampleId[]): void {
  if (!state.transport.playing || ids.length === 0) return
  void preload(ids)
}

export const useSession = create<SessionState>((set, get) => ({
  ...freshSession(),
  notices: [],
  converting: {},
  dirty: false,
  lastSavedAt: null,

  notify: (kind, message, action) =>
    set((state) => ({
      notices: [...state.notices, { id: newId(), kind, message, ...(action ? { action } : {}) }],
    })),

  dismissNotice: (id) => set((state) => ({ notices: state.notices.filter((n) => n.id !== id) })),

  // ── Kits ──────────────────────────────────────────────────────────────────────

  addKit: () =>
    set((state) => {
      // The tab row stops being navigable past this many; the UI disables the button too,
      // but the guard lives here so no other caller can slip past it.
      if (state.kits.length >= MAX_KITS_PER_SESSION) return {}
      const kit = createKit(nextAvailableKitCode(state.kits.map((k) => k.code)))
      return { kits: [...state.kits, kit], activeKitId: kit.id, dirty: true }
    }),

  removeKit: (id) => {
    const state = get()
    // Keep at least one kit — an empty session has nothing to show and no tab to click.
    if (state.kits.length <= 1) return

    // Side effects before set(), not inside the updater: a store updater may be called
    // more than once and must stay pure, or audio gets deleted twice.
    const removed = state.kits.find((k) => k.id === id)
    if (removed) {
      const ids = removed.voices.flatMap((v) => v.layers.map((slot) => slot.sampleId))
      for (const voice of VOICE_INDICES) stopVoice(voice)
      forgetBuffers(ids)
      // Bytes are deliberately *not* deleted here. `collectGarbage` on Save sweeps whatever
      // the session no longer references, which means a deletion is reversible right up
      // until the user commits it — and nothing is destroyed inside a store updater, which
      // may run more than once.
    }

    const kits = state.kits.filter((k) => k.id !== id)
    set({
      kits,
      activeKitId: state.activeKitId === id ? kits[0]!.id : state.activeKitId,
      dirty: true,
    })
  },

  /**
   * Switch kits.
   *
   * Three things have to happen together, and leaving any of them out is a bug that would
   * only show up as confusion:
   *
   * - Playback stops. Patterns and tempo are per kit now, so continuing across a switch
   *   would swap the groove and the tempo underneath a running clock. Stopping is the
   *   honest cut, and re-pressing play is one keystroke. The scheduler subscribes to this
   *   itself, since the clock is its business and the store must not import it.
   * - Sounding voices stop. They are playing the *outgoing* kit's samples.
   * - The incoming kit's mixer levels are pushed to the graph, or the faders would show
   *   the new kit's values while the engine still ran at the old kit's.
   */
  setActiveKit: (id) => {
    for (const voice of VOICE_INDICES) stopVoice(voice)
    set({ activeKitId: id })
    const state = get()
    for (const voice of activeKitOf(state).voices) applyVoiceVolume(voice.index, voice.mixer.volume)
  },

  renameKit: (id, code) => {
    const state = get()
    const taken = state.kits.filter((k) => k.id !== id).map((k) => k.code)
    const error = validateKitCode(code, taken)
    if (error) return error

    const normalised = normaliseKitCode(code)
    set({
      kits: state.kits.map((k) => (k.id === id ? { ...k, code: normalised } : k)),
      dirty: true,
    })
    return null
  },

  // ── Voice settings ────────────────────────────────────────────────────────────

  renameChannel: (voiceIndex, name) =>
    set((state) =>
      withActiveKit(state, (kit) => {
        const voice = findVoice(kit, voiceIndex)
        if (voice) voice.name = normaliseChannelName(name, voiceIndex)
      }),
    ),

  setVoiceMode: (voiceIndex, mode) =>
    set((state) =>
      withActiveKit(state, (kit) => {
        const voice = findVoice(kit, voiceIndex)
        if (voice) voice.mode = mode
        // Validity is derived at render time, so flipping mono/stereo re-validates
        // every layer on this voice automatically — the re-validation
        // requirement falls out rather than needing a pass.
      }),
    ),

  setConvertMode: (voiceIndex, mode) =>
    set((state) =>
      withActiveKit(state, (kit) => {
        const voice = findVoice(kit, voiceIndex)
        if (voice) voice.convertMode = mode
      }),
    ),

  setTargetBitDepth: (voiceIndex, depth) =>
    set((state) =>
      withActiveKit(state, (kit) => {
        const voice = findVoice(kit, voiceIndex)
        if (voice) voice.targetBitDepth = depth
      }),
    ),

  setVoiceOrder: (order) => set((state) => withActiveKit(state, (kit) => void (kit.voiceOrder = order))),

  toggleMute: (voiceIndex) =>
    set((state) =>
      withActiveKit(state, (kit) => {
        const voice = findVoice(kit, voiceIndex)
        if (voice) voice.muted = !voice.muted
      }),
    ),

  toggleSolo: (voiceIndex) =>
    set((state) =>
      withActiveKit(state, (kit) => {
        const voice = findVoice(kit, voiceIndex)
        if (voice) voice.soloed = !voice.soloed
      }),
    ),

  clearSolos: () =>
    set((state) =>
      withActiveKit(state, (kit) => {
        for (const voice of kit.voices) voice.soloed = false
      }),
    ),

  // ── Samples ───────────────────────────────────────────────────────────────────

  importFiles: async (voiceIndex, files) => {
    const imported: Sample[] = []
    const failures: string[] = []

    for (const file of files) {
      try {
        const { bytes, meta } = await readMetadata(file)
        const sample: Sample = {
          id: newId(),
          name: file.name,
          meta,
          converted: false,
          status: 'ready',
        }
        await putAudio(sample.id, bytes)
        imported.push(sample)
      } catch (error) {
        const reason =
          error instanceof UnreadableAudioError ? error.message : 'Could not read this file.'
        failures.push(`${file.name} — ${reason}`)
      }
    }

    if (imported.length > 0) {
      set((state) =>
        withActiveKit(state, (kit) => {
          const voice = findVoice(kit, voiceIndex)
          if (!voice) return
          for (const sample of imported) {
            kit.samples[sample.id] = sample
            voice.layers.push(makeSlot(sample.id))
          }
        }),
      )
    }

    decodeIfPlaying(get(), imported.map((sample) => sample.id))

    for (const failure of failures) get().notify('error', failure)

    // Auto mode converts on drop. Done after the samples are in the store so
    // the rows appear immediately and then settle, rather than after a long silence.
    const kit = get().kits.find((k) => k.id === get().activeKitId)
    const voice = kit ? findVoice(kit, voiceIndex) : undefined
    if (voice?.convertMode === 'auto') {
      const target = targetForVoice(voice)
      for (const sample of imported) {
        if (!isSampleValid(sample.meta, target)) {
          await get().convertSample(voiceIndex, sample.id)
        }
      }
    }
  },

  /**
   * Import kit folders from an SD card.
   *
   * Three things make this different from dropping files on a voice:
   *
   * - It builds every kit fully in memory and commits them in a single `set`. A card can
   *   carry thousands of files, and one store update per file would re-render the app
   *   thousands of times.
   * - Nothing is auto-converted. The card's contents are by definition already in the
   *   device's format, so conversion would be thousands of pointless decodes; anything that
   *   genuinely is invalid still shows red and can be converted afterwards.
   * - Audio is written past the read-through cache, so importing a full card does not pin
   *   it all in memory.
   *
   * Each imported kit gets the default sequencer state, since a card carries no patterns.
   */
  importCard: async (plan, onProgress) => {
    const result: CardImportResult = { kits: 0, layers: 0, renamed: [], failed: [], skipped: [] }
    const total = countLayers(plan)
    let done = 0

    // Codes claimed during *this* import, so two incoming kits cannot resolve to the same one.
    const claimed = new Set<string>()
    const existing = get().kits.map((kit) => ({
      id: kit.id,
      code: kit.code,
      sampleCount: Object.keys(kit.samples).length,
    }))

    const built: { kit: Kit; replacesId: string | null }[] = []

    // A factory card holds 184 kits and a session holds far fewer, so the surplus is
    // reported rather than silently dropped or allowed to swamp the tab row.
    const existingCount = get().kits.length
    const emptyOnes = existing.filter((k) => k.sampleCount === 0).length
    let room = Math.max(0, MAX_KITS_PER_SESSION - existingCount + emptyOnes)

    for (const planned of plan.kits) {
      if (room === 0) {
        result.skipped.push(planned.code)
        continue
      }
      room--
      const resolution = resolveCode(planned.code, existing, claimed)
      claimed.add(resolution.code)
      if (resolution.kind === 'renamed') {
        result.renamed.push({ from: resolution.from, to: resolution.code })
      }

      const kit = createKit(resolution.code)
      for (const layer of planned.layers) {
        try {
          const { bytes, meta } = await readMetadata(layer.file)
          const sample: Sample = {
            id: newId(),
            name: layer.file.name,
            meta,
            converted: false,
            status: 'ready',
          }
          await putAudio(sample.id, bytes, { cache: false })
          kit.samples[sample.id] = sample
          findVoice(kit, layer.voice)?.layers.push(makeSlot(sample.id))
          result.layers++
        } catch {
          result.failed.push(layer.file.name)
        }
        onProgress?.(++done, total)
      }

      built.push({ kit, replacesId: resolution.kind === 'takeover' ? resolution.kitId : null })
      result.kits++
    }

    if (built.length === 0) return result

    set((state) => {
      // A taken-over kit is replaced in place, so the tab does not jump to the end.
      const replaced = new Map(
        built.filter((b) => b.replacesId).map((b) => [b.replacesId!, b.kit]),
      )
      const kept = state.kits.map((kit) => replaced.get(kit.id) ?? kit)
      const appended = built.filter((b) => !b.replacesId).map((b) => b.kit)
      const kits = [...kept, ...appended]
      return {
        kits,
        // Land on the first imported kit, which is what the user just asked to see.
        activeKitId: built[0]!.kit.id,
        dirty: true,
      }
    })

    for (const voice of VOICE_INDICES) stopVoice(voice)
    const active = activeKitOf(get())
    for (const voice of active.voices) applyVoiceVolume(voice.index, voice.mixer.volume)

    return result
  },

  /**
   * Remove one layer slot.
   *
   * A row is a slot, so this removes that slot only. The sample itself — and its audio —
   * survives as long as any other slot still points at it, which is what keeps the
   * remaining copies of a duplicated sample working after one of them is deleted.
   */
  /**
   * Remove one layer slot, reversibly.
   *
   * A row is a slot, so this removes that slot only. The sample itself survives as long as
   * any other slot points at it, which is what keeps the remaining copies of a duplicated
   * sample working after one of them is deleted.
   *
   * Nothing is destroyed: the audio stays in IndexedDB until the next Save sweeps it, so
   * the undo offered alongside is a plain state restore rather than a re-import.
   */
  removeSlot: (voiceIndex, slotId) => {
    const kit = activeKitOf(get())
    const voice = findVoice(kit, voiceIndex)
    const at = voice?.layers.findIndex((s) => s.id === slotId) ?? -1
    const slot = at >= 0 ? voice!.layers[at]! : undefined
    if (!voice || !slot) return

    const sample = kit.samples[slot.sampleId]
    const kitId = kit.id
    stopVoice(voiceIndex)

    set((s2) =>
      withActiveKit(s2, (k) => {
        const target = findVoice(k, voiceIndex)
        if (target) target.layers = target.layers.filter((entry) => entry.id !== slotId)
        // The sample itself is left in place even when its last slot goes: putting the slot
        // back has to restore the row completely, and an orphaned entry costs nothing until
        // the next Save, which drops it along with its bytes.
      }),
    )

    get().notify('info', `Removed ${sample?.name ?? 'sample'}.`, {
      label: 'Undo',
      run: () => get().restoreSlot(kitId, voiceIndex, at, slot),
    })
  },

  /** Put a removed slot back where it was. The undo half of `removeSlot`. */
  restoreSlot: (kitId, voiceIndex, at, slot) =>
    set((state) => {
      const index = state.kits.findIndex((k) => k.id === kitId)
      if (index === -1) return {}

      const kit = state.kits[index]!
      // Already back — an undo pressed twice must not duplicate the row.
      if (kit.voices.some((v) => v.layers.some((entry) => entry.id === slot.id))) return {}

      const kits = [...state.kits]
      kits[index] = {
        ...kit,
        voices: kit.voices.map((voice) => {
          if (voice.index !== voiceIndex) return voice
          const layers = [...voice.layers]
          layers.splice(Math.min(at, layers.length), 0, slot)
          return { ...voice, layers }
        }),
      }
      return { kits, dirty: true }
    }),

  moveSample: (from, to) => set((state) => withActiveKit(state, (kit) => moveLayer(kit, from, to))),

  setSampleWeight: (voiceIndex, id, weight) =>
    set((state) =>
      withActiveKit(state, (kit) => {
        const voice = findVoice(kit, voiceIndex)
        if (voice) setSlotWeight(voice, id, weight)
      }),
    ),

  duplicateSlot: (voiceIndex, slotId) =>
    set((state) =>
      withActiveKit(state, (kit) => {
        const voice = findVoice(kit, voiceIndex)
        if (voice) duplicateSlotAt(voice, slotId)
      }),
    ),

  toggleRandomMute: (_voiceIndex, id) =>
    set((state) =>
      withActiveKit(state, (kit) => {
        const sample = kit.samples[id]
        if (sample) kit.samples[id] = { ...sample, randomMuted: !sample.randomMuted }
      }),
    ),

  convertSample: async (voiceIndex, id) => {
    const state = get()
    const kit = state.kits.find((k) => k.id === state.activeKitId)
    const voice = kit ? findVoice(kit, voiceIndex) : undefined
    const sample = kit?.samples[id]
    if (!kit || !voice || !sample) return

    const target = targetForVoice(voice)
    set((s) => ({ converting: { ...s.converting, [id]: true } }))

    try {
      const source = await requireAudio(id)
      const result = await convertToTarget(source, target)
      await putAudio(id, result.bytes)
      // The cached decode is of the pre-conversion bytes; auditioning it now would
      // play the old file and quietly contradict the metadata.
      invalidateBuffer(id)
      // Having just thrown the decode away, put a fresh one back if the transport is
      // relying on it — otherwise converting mid-playback silences the channel.
      decodeIfPlaying(get(), [id])

      set((s) =>
        withActiveKit(s, (k) => {
          const existing = k.samples[id]
          if (!existing) return
          k.samples[id] = {
            ...existing,
            meta: result.meta,
            converted: true,
            status: 'ready',
            padded: result.padded,
            error: undefined,
          }
        }),
      )

      if (result.padded) {
        get().notify(
          'info',
          `${sample.name} was shorter than 50 ms and has been padded with silence — the Rample rejects anything shorter.`,
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Conversion failed'
      set((s) =>
        withActiveKit(s, (k) => {
          const existing = k.samples[id]
          if (existing) k.samples[id] = { ...existing, status: 'error', error: message }
        }),
      )
      get().notify('error', `Could not convert ${sample.name}: ${message}`)
    } finally {
      set((s) => {
        const { [id]: _removed, ...rest } = s.converting
        return { converting: rest }
      })
    }
  },

  convertVoice: async (voiceIndex) => {
    const state = get()
    const kit = state.kits.find((k) => k.id === state.activeKitId)
    const voice = kit ? findVoice(kit, voiceIndex) : undefined
    if (!kit || !voice) return

    const target = targetForVoice(voice)
    // Distinct samples, not slots: a sample holding four slots is still one file to
     // convert, and converting it four times would just redo the same work.
    const invalid = distinctSamples(voice).filter((id) => {
      const sample = kit.samples[id]
      return sample && !isSampleValid(sample.meta, target)
    })

    // Sequential rather than parallel: each conversion spins up an OfflineAudioContext
    // and decodes a full file, so twelve at once would spike memory and stall the UI.
    for (const id of invalid) {
      await get().convertSample(voiceIndex, id)
    }

    if (invalid.length > 0) {
      get().notify('success', `Converted ${invalid.length} sample${invalid.length === 1 ? '' : 's'} on SP${voiceIndex}.`)
    }
  },

  // ── Mixer ─────────────────────────────────────────────────────────────────────

  setVoiceVolume: (voiceIndex, volume) => {
    // Push to the audio graph immediately so the fader is heard while dragging, not on
    // mouse-up. The store copy exists so the level survives a save/restore.
    applyVoiceVolume(voiceIndex, volume)
    set((state) =>
      withActiveKit(state, (kit) => {
        const voice = findVoice(kit, voiceIndex)
        if (voice) voice.mixer = { volume }
      }),
    )
  },

  setMasterVolume: (volume) => {
    applyMasterVolume(volume)
    set({ master: { volume }, dirty: true })
  },

  setKeepAlive: (enabled) => {
    applyKeepAlive(enabled)
    set({ keepAlive: enabled, dirty: true })
  },

  setPreviewMode: (voiceIndex, mode) =>
    set((state) =>
      withActiveKit(state, (kit) => {
        const voice = findVoice(kit, voiceIndex)
        if (!voice || voice.previewMode === mode) return
        // Duplicate slots are a probability weighting in Random and a sequence in Cyclic.
        // Carrying either into another mode would silently reinterpret it as the other, so
        // changing mode drops them. The per-sample random mute is deliberately *not*
        // dropped: it is remembered and inert, not mode state.
        collapseDuplicateSlots(voice)
        voice.previewMode = mode
      }),
    ),

  setPreviewCursor: (voiceIndex, cursor) =>
    set((state) =>
      withActiveKit(state, (kit) => {
        const voice = findVoice(kit, voiceIndex)
        if (voice) voice.previewCursor = Math.max(0, cursor)
      }),
    ),

  // ── Sequencer ─────────────────────────────────────────────────────────────────

  setBpm: (bpm) =>
    set((state) => withActiveKit(state, (kit) => void (kit.bpm = clampBpm(bpm)))),

  // Set by the scheduler, which owns whether the clock is actually running.
  setPlaying: (playing) => set((state) => ({ transport: { ...state.transport, playing } })),

  updateSequence: (voiceIndex, patch) =>
    set((state) =>
      withSequences(state, (sequence, channel) => {
        if (channel !== voiceIndex) return sequence
        const next = { ...sequence, ...patch }
        if (patch.length !== undefined) next.length = clampLength(patch.length)
        // Triggers can never exceed the pattern they live in — clamped here rather than
        // at the input so shortening a pattern fixes up its trigger count too.
        next.triggers = Math.max(0, Math.min(next.triggers, next.length))
        next.rotation = next.length > 0 ? ((next.rotation % next.length) + next.length) % next.length : 0
        return next
      }),
    ),

  toggleStep: (voiceIndex, step) =>
    set((state) =>
      withSequences(state, (sequence, channel) => {
        if (channel !== voiceIndex) return sequence
        const steps = Array.from({ length: sequence.length }, (_, n) => sequence.steps[n] ?? false)
        steps[step] = !steps[step]
        return { ...sequence, steps }
      }),
    ),

  /**
   * Roll a channel's pattern to a density band.
   *
   * While the transport runs the new pattern is queued rather than applied, so it takes
   * effect at the channel's next loop boundary instead of jumping mid-bar.
   */
  randomiseChannel: (voiceIndex, mode) =>
    set((state) => {
      const deferred = state.transport.playing
      return withSequences(state, (sequence, channel) =>
        channel !== voiceIndex
          ? sequence
          : deferred
            ? { ...sequence, pendingRandomise: mode }
            : { ...sequence, ...randomiseSequence(sequence, mode) },
      )
    }),

  randomiseAll: () =>
    set((state) => {
      const deferred = state.transport.playing
      return withSequences(state, (sequence) =>
        deferred
          ? { ...sequence, pendingRandomise: sequence.densityMode }
          : { ...sequence, ...randomiseSequence(sequence, sequence.densityMode) },
      )
    }),

  applyPendingRandomise: (voiceIndex) =>
    set((state) =>
      withSequences(state, (sequence, channel) =>
        channel !== voiceIndex || !sequence.pendingRandomise
          ? sequence
          : {
              ...sequence,
              ...randomiseSequence(sequence, sequence.pendingRandomise),
              pendingRandomise: null,
            },
      ),
    ),

  /**
   * Recall a Tier-2 pattern onto one channel.
   *
   * Applied immediately rather than deferred to the loop boundary the way a queued
   * randomise is. Randomise is deferred because it fires repeatedly against a groove the
   * user is listening to; a recall is a deliberate one-shot, and making it wait would just
   * read as a broken button. A length change can leave the channel's step cursor past the
   * end of the new pattern, which `advanceClock` already absorbs by wrapping on the next
   * step, so this is safe while the transport runs.
   */
  loadPatternInto: (voiceIndex, sequence) =>
    set((state) =>
      withSequences(state, (current, channel) =>
        channel === voiceIndex ? cloneSequence(sequence) : current,
      ),
    ),

  /**
   * Recall a Tier-3 preset: overwrites all four channels, their names, and the tempo.
   *
   * The incoming sequences are in SP slot order, which is the order the preset was saved
   * and previewed in, so they are mapped back onto whichever channel currently holds each
   * slot rather than onto channel identities.
   *
   * Names are applied along with the patterns. For a factory preset they are the useful
   * part — "Kick / Clap / ClosedHat / OpenHat" is what tells you which sample belongs on
   * which channel — and a scene that renamed nothing would leave the labels describing the
   * previous groove.
   */
  loadPreset: (sequences, channelNames, bpm, presetId = null) =>
    set((state) =>
      withActiveKit(state, (kit) => {
        const order = channelsInSlotOrder(kit).map((v) => v.index)
        const next = [...kit.sequences]

        order.forEach((channel, slot) => {
          next[channel - 1] = sequences[slot] ? cloneSequence(sequences[slot]!) : emptySequence()
          const voice = findVoice(kit, channel)
          const name = channelNames[slot]
          if (voice && name) voice.name = normaliseChannelName(name, channel)
        })

        kit.sequences = next
        kit.bpm = clampBpm(bpm)
        kit.activePresetId = presetId
      }),
    ),

  nameSequence: (voiceIndex, name) =>
    set((state) =>
      withSequences(state, (sequence, channel) =>
        channel === voiceIndex ? { ...sequence, name } : sequence,
      ),
    ),

  setActivePreset: (id) =>
    set((state) => withActiveKit(state, (kit) => void (kit.activePresetId = id))),

  forgetPreset: (id) =>
    set((state) => {
      // Every kit, not just the active one: any of them could have been pointing at the
      // entry that was just deleted, and a dangling id would read as "Unsaved" anyway but
      // would come back to life if a new preset ever reused the id.
      if (!state.kits.some((kit) => kit.activePresetId === id)) return {}
      return {
        kits: state.kits.map((kit) =>
          kit.activePresetId === id ? { ...kit, activePresetId: null } : kit,
        ),
      }
    }),

  /**
   * "New preset" — clear all four channels to build a scene from scratch.
   *
   * Clears to genuinely empty rather than to `createSequence()`'s 4-in-16 default: the
   * point is a blank slate, and four channels arriving pre-loaded with a groove is not
   * one. Length and division stay at their defaults so the grids are the right size to
   * draw into.
   */
  clearSequences: () =>
    set((state) =>
      withActiveKit(state, (kit) => {
        kit.sequences = kit.sequences.map(() => emptySequence())
        // Cleared channels are no longer any stored scene.
        kit.activePresetId = null
      }),
    ),

  // ── Session ───────────────────────────────────────────────────────────────────

  save: () => {
    const state = get()
    try {
      saveSession({
        kits: state.kits,
        activeKitId: state.activeKitId,
        transport: state.transport,
        master: state.master,
        keepAlive: state.keepAlive,
      })
      void collectGarbage(referencedSampleIds(state.kits))
      set({ dirty: false, lastSavedAt: new Date().toISOString() })
      get().notify('success', 'Session saved.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      get().notify('error', `Could not save session: ${message}`)
    }
  },

  restore: () => {
    const restored = loadSession()
    if (!restored) return false
    applySessionToGraph(restored.session)
    set({
      ...restored.session,
      dirty: false,
      lastSavedAt: restored.savedAt,
    })
    return true
  },

  replaceSession: (session) => {
    // Whatever was playing belongs to the session being discarded.
    for (const voice of VOICE_INDICES) stopVoice(voice)
    const outgoing = referencedSampleIds(get().kits)
    const incoming = new Set(referencedSampleIds(session.kits))
    // Decoded buffers are keyed by sample id, so any id the new session does not reuse
    // would otherwise keep a stale decode of the old project's audio.
    forgetBuffers(outgoing.filter((id) => !incoming.has(id)))

    applySessionToGraph(session)
    // Marked dirty on purpose: an imported project has not been saved to *this* browser
    // yet, and the Save button is what puts it there.
    set({ ...session, dirty: true, lastSavedAt: null, notices: get().notices, converting: {} })
  },

  resetSession: () => {
    for (const voice of VOICE_INDICES) stopVoice(voice)
    const state = get()
    forgetBuffers(referencedSampleIds(state.kits))
    void deleteAudio(referencedSampleIds(state.kits))
    clearSession()
    set({ ...freshSession(), dirty: false, lastSavedAt: null, notices: [], converting: {} })
  },
}))

// ── Selectors ───────────────────────────────────────────────────────────────────

export function useActiveKit(): Kit {
  return useSession(activeKitOf)
}

/** One channel's live pattern, by channel identity. */
export function useChannelSequence(channel: VoiceIndex): ChannelSequence {
  return useSession((s) => activeKitOf(s).sequences[channel - 1]!)
}

/** The active kit's four patterns, in channel-identity order. */
export function useActiveSequences(): ChannelSequence[] {
  return useSession((s) => activeKitOf(s).sequences)
}

/** The active kit's tempo. */
export function useActiveBpm(): number {
  return useSession((s) => activeKitOf(s).bpm)
}

/** The preset the active kit's channels came from, or null. */
export function useActivePresetId(): string | null {
  return useSession((s) => activeKitOf(s).activePresetId)
}

/** Read the active kit outside React — for the scheduler and other non-component callers. */
export function getActiveKit(): Kit {
  return activeKitOf(useSession.getState())
}
