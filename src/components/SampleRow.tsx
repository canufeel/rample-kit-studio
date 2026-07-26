import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { describeFilenameTags, tagFilename, UNSURE_BELOW } from '~/analysis/filenameTags'
import { TYPE_LABEL } from '~/analysis/types'
import { auditionSample, onVoiceActivity } from '~/audio/player'
import type { VoiceIndex } from '~/domain/device'
import type { ConversionTarget, Kit, Sample, Slot, Voice } from '~/domain/types'
import {
  freeSlotCount,
  selectionProbability,
  slotCopyPosition,
  slotGroups,
  slotWeight,
} from '~/domain/voice'
import { ISSUE_FIELD, issueMessage, sampleIssues } from '~/domain/validation'
import type { MetaField } from '~/domain/validation'
import {
  formatBitDepth,
  formatChannels,
  formatDuration,
  formatSampleRate,
  formatSize,
} from '~/lib/format'
import { useSession } from '~/store/useSession'
import { Badge } from './ui/Controls'
import { CloseIcon, ConvertIcon, GripIcon, PlayIcon, PlusIcon, StopIcon } from './ui/Icons'
import styles from './SampleRow.module.css'

/**
 * The sample currently sounding on this voice.
 *
 * Subscribes to the player rather than the store: what is sounding changes on every
 * sequencer step, and routing that through React state would re-render the whole panel
 * at audio rate.
 */
function useSoundingId(voice: VoiceIndex): string | null {
  const [sounding, setSounding] = useState<string | null>(null)
  useEffect(() => onVoiceActivity((state) => setSounding(state[voice] ?? null)), [voice])
  return sounding
}

interface SampleRowProps {
  /** The layer slot this row *is*. Several rows can hold the same sample. */
  slot: Slot
  sample: Sample
  kit: Kit
  /** The channel, for slot arithmetic — how many are free, what this sample's odds are. */
  voiceRef: Voice
  voice: VoiceIndex
  /** Position within the voice's full slot list. */
  position: number
  queued: boolean
  target: ConversionTarget
  /** Manual preview mode turns the index into a layer selector. */
  selectable?: boolean
  selected?: boolean
  onSelect?: (position: number) => void
  /** Random mode adds a per-sample mute and a probability stepper. */
  randomMode?: boolean
  /** Cyclic mode adds slot duplication, which is how a sequence is built by hand. */
  cyclicMode?: boolean
}

