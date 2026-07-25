import type { BitDepth, VoiceIndex } from './device'

export type SampleId = string
export type KitId = string
export type SlotId = string

/**
 * One layer position on a voice.
 *
 * Several slots may point at the same sample, and that single fact is what expresses both
 * of the features that need it: in Random mode a sample's share of the slots *is* its
 * probability, and in Cyclic mode repeating a sample in the list *is* the sequence. It is
 * also exactly how you would make the hardware do either — by writing the same file to the
 * card more than once — so preview and export agree by construction rather than by
 * translation.
 *
 * The id exists because the sample id is no longer unique within a voice: React keys and
 * drag-and-drop both need to tell two slots holding the same sample apart.
 */
export interface Slot {
  id: SlotId
  sampleId: SampleId
}

/** What kind of audio data a file actually holds, as read from its header. */
export type Container = 'wav' | 'mp3' | 'flac' | 'ogg' | 'm4a' | 'aiff' | 'unknown'

/**
 * The encoding inside the container. Matters because a 32-bit float WAV and a 24-bit
 * WAV both decode perfectly in the browser but neither plays on the device — only
 * integer PCM does. Compressed containers have no PCM codec at all.
 */
export type Codec = 'pcm' | 'ieee-float' | 'alaw' | 'mulaw' | 'adpcm' | 'compressed' | 'unknown'

export interface AudioMeta {
  container: Container
  codec: Codec
  /**
   * null when the container isn't WAV. We deliberately don't ship an mp3/flac/ogg
   * header parser just to fill this in — those files are invalid by container anyway
   * and must be converted, so the readout shows the format badge instead.
   */
  sampleRate: number | null
  /** null for compressed formats — an mp3 has no PCM bit depth. */
  bitDepth: number | null
  channels: number
  durationSec: number
  sizeBytes: number
}

export type SampleStatus = 'ready' | 'converting' | 'error'

export interface Sample {
  id: SampleId
  /** Original filename including extension, as dropped. */
  name: string
  meta: AudioMeta
  /** True once this sample has been through our conversion pipeline. */
  converted: boolean
  status: SampleStatus
  error?: string
  /** Set when conversion padded a sub-50ms sample, so the UI can say so. */
  padded?: boolean
  /**
   * Excluded from Random-mode layer selection.
   *
   * Preview-only: the sample keeps its layer slot and is still written to the card, since
   * the device has no notion of a muted layer. Kept on the sample rather than derived from
   * the mode, so the flag survives a trip through Cyclic and comes back — it is inert
   * outside Random rather than forgotten.
   */
  randomMuted?: boolean
}

export type VoiceMode = 'mono' | 'stereo'
export type ConvertMode = 'manual' | 'auto'
export type PreviewMode = 'random' | 'cyclic' | 'manual'

/**
 * One channel: the thing the user fills with samples, names, and drags around.
 *
 * Three separate ideas that used to be one, and are worth keeping apart:
 *
 * - `index` is **identity**. Assigned once at creation, never reassigned. It keys the
 *   channel's sequence, its audio strip and its mixer gain, which is why dragging a
 *   channel carries its pattern and level with it for free.
 * - **Position** in `Kit.voiceOrder` is the **SP slot**, and that is what the device sees:
 *   whatever channel sits in slot 0 exports as the Rample's voice 1. The SP labels in the
 *   UI belong to the slots and never move.
 * - `name` is what the user calls it. Purely cosmetic; never reaches the card.
 */
export interface Voice {
  index: VoiceIndex
  /** User-facing channel name. Defaults to CH1–CH4 and is renamable. Never exported. */
  name: string
  mode: VoiceMode
  targetBitDepth: BitDepth
  convertMode: ConvertMode
  /**
   * Every layer slot on this voice as one ordered list. Positions 0..11 are the *active*
   * layers the device will see, in device layer order; anything past that is *queued*.
   *
   * Two arrays — one active, one queued — is the obvious alternative and the wrong one.
   * Every rule about them is really a statement about a single ordering: "beyond 12
   * active, extras are queued" is a slice, "when an active slot frees, the first queued
   * entry promotes" is a shift, and dragging across the boundary is an ordinary reorder.
   * Two arrays admit states that cannot be legal (thirteen active layers) and need a
   * rebalance pass after every mutation to rule them out; one array makes them
   * unrepresentable. Use activeSlots()/queuedSlots().
   *
   * Duplicate `sampleId`s are legal and meaningful — see `Slot`. That also means the
   * twelve-layer budget is spent in *slots*, so a voice holding three samples at four
   * slots each is as full as one holding twelve samples.
   */
  layers: Slot[]
  previewMode: PreviewMode
  previewCursor: number
  /** Preview-only. Never exported. */
  mixer: { volume: number }
  /**
   * Mixer mute and solo. Preview-only, never exported — the device has no notion of
   * either. Any channel soloed silences every channel that is not, which is why these two
   * cannot be read independently; see `isChannelAudible`.
   */
  muted: boolean
  soloed: boolean
}

