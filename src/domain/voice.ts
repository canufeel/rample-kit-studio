import { DEFAULT_BIT_DEPTH, MAX_LAYERS_PER_VOICE, VOICE_INDICES } from './device'
import { DEFAULT_BPM, createSequence } from './sequence'
import type { VoiceIndex } from './device'
import type { Kit, Sample, SampleId, Slot, SlotId, Voice } from './types'
import { newId } from '~/lib/id'

/** The slots the device will actually load: the first 12. */
export function activeSlots(voice: Voice): Slot[] {
  return voice.layers.slice(0, MAX_LAYERS_PER_VOICE)
}

/** Overflow beyond the device's 12-slot cap, in promotion order. */
export function queuedSlots(voice: Voice): Slot[] {
  return voice.layers.slice(MAX_LAYERS_PER_VOICE)
}

/**
 * The samples the device will load, in layer order, one entry per slot.
 *
 * Repeats where a sample occupies several slots — which is the point, since that repetition
 * is what both the cyclic sequence and the random odds are made of.
 */
export function activeLayers(voice: Voice): SampleId[] {
  return activeSlots(voice).map((slot) => slot.sampleId)
}

export function queuedLayers(voice: Voice): SampleId[] {
  return queuedSlots(voice).map((slot) => slot.sampleId)
}

export function makeSlot(sampleId: SampleId): Slot {
  return { id: newId(), sampleId }
}

/**
 * Distinct samples on this voice, in first-appearance order — the unit the UI lists, as
 * opposed to slots, which are the unit the device loads.
 */
export function distinctSamples(voice: Voice): SampleId[] {
  const seen = new Set<SampleId>()
  const order: SampleId[] = []
  for (const slot of voice.layers) {
    if (seen.has(slot.sampleId)) continue
    seen.add(slot.sampleId)
    order.push(slot.sampleId)
  }
  return order
}

/** How many *active* slots this sample holds. Its weight in the random draw. */
export function slotWeight(voice: Voice, sampleId: SampleId): number {
  return activeSlots(voice).filter((slot) => slot.sampleId === sampleId).length
}

export function isQueuedPosition(position: number): boolean {
  return position >= MAX_LAYERS_PER_VOICE
}

/** What an unnamed channel is called. Tied to identity, so it survives being dragged. */
export function defaultChannelName(index: VoiceIndex): string {
  return `CH${index}`
}

export const MAX_CHANNEL_NAME_LENGTH = 16

/** Collapse whitespace and cap length; empty input falls back to the CH default. */
export function normaliseChannelName(raw: string, index: VoiceIndex): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_CHANNEL_NAME_LENGTH) || defaultChannelName(index)
}

export function createVoice(index: VoiceIndex): Voice {
  return {
    index,
    name: defaultChannelName(index),
    mode: 'mono',
    targetBitDepth: DEFAULT_BIT_DEPTH,
    convertMode: 'auto',
    layers: [],
    previewMode: 'random',
    previewCursor: 0,
    mixer: { volume: 0.8 },
    muted: false,
    soloed: false,
  }
}

/**
 * Whether this channel's sequencer triggers should sound.
 *
 * Solo wins over mute, and any solo anywhere silences everything not soloed — so a
 * channel's audibility is never a property of that channel alone. A soloed *and* muted
 * channel sounds: pressing solo is the more specific, more recent intent, and a solo that
 * produced silence would look broken.
 *
 * Governs the sequencer only. Row audition and "Play next" deliberately ignore this, so a
 * muted channel can still be inspected.
 */
export function isChannelAudible(kit: Kit, index: VoiceIndex): boolean {
  const soloing = kit.voices.some((v) => v.soloed)
  const voice = findVoice(kit, index)
  if (!voice) return false
  return soloing ? voice.soloed : !voice.muted
}

/** True when any channel is soloed, so the UI can dim the ones being silenced by it. */
export function isSoloing(kit: Kit): boolean {
  return kit.voices.some((v) => v.soloed)
}