export function SampleRow({
  slot,
  sample,
  kit,
  voiceRef,
  voice,
  position,
  queued,
  target,
  selectable,
  selected,
  onSelect,
  randomMode,
  cyclicMode,
}: SampleRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    // The slot, not the sample: two rows may hold the same sample and dragging has to be
    // able to tell them apart.
    id: slot.id,
    data: { type: 'layer', voice, index: position },
  })

  const soundingId = useSoundingId(voice)
  const converting = useSession((s) => Boolean(s.converting[sample.id]))
  const convertSample = useSession((s) => s.convertSample)
  const toggleRandomMute = useSession((s) => s.toggleRandomMute)
  const removeSlot = useSession((s) => s.removeSlot)
  const setSampleWeight = useSession((s) => s.setSampleWeight)
  const duplicateSlot = useSession((s) => s.duplicateSlot)

  const weight = slotWeight(voiceRef, sample.id)
  const free = freeSlotCount(voiceRef)
  const probability = selectionProbability(kit, voiceRef, sample.id)
  // One row per slot, so a duplicated sample's controls appear on each of its rows. The
  // weight stepper is shown on the first only, since it governs the sample not the slot.
  const firstSlotOfSample =
    voiceRef.layers.find((entry) => entry.sampleId === sample.id)?.id === slot.id

  const group = slotGroups(voiceRef).get(sample.id)
  const { copy, of } = slotCopyPosition(voiceRef, slot.id)

  // Derived from the name, not stored: the read is microseconds and keeping it out of the
  // model means no migration, no cache to invalidate, and no way for it to go stale.
  // The audio tier will need storage; this one does not.
  const tags = useMemo(() => tagFilename(sample.name), [sample.name])

  // Governs the sample, not the slot, so it appears on the sample's first row only — and it
  // changes the row's grid template, hence being computed once rather than inline twice.
  const showProbability = Boolean(randomMode) && !queued && firstSlotOfSample

  const issues = sampleIssues(sample.meta, target)
  const invalid = issues.length > 0
  const badFields = new Set<MetaField>(issues.map((code) => ISSUE_FIELD[code]))
  const isPlaying = soundingId === sample.id

  const reasons = issues.map((code) => issueMessage(code, target)).join('\n')

  const classes = [
    styles.row,
    invalid ? styles.invalid : '',
    queued ? styles.queued : '',
    isPlaying ? styles.playing : '',
    isDragging ? styles.dragging : '',
    randomMode && sample.randomMuted ? styles.randomMuted : '',
    showProbability ? styles.withProbability : '',
  ]
    .filter(Boolean)
    .join(' ')

  const metaFields: { key: MetaField; text: string }[] = [
    { key: 'sampleRate', text: formatSampleRate(sample.meta.sampleRate) },
    { key: 'bitDepth', text: formatBitDepth(sample.meta) },
    { key: 'size', text: formatSize(sample.meta.sizeBytes) },
    { key: 'length', text: formatDuration(sample.meta.durationSec) },
    { key: 'channels', text: formatChannels(sample.meta.channels) },
  ]

  return (
    <li
      ref={setNodeRef}
      className={classes}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      title={invalid ? reasons : undefined}
    >
      <span className={styles.grip} {...attributes} {...listeners} aria-label="Reorder sample">
        <GripIcon />
      </span>

      {selectable ? (
        <button
          type="button"
          className={`${styles.index} ${styles.indexSelectable} ${selected ? styles.indexSelected : ''}`}
          onClick={() => onSelect?.(position)}
          title="Play this layer in Manual mode"
          aria-pressed={selected}
        >
          {position + 1}
        </button>
      ) : (
        <span className={styles.index}>{queued ? '·' : position + 1}</span>
      )}

      <span
        className={[
          styles.type,
          tags.type === 'unknown' ? styles.typeNone : '',
          tags.confidence > 0 && tags.confidence < UNSURE_BELOW ? styles.typeUnsure : '',
        ]
          .filter(Boolean)
          .join(' ')}
        title={describeFilenameTags(tags)}
      >
        {TYPE_LABEL[tags.type]}
      </span>

      <span className={styles.name}>
        {/* Ties together the rows holding one sample, which is the only reliable way to see
            that once the names are truncated or the rows have been dragged apart. */}
        {group !== undefined && (
          <span
            className={`${styles.groupDot} ${styles[`group${group}`]}`}
            title={`${sample.name} — copy ${copy} of ${of}`}
          />
        )}
        <span className={styles.nameText}>{sample.name}</span>
        {queued && <Badge tone="queued">queued</Badge>}
        {sample.padded && !invalid && <Badge tone="warning">padded</Badge>}
      </span>

      <span className={styles.actions}>
        {converting ? (
          <span className={styles.spinner} role="status" aria-label="Converting" />
        ) : (
          <>
            <button
              type="button"
              className={`${styles.iconButton} ${isPlaying ? styles.iconButtonActive : ''}`}
              onClick={() => void auditionSample(voice, sample.id)}
              aria-label={isPlaying ? `Stop ${sample.name}` : `Play ${sample.name}`}
            >
              {isPlaying ? <StopIcon /> : <PlayIcon />}
            </button>
            {/* Random-only: outside Random the flag is inert, so showing the control would
                imply it does something. The flag itself is remembered either way. */}
            {randomMode && (
              <button
                type="button"
                className={`${styles.iconButton} ${sample.randomMuted ? styles.muteActive : ''}`}
                onClick={() => toggleRandomMute(voice, sample.id)}
                aria-pressed={sample.randomMuted}
                aria-label={
                  sample.randomMuted
                    ? `Include ${sample.name} in random selection`
                    : `Exclude ${sample.name} from random selection`
                }
                title={
                  sample.randomMuted
                    ? 'Excluded from the random draw — still exported to the card'
                    : 'Exclude from the random draw. The other layers share its odds.'
                }
              >
                M
              </button>
            )}
            {/* Cyclic-only: repeating a sample in the list *is* the sequence, so a copy is
                the unit of editing. Disabled when the twelve slots are spent. */}
            {cyclicMode && !queued && (
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => duplicateSlot(voice, slot.id)}
                disabled={free === 0}
                aria-label={`Duplicate ${sample.name} in the sequence`}
                title={
                  free === 0
                    ? 'All twelve layer slots are in use — remove one to duplicate'
                    : `Add another ${sample.name} after this one. ${free} slot${free === 1 ? '' : 's'} free.`
                }
              >
                <PlusIcon />
              </button>
            )}
            <button
              type="button"
              className={`${styles.iconButton} ${invalid ? styles.convertNeeded : ''}`}
              onClick={() => void convertSample(voice, sample.id)}
              aria-label={`Convert ${sample.name}`}
              title={
                invalid
                  ? `Convert to ${target.sampleRate} Hz, ${target.bitDepth}-bit, ${target.channels === 2 ? 'stereo' : 'mono'}`
                  : 'Already matches this voice — convert again anyway'
              }
            >
              <ConvertIcon />
            </button>
          </>
        )}
        <button
          type="button"
          className={`${styles.iconButton} ${styles.deleteButton}`}
          onClick={() => removeSlot(voice, slot.id)}
          aria-label={weight > 1 ? `Remove this copy of ${sample.name}` : `Remove ${sample.name}`}
          title={
            weight > 1
              ? `Remove this copy. ${weight - 1} will remain.`
              : `Remove ${sample.name} from this channel`
          }
        >
          <CloseIcon />
        </button>
      </span>

      <span className={styles.meta}>
        {metaFields.map((field, i) => (
          <Fragment key={field.key}>
            {i > 0 && <span className={styles.separator}>|</span>}
            <span
              className={`${styles.metaField} ${badFields.has(field.key) ? styles.metaFieldBad : ''}`}
            >
              {field.text}
            </span>
          </Fragment>
        ))}
      </span>

      {/*
        Probability, Random mode only. The steps are whole slots because that is what the
        card can express: raising a sample's odds writes another copy of it, exactly the
        trick you would use on the hardware by hand. So the stepper's ceiling is however
        many slots are free, and a full voice cannot be reweighted at all.
      */}
      {showProbability && (
        <span className={styles.probability}>
          <button
            type="button"
            className={styles.stepper}
            onClick={() => setSampleWeight(voice, sample.id, weight - 1)}
            disabled={weight <= 1}
            aria-label={`Lower the odds of ${sample.name}`}
            title={weight <= 1 ? 'Already at one slot' : 'One fewer copy'}
          >
            −
          </button>
          <span
            className={styles.odds}
            title={`${weight} of ${voiceRef.layers.length} slots · ${free} free`}
          >
            {sample.randomMuted ? '—' : `${Math.round(probability * 100)}%`}
            {weight > 1 && <span className={styles.multiplier}>×{weight}</span>}
          </span>
          <button
            type="button"
            className={styles.stepper}
            onClick={() => setSampleWeight(voice, sample.id, weight + 1)}
            disabled={free === 0}
            aria-label={`Raise the odds of ${sample.name}`}
            title={free === 0 ? 'All twelve layer slots are in use' : 'One more copy'}
          >
            +
          </button>
        </span>
      )}

      {invalid && <span className={styles.bar} aria-hidden />}
    </li>
  )
}
