import { useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMemo } from 'react'
import { MAX_LAYERS_PER_VOICE } from '~/domain/device'
import type { VoiceIndex } from '~/domain/device'
import type { Kit, Voice } from '~/domain/types'
import {
  describeCapacity,
  describeTarget,
  freeSlots,
  isSampleValid,
  kitWarnings,
  targetForVoice,
} from '~/domain/validation'
import { activeSlots, distinctSamples, queuedSlots } from '~/domain/voice'
import { triggerNow } from '~/audio/player'
import { useSession } from '~/store/useSession'
import { SampleRow } from './SampleRow'
import { DropZone } from './DropZone'
import { Badge, Button, Segmented } from './ui/Controls'
import { Fader } from './ui/Fader'
import { ChannelName } from './ui/ChannelName'
import { MuteSolo } from './ui/MuteSolo'
import { GripIcon, PlayIcon, WarningIcon } from './ui/Icons'
import styles from './VoicePanel.module.css'

/**
 * Everything the browser's decoders can open. The device itself only reads .wav, so
 * anything else here is an import convenience — it arrives invalid and must be
 * converted, which the pipeline handles identically regardless of source format.
 */
const ACCEPTED = '.wav,.mp3,.flac,.ogg,.oga,.m4a,.mp4,.aac,.opus,.webm,audio/*'

interface VoicePanelProps {
  kit: Kit
  voice: Voice
  /** The SP slot this panel currently sits in — the device voice number it exports as. */
  slot: VoiceIndex
}

