import {
  DEVICE_BIT_DEPTHS,
  DEVICE_CONTAINER,
  DEVICE_SAMPLE_RATE,
  MAX_LAYERS_PER_VOICE,
  MIN_SAMPLE_SEC,
  VOICE_COUNT,
} from './device'
import type { AudioMeta, ConversionTarget, Kit, Sample, Voice } from './types'
import { activeLayers, channelsInSlotOrder, queuedLayers } from './voice'

/**
 * One reason a sample won't play on the device. Each code names the metadata field
 * the UI should render in red, so the readout and the validity check can't drift apart.
 */
export type IssueCode = 'container' | 'codec' | 'sampleRate' | 'bitDepth' | 'channels' | 'tooShort'

/** Which column of the metadata readout an issue highlights. */
export type MetaField = 'sampleRate' | 'bitDepth' | 'size' | 'length' | 'channels'

/**
 * Container and codec problems both land on the bit-depth column, because that column
 * is where a non-PCM file's format badge is shown ("MP3" instead of "16-bit") — so the
 * cell that turns red is the cell naming the actual problem.
 */
export const ISSUE_FIELD: Record<IssueCode, MetaField> = {
  container: 'bitDepth',
  codec: 'bitDepth',
  sampleRate: 'sampleRate',
  bitDepth: 'bitDepth',
  channels: 'channels',
  tooShort: 'length',
}

export function targetForVoice(voice: Voice): ConversionTarget {
  return {
    sampleRate: DEVICE_SAMPLE_RATE,
    bitDepth: voice.targetBitDepth,
    channels: voice.mode === 'stereo' ? 2 : 1,
  }
}

/** Human-readable target, for the "New files convert to …" caption. */
export function describeTarget(target: ConversionTarget): string {
  const rate = `${(target.sampleRate / 1000).toFixed(1)}kHz`
  const channels = target.channels === 2 ? 'stereo' : 'mono'
  return `${rate}/${target.bitDepth}-bit ${channels}`
}

/**
 * Why a sample is invalid, in the order the fields appear in the readout.
 *
 * Bit depth follows the manual literally — "16–bit or 8–bit" — so a device-legal
 * 8-bit file is valid inside a 16-bit-target voice and shows no red bar. The voice's
 * target bit depth governs only what conversion *produces*. Flip STRICT_BIT_DEPTH to
 * require an exact match instead, if uniform kits ever matter more than false alarms.
 */
const STRICT_BIT_DEPTH = false

export function sampleIssues(meta: AudioMeta, target: ConversionTarget): IssueCode[] {
  const issues: IssueCode[] = []

  // The device reads .wav only, so a 44.1k/16-bit/mono FLAC is still unplayable.
  if (meta.container !== DEVICE_CONTAINER) {
    issues.push('container')
    // Everything downstream is measured against a container the device can't open;
    // piling on four more red fields would just be noise.
    return issues
  }

  // A 32-bit float or A-law WAV decodes fine in the browser and would otherwise look
  // valid — only integer PCM actually plays.
  if (meta.codec !== 'pcm') issues.push('codec')

  if (meta.sampleRate === null || meta.sampleRate !== target.sampleRate) issues.push('sampleRate')

  if (meta.bitDepth === null) {
    issues.push('bitDepth')
  } else if (STRICT_BIT_DEPTH) {
    if (meta.bitDepth !== target.bitDepth) issues.push('bitDepth')
  } else if (!(DEVICE_BIT_DEPTHS as readonly number[]).includes(meta.bitDepth)) {
    issues.push('bitDepth')
  }

  if (meta.channels !== target.channels) issues.push('channels')

  if (meta.durationSec < MIN_SAMPLE_SEC) issues.push('tooShort')

  return issues
}

export function isSampleValid(meta: AudioMeta, target: ConversionTarget): boolean {
  return sampleIssues(meta, target).length === 0
}

