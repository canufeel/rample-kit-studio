import { create } from 'zustand'
import type { VoiceIndex } from '~/domain/device'
import { createPattern, createPreset, normaliseName } from '~/domain/library'
import type { ChannelSequence, SavedPattern, SavedPreset } from '~/domain/types'
import { newId } from '~/lib/id'
import { loadPatterns, loadPresets, savePatterns, savePresets } from '~/storage/libraryStore'
import { useSession } from './useSession'

/**
 * The library lives in its own store, separate from the session.
 *
 * Two reasons. It is global — one library across every kit and every session — so folding
 * it into the session would make "save the session" and "save a pattern" the same act,
 * which they are not. And library writes must not mark the session dirty: saving a pattern
 * changes nothing about the kit you would export.
 *
 * Unlike the session, which saves on an explicit press, the library writes through on
 * every mutation. A library is a filing cabinet — an unsaved filing cabinet is a bug, not
 * a feature, and the payload is small enough that write-through costs nothing.
 */

interface LibraryState {
  patterns: SavedPattern[]
  presets: SavedPreset[]
  /**
   * The channel whose save button was just pressed, so the panel can open with its name
   * field focused. Lets the Sequencer's per-channel button and the panel's own buttons
   * share one naming flow.
   */
  pendingVoice: VoiceIndex | null
  /** True once localStorage has been read, so the panel can tell empty from not-yet-loaded. */
  loaded: boolean

  hydrate: () => void
  beginPatternSave: (voice: VoiceIndex) => void
  cancelPatternSave: () => void

  savePattern: (name: string, voice: VoiceIndex, channelName: string, sequence: ChannelSequence) => void
  savePreset: (
    name: string,
    sequences: readonly ChannelSequence[],
    channelNames: readonly string[],
    bpm: number,
  ) => void

  /** Swap in a whole library — used by the project-file import. */
  replaceLibrary: (patterns: readonly SavedPattern[], presets: readonly SavedPreset[]) => void

  renamePattern: (id: string, name: string) => void
  renamePreset: (id: string, name: string) => void
  deletePattern: (id: string) => void
  deletePreset: (id: string) => void
}

function notify(kind: 'success' | 'error', message: string): void {
  useSession.getState().notify(kind, message)
}

/**
 * Write through to localStorage, reporting a failed write rather than swallowing it.
 *
 * The in-memory list is only updated once the write succeeds. Showing an entry that isn't
 * actually stored would be worse than refusing it: the user would find it missing on their
 * next visit with no indication anything went wrong.
 */
function persist<T>(
  entries: T[],
  write: (entries: readonly T[]) => void,
  what: string,
): T[] | null {
  try {
    write(entries)
    return entries
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    notify('error', `Could not save ${what}: ${message}`)
    return null
  }
}

export const useLibrary = create<LibraryState>((set, get) => ({
  patterns: [],
  presets: [],
  pendingVoice: null,
  loaded: false,

  hydrate: () => set({ patterns: loadPatterns(), presets: loadPresets(), loaded: true }),

  beginPatternSave: (voice) => set({ pendingVoice: voice }),
  cancelPatternSave: () => set({ pendingVoice: null }),

  savePattern: (name, voice, channelName, sequence) => {
    const entry = createPattern(name, sequence, channelName, newId())
    // Newest first: a library is used most heavily right after something is added to it.
    const next = persist([entry, ...get().patterns], savePatterns, 'pattern')
    if (!next) return
    set({ patterns: next, pendingVoice: null })
    // The channel now remembers the name it was saved under, so the next save from this
    // channel suggests it instead of "Unnamed".
    useSession.getState().nameSequence(voice, entry.name)
    notify('success', `Saved pattern “${entry.name}”.`)
  },

  savePreset: (name, sequences, channelNames, bpm) => {
    const entry = createPreset(name, sequences, channelNames, bpm, get().presets, newId())
    const next = persist([entry, ...get().presets], savePresets, 'preset')
    if (!next) return
    set({ presets: next })
    // Saving is also loading, in the sense that this kit's scene now *is* this preset.
    // Which preset a scene belongs to lives on the kit, since the scene does.
    useSession.getState().setActivePreset(entry.id)
    notify('success', `Saved preset “${entry.name}”.`)
  },

  /**
   * Merged rather than overwritten: the library is global, so importing a project should
   * not silently destroy patterns the user built up in this browser. Entries whose ids
   * collide are taken from the import, since that is the explicit action.
   */
  replaceLibrary: (patterns, presets) => {
    const merge = <T extends { id: string }>(incoming: readonly T[], existing: readonly T[]): T[] => {
      const ids = new Set(incoming.map((entry) => entry.id))
      return [...incoming, ...existing.filter((entry) => !ids.has(entry.id))]
    }

    const nextPatterns = persist(merge(patterns, get().patterns), savePatterns, 'patterns')
    const nextPresets = persist(merge(presets, get().presets), savePresets, 'presets')
    set({
      ...(nextPatterns ? { patterns: nextPatterns } : {}),
      ...(nextPresets ? { presets: nextPresets } : {}),
    })
  },

  renamePattern: (id, name) => {
    const clean = normaliseName(name)
    if (!clean) return
    const next = persist(
      get().patterns.map((p) => (p.id === id ? { ...p, name: clean } : p)),
      savePatterns,
      'pattern',
    )
    if (next) set({ patterns: next })
  },

  renamePreset: (id, name) => {
    const clean = normaliseName(name)
    if (!clean) return
    const next = persist(
      get().presets.map((p) => (p.id === id ? { ...p, name: clean } : p)),
      savePresets,
      'preset',
    )
    if (next) set({ presets: next })
  },

  deletePattern: (id) => {
    const next = persist(
      get().patterns.filter((p) => p.id !== id),
      savePatterns,
      'pattern',
    )
    if (next) set({ patterns: next })
  },

  deletePreset: (id) => {
    const next = persist(
      get().presets.filter((p) => p.id !== id),
      savePresets,
      'preset',
    )
    if (!next) return
    set({ presets: next })
    // Deleting a loaded preset leaves the channels alone, but the scene is no longer stored
    // anywhere — so any kit pointing at it reverts to "Unsaved" rather than naming a
    // missing entry. Every kit is checked, since each one tracks its own scene.
    useSession.getState().forgetPreset(id)
  },
}))
