import type { VoiceIndex } from '~/domain/device'
import type { Kit, Voice } from '~/domain/types'
import { activeLayers, channelsInSlotOrder } from '~/domain/voice'
import { tagFilename, UNSURE_BELOW } from './filenameTags'
import { TYPE_NAME } from './types'
import type { SampleType } from './types'

/**
 * What the sample tags say about how a kit is put together.
 *
 * Distinct from `domain/validation`, which is about the device refusing or surprising you.
 * These are musical observations, never blocking, and the bar for adding one is high: a
 * note that merely second-guesses taste is noise, and noise is what makes people stop
 * reading warnings.
 *
 * Two candidates were considered and rejected on that basis. "SP2 and SP3 are both snares"
 * is a perfectly normal choice — two snares for two sections. "This kit has no kick" is
 * wrong for one of the most common ways this device is used, where it carries the
 * percussion and the kick comes from elsewhere. Neither survives the bar.
 */

export type CompositionCode = 'mixedFamilies'

export interface CompositionNote {
  code: CompositionCode
  /** Channel identity, not SP slot. */
  voice: VoiceIndex
  message: string
}

/**
 * Coarse families, so that near neighbours do not trip the check.
 *
 * A snare and a rimshot on one channel is a sound design decision; a kick and a hi-hat is
 * usually an accident. The grouping is drawn where the mistake becomes audible rather than
 * where the taxonomy has a seam.
 */
const FAMILY: Partial<Record<SampleType, string>> = {
  kick: 'low',
  bass: 'low',
  snare: 'body',
  clap: 'body',
  rim: 'body',
  tom: 'body',
  hat: 'metal',
  cymbal: 'metal',
  perc: 'perc',
  tonal: 'tuned',
  chord: 'tuned',
  vocal: 'tuned',
  // fx and loop are wildcards — layering an FX sweep under a kick is a deliberate move,
  // and flagging it would punish the technique. Deliberately absent, not forgotten.
}

/** Plural, lowercase, for listing inside a sentence: "kicks and hi-hats". */
function plural(type: SampleType): string {
  const name = TYPE_NAME[type].toLowerCase()
  return name.endsWith('s') ? name : `${name}s`
}

function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/**
 * The families present on one channel, with a representative type for each.
 *
 * Only confident tags count. A guess is not evidence enough to tell someone their channel
 * is wrong, and the whole point of the confidence number is that it can be thresholded
 * rather than believed.
 */
function familiesOn(kit: Kit, voice: Voice): Map<string, SampleType> {
  const found = new Map<string, SampleType>()
  for (const sampleId of activeLayers(voice)) {
    const sample = kit.samples[sampleId]
    if (!sample) continue
    const tags = tagFilename(sample.name)
    if (tags.confidence < UNSURE_BELOW) continue
    const family = FAMILY[tags.type]
    if (family && !found.has(family)) found.set(family, tags.type)
  }
  return found
}

/**
 * Observations worth surfacing about how this kit is arranged.
 *
 * Currently one rule, and that is deliberate — see the note at the top of the file.
 *
 * A channel holding more than one family is worth saying out loud because of how the
 * hardware behaves: one layer sounds per trigger, chosen by the channel's playback mode.
 * So a channel carrying a kick and a hi-hat does not play a kick with a hi-hat on top —
 * it plays one or the other, and which one is not something the pattern controls. That is
 * a surprise the user pays for on the device, and it is invisible in a list of filenames.
 */
export function kitComposition(kit: Kit): CompositionNote[] {
  const notes: CompositionNote[] = []

  for (const voice of channelsInSlotOrder(kit)) {
    const families = familiesOn(kit, voice)
    if (families.size < 2) continue

    const names = [...families.values()].map(plural)
    notes.push({
      code: 'mixedFamilies',
      voice: voice.index,
      message:
        `${voice.name} mixes ${listOf(names)}. Only one layer sounds per trigger, so these ` +
        'take turns rather than playing together — put them on separate channels if you want them at once.',
    })
  }

  return notes
}