export function createKit(code: string): Kit {
  return {
    id: newId(),
    code,
    voices: VOICE_INDICES.map(createVoice),
    voiceOrder: [...VOICE_INDICES],
    samples: {},
    // A new kit starts on the app's default groove and tempo, belonging to no preset.
    sequences: VOICE_INDICES.map(() => createSequence()),
    bpm: DEFAULT_BPM,
    activePresetId: null,
  }
}

export function findVoice(kit: Kit, index: VoiceIndex): Voice | undefined {
  return kit.voices.find((v) => v.index === index)
}

/**
 * The channels in SP slot order: position 0 is SP1 and exports as the device's voice 1.
 *
 * Every channel appears exactly once regardless of what `voiceOrder` says. A duplicate
 * entry would otherwise export the same channel into two device voices, and a missing one
 * would drop a channel from the card entirely — so duplicates are ignored and anything the
 * stored order forgot is appended in identity order.
 */
export function channelsInSlotOrder(kit: Kit): Voice[] {
  const byIndex = new Map(kit.voices.map((v) => [v.index, v]))
  const ordered: Voice[] = []
  const seen = new Set<VoiceIndex>()

  for (const index of kit.voiceOrder) {
    const voice = byIndex.get(index)
    if (!voice || seen.has(index)) continue
    ordered.push(voice)
    seen.add(index)
  }

  return [...ordered, ...kit.voices.filter((v) => !seen.has(v.index))]
}

/** The device voice number (1-4) this channel currently occupies. */
export function slotOf(kit: Kit, index: VoiceIndex): VoiceIndex {
  const position = channelsInSlotOrder(kit).findIndex((v) => v.index === index)
  return ((position === -1 ? 0 : position) + 1) as VoiceIndex
}

/** The channel sitting in a given SP slot, 1-based. */
export function channelInSlot(kit: Kit, slot: VoiceIndex): Voice | undefined {
  return channelsInSlotOrder(kit)[slot - 1]
}

export function voiceSamples(kit: Kit, voice: Voice): Sample[] {
  return distinctSamples(voice)
    .map((id) => kit.samples[id])
    .filter((s): s is Sample => Boolean(s))
}

/** Every sample id referenced anywhere in the session — the live set for GC. */
export function referencedSampleIds(kits: readonly Kit[]): SampleId[] {
  return kits.flatMap((kit) => kit.voices.flatMap((voice) => voice.layers.map((s) => s.sampleId)))
}

/**
 * Move a layer within a voice or between voices.
 *
 * Because active and queued are one list, this single operation covers every drag the UI
 * offers: reorder within active, reorder within the queue, drag across the
 * boundary in either direction, and drag to a different voice.
 */
export function moveLayer(
  kit: Kit,
  from: { voice: VoiceIndex; index: number },
  to: { voice: VoiceIndex; index: number },
): void {
  const source = findVoice(kit, from.voice)
  const target = findVoice(kit, to.voice)
  if (!source || !target) return

  const [moved] = source.layers.splice(from.index, 1)
  if (moved === undefined) return

  const clamped = Math.max(0, Math.min(to.index, target.layers.length))
  target.layers.splice(clamped, 0, moved)
}

// ── Duplicate slots: probability (Random mode) and sequencing (Cyclic mode) ──────

/** Free active slots, i.e. how much a sample's weight could still be raised. */
export function freeSlotCount(voice: Voice): number {
  return Math.max(0, MAX_LAYERS_PER_VOICE - activeSlots(voice).length)
}

/**
 * The weights a sample could be set to right now: at least one, at most its current weight
 * plus whatever is free. Offered as a list because the UI is a stepper over exactly these
 * values, and "what can I pick" should not be re-derived in three places.
 */
export function availableWeights(voice: Voice, sampleId: SampleId): number[] {
  const current = slotWeight(voice, sampleId)
  if (current === 0) return []
  const max = current + freeSlotCount(voice)
  return Array.from({ length: max }, (_, i) => i + 1)
}

/**
 * The chance this sample is picked by a random trigger, as a fraction.
 *
 * Weighted by slots, and computed over the *unmuted* samples only — a muted sample keeps
 * its slots but is not in the draw, so its share belongs to the others. Returns 0 for a
 * muted sample, which is exactly its chance of playing.
 */