export interface Kit {
  id: KitId
  /** "A0" — this IS the export folder name and the tab label. */
  code: string
  voices: Voice[]
  /**
   * Which channel occupies which SP slot, and therefore the export order: position 0 is
   * SP1, which becomes the Rample's voice 1. Reordering this *is* reassigning the
   * hardware voices — it is not cosmetic. Channel identity (`Voice.index`) is untouched.
   */
  voiceOrder: VoiceIndex[]
  /** Normalised sample store for this kit. Audio bytes live in IndexedDB. */
  samples: Record<SampleId, Sample>

  /**
   * This kit's four channel patterns, indexed by channel *identity* (index 0 is the channel
   * whose `Voice.index` is 1), not by SP slot. Indexing by identity is what makes dragging
   * a channel carry its pattern along without moving anything.
   *
   * Per kit rather than per session: a pattern is written for the samples it triggers, so a
   * groove built for one kit means nothing over another kit's samples. Moving a groove
   * between kits is what the preset library is for.
   */
  sequences: ChannelSequence[]

  /** Tempo belongs to the kit, since the groove it drives does. */
  bpm: number

  /**
   * The preset this kit's channels came from, or null if they have never been in the
   * library. Per kit for the same reason as the sequences — each kit is its own scene.
   */
  activePresetId: string | null
}

// ── Sequencer (preview-only, never exported) ────────────────────────────────────

export type SequenceKind = 'euclidean' | 'user'
export type DensityMode = 'mezzanine' | 'bar' | 'disco'

export type DivisionId =
  | '1/1'
  | '1/2'
  | '1/4'
  | '1/8'
  | '1/16'
  | '1/32'
  | '1/64'
  | '1/4.'
  | '1/8.'
  | '1/16.'
  | '1/4T'
  | '1/8T'
  | '1/16T'

/**
 * One channel's live pattern. Both the Euclidean parameters and the user step map are
 * kept regardless of which mode is active, so toggling between them doesn't discard the
 * other's settings.
 */
export interface ChannelSequence {
  /**
   * The library entry this pattern came from or was last saved as, or null if it has
   * never been named. Only used to prefill the name field on the next save — it is a
   * provenance hint, not a claim that the pattern still matches that entry.
   */
  name: string | null
  kind: SequenceKind
  length: number
  division: DivisionId
  /** Euclidean: number of hits. */
  triggers: number
  /** Euclidean: offset, so hits can land off the downbeat. */
  rotation: number
  /** User mode: the hand-drawn step map. */
  steps: boolean[]
  /** Last density band used, so Randomise can be re-rolled in the same character. */
  densityMode: DensityMode
  /**
   * A randomise requested while the transport is running, applied at this channel's
   * next loop boundary so the pattern doesn't jump mid-bar.
   */
  pendingRandomise: DensityMode | null
}

/**
 * There is one clock and one audio output, so whether it is running is session state.
 * Tempo is not — that lives on the kit.
 */
export interface Transport {
  playing: boolean
}

// ── Library ────────────────────────────────────────────────────────────────

/**
 * Tier 2: a named, frozen copy of one channel's pattern.
 *
 * Global — deliberately not tied to a kit or to the voice it came from, so the same
 * groove can be recalled onto any channel. `sourceVoice` is provenance for the UI, not
 * a constraint on recall.
 */
export interface SavedPattern {
  id: string
  name: string
  savedAt: string
  /** Name of the channel it was captured from, kept as provenance. Does not limit recall. */
  sourceChannel: string
  sequence: ChannelSequence
}

/**
 * Tier 3: a named, frozen copy of the whole sequencer — all four channels plus tempo.
 *
 * `channels` is always four entries, index 0..3 mapping to SP1..SP4. A channel that was
 * silent when saved is stored as a silent sequence rather than omitted, so loading it
 * overwrites the live channel with silence instead of leaving whatever was there.
 */
export interface SavedPreset {
  id: string
  name: string
  savedAt: string
  /**
   * A one-line description. Only the Factory bank ships these; a user preset has its name
   * and its preview, and inventing a description for it would be noise.
   */
  note?: string
  bpm: number
  channels: ChannelSequence[]
  /**
   * What the channels were called when the scene was saved, in the same slot order.
   *
   * Shown in the preview so a saved scene reads as more than four anonymous rows. Not
   * applied on load: a preset is a groove, and silently renaming the channels of the kit
   * you loaded it into would destroy naming that belongs to that kit.
   */
  channelNames: string[]
}

export interface Session {
  kits: Kit[]
  activeKitId: KitId
  transport: Transport
  master: { volume: number }
  /** Keep an inaudible signal running so Bluetooth links never idle. See audio/engine.ts. */
  keepAlive: boolean
}

/** The format a voice requires of its samples. Derived from voice settings. */
export interface ConversionTarget {
  sampleRate: number
  bitDepth: BitDepth
  channels: 1 | 2
}
