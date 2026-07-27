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
 * Grouped by role in the kit, not by timbre.
 *
 * The first version of this split by sound — low, body, metal, tuned — and warned on a
 * channel holding hi-hats and rims. That is not a mistake; it is a percussion channel
 * built to alternate, which is one of the more useful things this device does. Warning on
 * it was exactly the second-guessing of taste this file is supposed to avoid.
 *
 * The line that matters is not "do these two sound alike" but "would you have put them on
 * the same voice". Anything in the percussion role is fair game to alternate between: a
 * channel of hats, rims, claps and shakers is a deliberate arrangement. Mixing *roles* is
 * what surprises people, because the roles are what the pattern is written against — a
 * kick pattern playing a hi-hat half the time is never what was meant.
 */
const ROLE: Partial<Record<SampleType, string>> = {
  // The bottom of the kit. A channel alternating kicks and toms is a low-drum channel.
  kick: 'low',
  tom: 'low',

  // Everything you would write a percussion pattern for, whatever it is made of.
  snare: 'perc',
  clap: 'perc',
  rim: 'perc',
  hat: 'perc',
  cymbal: 'perc',
  perc: 'perc',

  // Pitched material. Bass belongs here rather than with the low drums: alternating a
  // kick with a bass note is the mistake, not the technique.
  bass: 'tuned',
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
 * What is on one channel: the roles present, and every distinct instrument.
 *
 * Both are needed, and they answer different questions. The roles decide *whether* to say
 * anything; the instruments are what the message names. Reporting one instrument per role
 * would describe a channel of kicks, snares and hats as "mixes kicks and snares", which is
 * true but reads as though the app cannot see the third.
 *
 * Only confident tags count. A guess is not evidence enough to tell someone their channel
 * is wrong, and the whole point of the confidence number is that it can be thresholded
 * rather than believed.
 */
function contentsOf(kit: Kit, voice: Voice): { roles: Set<string>; types: SampleType[] } {
  const roles = new Set<string>()
  const types: SampleType[] = []

  for (const sampleId of activeLayers(voice)) {
    const sample = kit.samples[sampleId]
    if (!sample) continue
    const tags = tagFilename(sample.name)
    if (tags.confidence < UNSURE_BELOW) continue
    const role = ROLE[tags.type]
    if (!role) continue
    roles.add(role)
    if (!types.includes(tags.type)) types.push(tags.type)
  }

  return { roles, types }
}

/**
 * Observations worth surfacing about how this kit is arranged.
 *
 * Currently one rule, and that is deliberate — see the note at the top of the file.
 *
 * A channel holding more than one *role* is worth saying out loud because of how the
 * hardware behaves: one layer sounds per trigger, chosen by the channel's playback mode.
 * So a channel carrying a kick and a hi-hat does not play a kick with a hi-hat on top —
 * it plays one or the other, and which one is not something the pattern controls. That is
 * a surprise the user pays for on the device, and it is invisible in a list of filenames.
 */
export function kitComposition(kit: Kit): CompositionNote[] {
  const notes: CompositionNote[] = []

  for (const voice of channelsInSlotOrder(kit)) {
    const { roles, types } = contentsOf(kit, voice)
    if (roles.size < 2) continue

    const names = types.map(plural)
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