export function selectionProbability(kit: Kit, voice: Voice, sampleId: SampleId): number {
  const eligible = activeSlots(voice).filter((slot) => !kit.samples[slot.sampleId]?.randomMuted)
  if (eligible.length === 0) return 0
  if (kit.samples[sampleId]?.randomMuted) return 0
  return eligible.filter((slot) => slot.sampleId === sampleId).length / eligible.length
}

/**
 * Set how many slots a sample occupies.
 *
 * Added slots go directly after that sample's last existing slot rather than at the end, so
 * a duplicated sample stays together in the list instead of scattering — which matters most
 * in Cyclic mode, where position is the sequence.
 *
 * Clamped to one slot minimum (removing the last one is deletion, not a weight of zero) and
 * to whatever is free. Nothing else is rebalanced: the other samples' weights are the
 * user's own settings, and quietly moving them to hold a percentage steady would be a
 * worse surprise than the percentages shifting.
 */
export function setSlotWeight(voice: Voice, sampleId: SampleId, weight: number): void {
  const current = slotWeight(voice, sampleId)
  if (current === 0) return

  const target = Math.max(1, Math.min(Math.round(weight), current + freeSlotCount(voice)))
  let delta = target - current
  if (delta === 0) return

  if (delta > 0) {
    const lastAt = voice.layers.reduce((at, slot, i) => (slot.sampleId === sampleId ? i : at), -1)
    voice.layers.splice(lastAt + 1, 0, ...Array.from({ length: delta }, () => makeSlot(sampleId)))
    return
  }

  // Trim from the end, so the sample's first slot — the one the user actually added — is
  // the last to go.
  for (let i = voice.layers.length - 1; i >= 0 && delta < 0; i--) {
    if (voice.layers[i]!.sampleId !== sampleId) continue
    voice.layers.splice(i, 1)
    delta++
  }
}

/** Duplicate one slot in place. The Cyclic-mode way of spending a free slot. */
export function duplicateSlotAt(voice: Voice, slotId: SlotId): void {
  if (freeSlotCount(voice) === 0) return
  const at = voice.layers.findIndex((slot) => slot.id === slotId)
  if (at === -1) return
  voice.layers.splice(at + 1, 0, makeSlot(voice.layers[at]!.sampleId))
}

/**
 * Reduce every sample to a single slot, keeping first-appearance order.
 *
 * Run when a voice leaves Random or Cyclic, because duplicate slots mean something specific
 * in each of those modes and nothing at all outside them. Leaving them in place would
 * silently carry a probability weighting into a cyclic sequence, or vice versa.
 */
export function collapseDuplicateSlots(voice: Voice): void {
  const seen = new Set<SampleId>()
  voice.layers = voice.layers.filter((slot) => {
    if (seen.has(slot.sampleId)) return false
    seen.add(slot.sampleId)
    return true
  })
}

/** How many grouping colours exist. See `--color-group-*`. */
export const SLOT_GROUP_COUNT = 4

/**
 * A grouping index for every sample that occupies more than one slot, so the rows holding
 * one sample can be tied together visually.
 *
 * Only duplicated samples are assigned one: a marker on a row that is the sole copy of its
 * sample would say nothing. Numbered in first-appearance order so the assignment is stable
 * as long as the list is, and cycles past the available colours — with twelve slots and two
 * needed before a sample groups at all, that is a corner nobody reaches.
 */
export function slotGroups(voice: Voice): Map<SampleId, number> {
  const groups = new Map<SampleId, number>()
  let next = 0
  for (const sampleId of distinctSamples(voice)) {
    if (slotWeight(voice, sampleId) < 2) continue
    groups.set(sampleId, (next % SLOT_GROUP_COUNT) + 1)
    next++
  }
  return groups
}

/** Which copy of its sample this slot is, and how many there are — "copy 2 of 3". */
export function slotCopyPosition(voice: Voice, slotId: SlotId): { copy: number; of: number } {
  const slot = voice.layers.find((entry) => entry.id === slotId)
  if (!slot) return { copy: 1, of: 1 }
  const siblings = voice.layers.filter((entry) => entry.sampleId === slot.sampleId)
  return { copy: siblings.findIndex((entry) => entry.id === slotId) + 1, of: siblings.length }
}
