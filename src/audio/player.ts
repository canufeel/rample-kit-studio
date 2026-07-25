import type { VoiceIndex } from '~/domain/device'
import { VOICE_INDICES } from '~/domain/device'
import { selectLayer } from '~/domain/layerSelect'
import type { SampleId } from '~/domain/types'
import { activeLayers, findVoice, isChannelAudible } from '~/domain/voice'
import { useSession } from '~/store/useSession'
import { getBufferSync, loadBuffer } from './buffers'
import { resumeAudio } from './context'
import { onVoiceEnded, stopVoice, triggerVoice } from './engine'

/**
 * Policy layer: decides *what* a voice plays, then hands it to the engine.
 *
 * Sits between the dumb audio graph and the store so neither depends on the other —
 * the store never imports audio code, and the engine never learns what a kit is.
 */

/**
 * Round-robin position per voice, held here rather than in the store.
 *
 * A cyclic channel advances on every sequencer step — up to sixteen times a second per
 * voice. Writing that into React state would re-render the voice panel at audio rate for
 * no visual gain, so the store keeps only the *manual* selection (`Voice.previewCursor`,
 * which the user sets by clicking a row) and the transient playback cursor lives here.
 * The UI still sees what is sounding, via the activity subscription below.
 */
const cyclicCursors = new Map<VoiceIndex, number>()

export function resetCursors(): void {
  cyclicCursors.clear()
}

// ── Activity, for UI highlighting ───────────────────────────────────────────────

type Activity = Partial<Record<VoiceIndex, SampleId | null>>

let activity: Activity = {}
const listeners = new Set<(state: Activity) => void>()

function emit(): void {
  activity = { ...activity }
  for (const listener of listeners) listener(activity)
}

export function onVoiceActivity(listener: (state: Activity) => void): () => void {
  listeners.add(listener)
  listener(activity)
  return () => listeners.delete(listener)
}

export function getActivity(): Activity {
  return activity
}

onVoiceEnded((voice) => {
  activity[voice] = null
  emit()
})

// ── Triggering ──────────────────────────────────────────────────────────────────

interface VoiceContext {
  ids: SampleId[]
  cursor: number
  mode: 'random' | 'cyclic' | 'manual'
  /** Whether the *sequencer* should sound this channel. Audition ignores it. */
  audible: boolean
}

function layersFor(voice: VoiceIndex): VoiceContext | null {
  const state = useSession.getState()
  const kit = state.kits.find((k) => k.id === state.activeKitId)
  const target = kit ? findVoice(kit, voice) : undefined
  if (!kit || !target) return null
  const layers = activeLayers(target)

  return {
    // Random draws from the unmuted layers only, which is what shifts the odds onto the
    // rest. Cyclic and manual keep the full list: their cursors are positions in it, so
    // filtering would silently renumber the sequence the user arranged.
    ids: target.previewMode === 'random' ? layers.filter((id) => !kit.samples[id]?.randomMuted) : layers,
    cursor: target.previewMode === 'cyclic' ? (cyclicCursors.get(voice) ?? 0) : target.previewCursor,
    mode: target.previewMode,
    audible: isChannelAudible(kit, voice),
  }
}

/**
 * Fire a voice at a precise time, synchronously.
 *
 * Must not await anything: the scheduler calls this inside its lookahead window, where a
 * round trip to IndexedDB would blow the deadline and make the hit land late. Buffers are
 * preloaded before the transport starts, so a miss here means a sample genuinely could
 * not be decoded — skip it rather than dropping the beat.
 */
export function triggerScheduled(voice: VoiceIndex, when: number): SampleId | null {
  const context = layersFor(voice)
  if (!context) return null

  // Selection runs first and unconditionally, even for a silenced channel. Skipping it
  // would freeze the cyclic cursor, so unmuting mid-pattern would resume from wherever the
  // channel was when it went quiet instead of staying in step with the others.
  const choice = selectLayer(context.ids, context.mode, context.cursor)
  if (!choice) return null

  if (context.mode === 'cyclic') cyclicCursors.set(voice, choice.nextCursor)

  // Mute and solo are applied here rather than on the voice's gain, because the answer to
  // "should a muted channel still audition?" is yes — and a gain-based mute could not tell
  // the two apart. Activity is not emitted either: a highlighted row that makes no sound
  // reads as a fault.
  if (!context.audible) return null

  const buffer = getBufferSync(choice.id)
  if (!buffer) return null

  triggerVoice(voice, buffer, when)
  activity[voice] = choice.id
  emit()
  return choice.id
}

/** Fire a voice now, loading the buffer if needed. Used by "Play next" and row audition. */
export async function triggerNow(voice: VoiceIndex, sampleId?: SampleId): Promise<void> {
  await resumeAudio()

  let id = sampleId
  if (!id) {
    const context = layersFor(voice)
    if (!context) return
    const choice = selectLayer(context.ids, context.mode, context.cursor)
    if (!choice) return
    if (context.mode === 'cyclic') cyclicCursors.set(voice, choice.nextCursor)
    id = choice.id
  }

  const buffer = await loadBuffer(id)
  triggerVoice(voice, buffer)
  activity[voice] = id
  emit()
}

/**
 * Play a specific row, toggling off if it is already the sound on that voice.
 *
 * Routed through the voice bus like everything else, so it inherits the voice fader and
 * the voice-stealing — auditioning a row cuts whatever that voice was playing, exactly
 * as re-triggering it on the hardware would.
 */
export async function auditionSample(voice: VoiceIndex, sampleId: SampleId): Promise<void> {
  if (activity[voice] === sampleId) {
    stopVoice(voice)
    activity[voice] = null
    emit()
    return
  }
  await triggerNow(voice, sampleId)
}

export function stopAll(): void {
  for (const voice of VOICE_INDICES) {
    stopVoice(voice)
    activity[voice] = null
  }
  emit()
}