export function VoicePanel({ kit, voice, slot }: VoicePanelProps) {
  const importFiles = useSession((s) => s.importFiles)
  const setVoiceMode = useSession((s) => s.setVoiceMode)
  const setConvertMode = useSession((s) => s.setConvertMode)
  const convertVoice = useSession((s) => s.convertVoice)
  const setPreviewMode = useSession((s) => s.setPreviewMode)
  const setPreviewCursor = useSession((s) => s.setPreviewCursor)
  const setVoiceVolume = useSession((s) => s.setVoiceVolume)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `voice-${voice.index}`,
    data: { type: 'voice-panel', voice: voice.index },
  })

  // A separate droppable covering the list, so a layer can be dropped onto a voice
  // that has no rows to aim at yet.
  const { setNodeRef: setListRef, isOver } = useDroppable({
    id: `voice-list-${voice.index}`,
    data: { type: 'voice-container', voice: voice.index },
  })

  const target = targetForVoice(voice)
  const active = activeSlots(voice)
  const queued = queuedSlots(voice)

  // Counted over distinct samples, not slots: four slots holding one bad sample is one
  // problem to fix, and reporting it as four would overstate the work.
  const invalidCount = useMemo(
    () =>
      distinctSamples(voice).filter((id) => {
        const sample = kit.samples[id]
        return sample && !isSampleValid(sample.meta, target)
      }).length,
    [voice, kit.samples, target],
  )

  const voiceWarnings = kitWarnings(kit).filter((w) => w.voice === voice.index && !w.blocking)
  const full = freeSlots(voice) === 0

  return (
    <section
      ref={setNodeRef}
      className={`${styles.panel} ${isDragging ? styles.dragging : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      aria-label={`Channel ${voice.name} in SP${slot}`}
    >
      <header className={styles.header}>
        <span
          className={styles.grip}
          {...attributes}
          {...listeners}
          aria-label={`Move ${voice.name} to another SP slot`}
        >
          <GripIcon />
        </span>
        {/* The slot label belongs to the position, not the channel, so it stays put while
            channels are dragged between slots. It is what the device will call this. */}
        <span
          className={styles.slot}
          title={`Exports as the Rample's voice ${slot}. Drag a channel here to change that.`}
        >
          SP{slot}
        </span>
        <ChannelName voice={voice} />
        <span className={styles.headerSpacer} />
        {invalidCount > 0 && <Badge tone="danger">{invalidCount} invalid</Badge>}
        <MuteSolo kit={kit} voice={voice} />
      </header>

      <div className={styles.body}>
        <div className={styles.settingRow}>
          <span className={styles.settingLabel}>Channels</span>
          <Segmented
            label={`${voice.name} channel mode`}
            value={voice.mode}
            onChange={(mode) => setVoiceMode(voice.index, mode)}
            options={[
              { value: 'mono', label: 'Mono' },
              {
                value: 'stereo',
                label: 'Stereo',
                title: 'A stereo voice also occupies the next voice on the device',
              },
            ]}
          />
        </div>

        <div className={styles.settingRow}>
          <span className={styles.settingLabel}>Convert</span>
          <Segmented
            label={`${voice.name} convert mode`}
            value={voice.convertMode}
            onChange={(mode) => setConvertMode(voice.index, mode)}
            options={[
              { value: 'manual', label: 'Manual' },
              { value: 'auto', label: 'Auto', title: 'Convert files as soon as they are added' },
            ]}
          />
        </div>

        <p className={styles.caption}>New files convert to {describeTarget(target)}</p>

        <DropZone
          label="Drop samples here"
          hint={`Up to ${MAX_LAYERS_PER_VOICE} active samples — extras are queued`}
          accept={ACCEPTED}
          onFiles={(files) => void importFiles(voice.index, files)}
        />

        <div className={`${styles.capacity} ${full ? styles.capacityFull : ''}`}>
          {describeCapacity(voice)}
        </div>

        {voiceWarnings.map((warning) => (
          <div key={warning.code} className={styles.warning} role="status">
            <WarningIcon className={styles.warningIcon} />
            <span>{warning.message}</span>
          </div>
        ))}

        {invalidCount > 0 && (
          <Button variant="accent" onClick={() => void convertVoice(voice.index)}>
            Convert all samples ({invalidCount})
          </Button>
        )}

        <div className={styles.previewBlock}>
          <div className={styles.settingRow}>
            <span className={styles.settingLabel}>Playback</span>
            <Segmented
              label={`${voice.name} playback mode`}
              value={voice.previewMode}
              onChange={(mode) => setPreviewMode(voice.index, mode)}
              options={[
                {
                  value: 'random',
                  label: 'Random',
                  title: 'Pick a random layer per trigger — the device default',
                },
                { value: 'cyclic', label: 'Cyclic', title: 'Round-robin through the layers in order' },
                { value: 'manual', label: 'Manual', title: 'Always play the layer selected in the list' },
              ]}
            />
          </div>

          <Fader
            label="Vol"
            value={voice.mixer.volume}
            onChange={(volume) => setVoiceVolume(voice.index, volume)}
          />

          <Button
            small
            onClick={() => void triggerNow(voice.index)}
            disabled={active.length === 0}
            title={`Trigger ${voice.name} using its playback mode — or press ${slot} anywhere`}
          >
            <PlayIcon />
            Play next
            <kbd className={styles.kbd}>{slot}</kbd>
          </Button>
        </div>

        <div ref={setListRef} style={isOver ? { outline: '1px dashed var(--color-accent)' } : undefined}>
          {/* Keyed by slot id, not sample id: two slots can hold the same sample, and
              drag-and-drop needs to tell them apart to animate a reorder correctly. */}
          <SortableContext
            items={voice.layers.map((entry) => entry.id)}
            strategy={verticalListSortingStrategy}
          >
            {active.length === 0 && queued.length === 0 && (
              <p className={styles.empty}>No samples yet</p>
            )}

            <ul className={styles.list}>
              {active.map((entry, index) => {
                const sample = kit.samples[entry.sampleId]
                if (!sample) return null
                return (
                  <SampleRow
                    key={entry.id}
                    slot={entry}
                    sample={sample}
                    kit={kit}
                    voiceRef={voice}
                    voice={voice.index}
                    position={index}
                    queued={false}
                    target={target}
                    randomMode={voice.previewMode === 'random'}
                    cyclicMode={voice.previewMode === 'cyclic'}
                    selectable={voice.previewMode === 'manual'}
                    selected={voice.previewMode === 'manual' && voice.previewCursor === index}
                    onSelect={(position) => setPreviewCursor(voice.index, position)}
                  />
                )
              })}
            </ul>

            {queued.length > 0 && (
              <>
                <div className={styles.sectionLabel}>Queued samples</div>
                <ul className={styles.list}>
                  {queued.map((entry, index) => {
                    const sample = kit.samples[entry.sampleId]
                    if (!sample) return null
                    return (
                      <SampleRow
                        key={entry.id}
                        slot={entry}
                        sample={sample}
                        kit={kit}
                        voiceRef={voice}
                        voice={voice.index}
                        position={MAX_LAYERS_PER_VOICE + index}
                        queued
                        target={target}
                      />
                    )
                  })}
                </ul>
              </>
            )}
          </SortableContext>
        </div>
      </div>
    </section>
  )
}