export function issueMessage(code: IssueCode, target: ConversionTarget): string {
  switch (code) {
    case 'container':
      return 'Not a .wav file — the Rample reads .wav only. Convert it.'
    case 'codec':
      return 'Not integer PCM. The Rample plays PCM .wav only.'
    case 'sampleRate':
      return `Sample rate must be ${target.sampleRate} Hz`
    case 'bitDepth':
      return STRICT_BIT_DEPTH
        ? `Bit depth must be ${target.bitDepth}-bit`
        : 'Bit depth must be 16-bit or 8-bit'
    case 'channels':
      return target.channels === 2
        ? 'This voice is set to stereo — the sample must be 2 channels'
        : 'This voice is set to mono — the sample must be 1 channel'
    case 'tooShort':
      return `Shorter than ${MIN_SAMPLE_SEC * 1000} ms — converting will pad it with silence`
  }
}

// ── Kit-level checks ────────────────────────────────────────────────────────────

export type KitWarningCode = 'noVoiceOne' | 'stereoAdjacency' | 'stereoOnLastVoice'

export interface KitWarning {
  code: KitWarningCode
  /** The voice the warning is about, when it's voice-specific. */
  voice?: number
  message: string
  /** Blocking warnings prevent export unless explicitly overridden. */
  blocking: boolean
}

function validLayers(kit: Kit, voice: Voice): Sample[] {
  const target = targetForVoice(voice)
  return activeLayers(voice)
    .map((id) => kit.samples[id])
    .filter((s): s is Sample => Boolean(s) && isSampleValid(s!.meta, target))
}

/**
 * Everything that would surprise the user once the card is in the module.
 *
 * Only `noVoiceOne` blocks — the manual is unambiguous that the device refuses such a
 * kit outright ("you will not be allowed to open this kit"), so shipping one silently
 * costs a round trip to the hardware. The stereo warnings are nudges: they describe
 * real hardware behaviour, but a user may genuinely intend the layout.
 */
export function kitWarnings(kit: Kit): KitWarning[] {
  const warnings: KitWarning[] = []

  // Every rule here is about the device, so all of it is reasoned in SP slots rather than
  // channel identity: what matters is which channel the user dragged into which position.
  const slots = channelsInSlotOrder(kit)

  const inSlotOne = slots[0]
  if (!inSlotOne || validLayers(kit, inSlotOne).length === 0) {
    warnings.push({
      code: 'noVoiceOne',
      voice: inSlotOne?.index ?? 1,
      blocking: true,
      message:
        'Voice 1 has no valid sample. The Rample refuses to open a kit without one — ' +
        `add a sample to the channel in SP1${inSlotOne ? ` (${inSlotOne.name})` : ''}, ` +
        'or convert an existing one.',
    })
  }

  slots.forEach((voice, position) => {
    if (voice.mode !== 'stereo') return
    const active = activeLayers(voice)
    if (active.length === 0) return

    const slot = position + 1

    // "A stereo sample will fill 2 mono voices" — so slot N eats slot N+1.
    if (slot === VOICE_COUNT) {
      warnings.push({
        code: 'stereoOnLastVoice',
        voice: voice.index,
        blocking: false,
        message:
          `${voice.name} is stereo but sits in SP${slot}, with no voice after it to occupy. ` +
          'Stereo pairs run SP1+SP2 and SP3+SP4 — move it to SP3 to get a stereo pair.',
      })
      return
    }

    const next = slots[position + 1]
    const nextActive = next ? activeLayers(next).length : 0
    if (next && nextActive > 0) {
      warnings.push({
        code: 'stereoAdjacency',
        voice: voice.index,
        blocking: false,
        message:
          `${voice.name} is stereo in SP${slot}, so on the device it also occupies SP${slot + 1}. ` +
          `The ${nextActive} sample${nextActive === 1 ? '' : 's'} on ${next.name} won't be reachable.`,
      })
    }
  })

  return warnings
}

export function hasBlockingWarning(warnings: readonly KitWarning[]): boolean {
  return warnings.some((w) => w.blocking)
}

// ── Capacity ────────────────────────────────────────────────────────────────────

export function freeSlots(voice: Voice): number {
  return Math.max(0, MAX_LAYERS_PER_VOICE - activeLayers(voice).length)
}

/** The live counter under each drop zone. */
export function describeCapacity(voice: Voice): string {
  const free = freeSlots(voice)
  const queued = queuedLayers(voice).length
  const slots = `${free} active slot${free === 1 ? '' : 's'} left`
  return queued > 0 ? `${slots}, ${queued} queued` : slots
}
