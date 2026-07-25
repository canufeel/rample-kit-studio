import type { VoiceIndex } from '~/domain/device'
import { exportFilename, exportPath } from '~/domain/filename'
import type { Kit, Sample } from '~/domain/types'
import { isSampleValid, kitWarnings, targetForVoice } from '~/domain/validation'
import type { KitWarning } from '~/domain/validation'
import { activeLayers, channelsInSlotOrder, queuedSlots } from '~/domain/voice'
import { requireAudio } from '~/storage/audioStore'

/** A file that will be written, before its bytes have been fetched. */
export interface PlannedFile {
  /** Path inside the bundle, e.g. `A0/1-01_Kick.wav`. */
  path: string
  filename: string
  /**
   * The device voice number this lands on — the channel's SP slot, not its identity.
   * Reordering channels changes this; renaming one does not.
   */
  slot: VoiceIndex
  /** The channel's name, so the dialog can say which channel a file came from. */
  channelName: string
  sampleId: string
  sourceName: string
}

export interface ExportEntry extends PlannedFile {
  bytes: ArrayBuffer
}

export interface ExcludedEntry {
  slot: VoiceIndex
  channelName: string
  sourceName: string
  reason: 'invalid' | 'queued'
}

export interface ExportPlan {
  kitCode: string
  entries: ExportEntry[]
  excluded: ExcludedEntry[]
  warnings: KitWarning[]
}

/**
 * Work out exactly what would be written, before writing anything.
 *
 * Only valid samples are exported — an invalid one would either be refused by the
 * device or load as garbage. But they're reported rather than silently dropped, so the
 * export dialog can say what's being left behind and why. Queued layers past the
 * device's 12 are excluded for the same reason: the hardware would never see them.
 *
 * Pure, so the slot-numbering rules can be tested without a browser or IndexedDB.
 */
export function planFiles(kit: Kit): { files: PlannedFile[]; excluded: ExcludedEntry[] } {
  const files: PlannedFile[] = []
  const excluded: ExcludedEntry[] = []

  // Walked in slot order, so the device voice number is the channel's position rather
  // than its identity: whichever channel the user dragged into SP1 exports as voice 1.
  channelsInSlotOrder(kit).forEach((voice, position) => {
    const deviceVoice = (position + 1) as VoiceIndex
    const target = targetForVoice(voice)
    const active = activeLayers(voice)

    // Layer numbering counts only exported layers, so skipping an invalid sample doesn't
    // leave a gap in the sequence the device sorts by.
    let layer = 0
    for (const id of active) {
      const sample: Sample | undefined = kit.samples[id]
      if (!sample) continue

      if (!isSampleValid(sample.meta, target)) {
        excluded.push({
          slot: deviceVoice,
          channelName: voice.name,
          sourceName: sample.name,
          reason: 'invalid',
        })
        continue
      }

      const filename = exportFilename(deviceVoice, layer, sample.name)
      files.push({
        path: exportPath(kit.code, filename),
        filename,
        slot: deviceVoice,
        channelName: voice.name,
        sampleId: id,
        sourceName: sample.name,
      })
      layer++
    }

    for (const slot of queuedSlots(voice)) {
      const sample = kit.samples[slot.sampleId]
      if (sample) {
        excluded.push({
          slot: deviceVoice,
          channelName: voice.name,
          sourceName: sample.name,
          reason: 'queued',
        })
      }
    }
  })

  return { files, excluded }
}

export async function planExport(kit: Kit): Promise<ExportPlan> {
  const { files, excluded } = planFiles(kit)
  const entries = await Promise.all(
    files.map(async (file) => ({ ...file, bytes: await requireAudio(file.sampleId) })),
  )
  return { kitCode: kit.code, entries, excluded, warnings: kitWarnings(kit) }
}

export async function planExportAll(kits: readonly Kit[]): Promise<ExportPlan[]> {
  return Promise.all(kits.map(planExport))
}
