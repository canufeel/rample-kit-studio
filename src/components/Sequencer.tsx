import { useEffect, useState } from 'react'
import { onTransport } from '~/audio/scheduler'
import type { VoiceIndex } from '~/domain/device'
import {
  DENSITY_BANDS,
  DENSITY_MODES,
  DIVISIONS,
  MAX_LENGTH,
  MIN_LENGTH,
  resolvePattern,
} from '~/domain/sequence'
import type { ChannelSequence, DensityMode, DivisionId, Kit, Voice } from '~/domain/types'
import { activeLayers, channelsInSlotOrder } from '~/domain/voice'
import { useLibrary } from '~/store/useLibrary'
import { useActiveKit, useChannelSequence, useSession } from '~/store/useSession'
import { ChannelName } from './ui/ChannelName'
import { MuteSolo } from './ui/MuteSolo'
import { NumberStepper } from './ui/NumberStepper'
import { Segmented } from './ui/Controls'
import { SaveIcon } from './ui/Icons'
import styles from './Sequencer.module.css'

/** The playhead for one channel, subscribed outside React state to avoid store churn. */
function usePlayhead(voice: VoiceIndex): number | null {
  const [step, setStep] = useState<number | null>(null)
  useEffect(
    () => onTransport((snapshot) => setStep(snapshot.playing ? (snapshot.steps[voice] ?? null) : null)),
    [voice],
  )
  return step
}

function StepGrid({
  sequence,
  voice,
  name,
  editable,
}: {
  sequence: ChannelSequence
  voice: VoiceIndex
  name: string
  editable: boolean
}) {
  const toggleStep = useSession((s) => s.toggleStep)
  const playhead = usePlayhead(voice)
  const pattern = resolvePattern(sequence)

  return (
    <div
      className={`${styles.grid} ${editable ? '' : styles.readonlyGrid}`}
      role={editable ? 'group' : undefined}
      aria-label={editable ? `${name} steps` : undefined}
    >
      {pattern.map((on, index) => {
        const classes = [
          styles.step,
          index % 4 === 0 ? styles.stepDownbeat : '',
          on ? styles.stepOn : '',
          playhead === index ? styles.stepPlayhead : '',
          editable ? styles.stepEditable : '',
        ]
          .filter(Boolean)
          .join(' ')

        // Euclidean steps are generated, so they render as output rather than input —
        // editing one would silently contradict the triggers/rotation above it.
        return editable ? (
          <button
            key={index}
            type="button"
            className={classes}
            onClick={() => toggleStep(voice, index)}
            aria-pressed={on}
            aria-label={`Step ${index + 1}`}
          />
        ) : (
          <span key={index} className={classes} aria-hidden />
        )
      })}
    </div>
  )
}

function Channel({ channel, slot, kit }: { channel: Voice; slot: VoiceIndex; kit: Kit }) {
  const voice = channel.index
  const sequence = useChannelSequence(voice)
  const updateSequence = useSession((s) => s.updateSequence)
  const randomiseChannel = useSession((s) => s.randomiseChannel)
  const beginPatternSave = useLibrary((s) => s.beginPatternSave)
  const pendingVoice = useLibrary((s) => s.pendingVoice)

  const layers = activeLayers(channel).length

  const pattern = resolvePattern(sequence)
  const hits = pattern.filter(Boolean).length
  const euclidean = sequence.kind === 'euclidean'

  return (
    <div className={`${styles.channel} ${layers === 0 ? styles.channelSilent : ''}`}>
      {/* Named by channel, since the pattern belongs to the channel and travels with it.
          The SP slot is shown alongside so the export order stays readable from here. */}
      <span className={styles.slot} title={`Exports as the Rample's voice ${slot}`}>
        SP{slot}
      </span>
      <ChannelName voice={channel} size="sm" />
      <MuteSolo kit={kit} voice={channel} size="sm" />

      <Segmented
        label={`${channel.name} pattern kind`}
        value={sequence.kind}
        onChange={(kind) => updateSequence(voice, { kind })}
        options={[
          { value: 'euclidean', label: 'Euclid' },
          { value: 'user', label: 'User' },
        ]}
      />

      <div className={styles.control}>
        <span className={styles.controlLabel}>Div</span>
        <select
          className={styles.select}
          value={sequence.division}
          onChange={(e) => updateSequence(voice, { division: e.target.value as DivisionId })}
          aria-label={`${channel.name} time division`}
        >
          {DIVISIONS.map((division) => (
            <option key={division.id} value={division.id}>
              {division.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.control}>
        <span className={styles.controlLabel}>Len</span>
        <NumberStepper
          value={sequence.length}
          min={MIN_LENGTH}
          max={MAX_LENGTH}
          onChange={(length) => updateSequence(voice, { length })}
          label={`${channel.name} pattern length`}
        />
      </div>

      {/*
        Triggers and rotation only mean something for a generated pattern, but the row has
        to keep its shape either way. Dropping them in User mode let the density select,
        the dice, the step grid and the summary all slide left, so a User channel stopped
        lining up with the Euclid channels above and below it.

        The same markup is therefore always rendered, and merely made invisible and inert
        when it does not apply. That reserves exactly the right width by construction —
        a hand-matched spacer would silently drift the next time these two controls change.
        `visibility: hidden` also takes them out of the tab order and the accessibility
        tree, so there is nothing to skip past.
      */}
      <div
        className={`${styles.euclidOnly} ${euclidean ? '' : styles.reserved}`}
        aria-hidden={!euclidean}
      >
        <div className={styles.control}>
          <span className={styles.controlLabel}>Trig</span>
          <NumberStepper
            value={sequence.triggers}
            min={0}
            max={sequence.length}
            onChange={(triggers) => updateSequence(voice, { triggers })}
            label={`${channel.name} triggers`}
          />
        </div>
        <div className={styles.control}>
          <span className={styles.controlLabel}>Rot</span>
          <NumberStepper
            value={sequence.rotation}
            min={0}
            max={Math.max(0, sequence.length - 1)}
            onChange={(rotation) => updateSequence(voice, { rotation })}
            label={`${channel.name} rotation`}
          />
        </div>
      </div>

      <div className={styles.control}>
        <select
          className={styles.select}
          value={sequence.densityMode}
          onChange={(e) => updateSequence(voice, { densityMode: e.target.value as DensityMode })}
          aria-label={`${channel.name} randomise density`}
        >
          {DENSITY_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {mode} · {DENSITY_BANDS[mode].label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`${styles.dice} ${sequence.pendingRandomise ? styles.dicePending : ''}`}
          onClick={() => randomiseChannel(voice, sequence.densityMode)}
          title={
            sequence.pendingRandomise
              ? 'Queued — applies at this channel’s next loop boundary'
              : `Roll a new ${sequence.densityMode} pattern`
          }
          aria-label={`Randomise ${channel.name}`}
        >
          ⚄
        </button>
      </div>

      <StepGrid sequence={sequence} voice={voice} name={channel.name} editable={!euclidean} />

      <span className={styles.summary}>
        {hits}/{sequence.length}
      </span>

      {/* Second entry point into the library's naming flow, next to the pattern it saves.
          The panel below owns the name field; this just says which channel to capture. */}
      <button
        type="button"
        className={`${styles.dice} ${pendingVoice === voice ? styles.dicePending : ''}`}
        onClick={() => beginPatternSave(voice)}
        title={`Save ${channel.name}'s pattern to the library`}
        aria-label={`Save ${channel.name} pattern to library`}
      >
        <SaveIcon size={12} />
      </button>
    </div>
  )
}

/**
 * Four channels, one per voice, sharing the global clock.
 *
 * Each channel keeps its own step count and division, so channels of differing length
 * drift against one another instead of locking to a bar — polymeter arrives for free
 * from having one tempo and four independent lengths.
 */
export function Sequencer() {
  const kit = useActiveKit()
  // Listed in slot order so the rows line up with the channel panels below, but each row
  // addresses its channel by identity — dragging a channel moves its pattern with it.
  const slotOrder = channelsInSlotOrder(kit)

  return (
    <section className={styles.sequencer} aria-label="Sequencer">
      <header className={styles.header}>
        <h2 className={styles.title}>Sequencer</h2>
        <span className={styles.subtitle}>
          Preview only — the Rample has no sequencer, so none of this is exported
        </span>
      </header>

      {slotOrder.map((channel, position) => (
        <Channel
          key={channel.index}
          channel={channel}
          slot={(position + 1) as VoiceIndex}
          kit={kit}
        />
      ))}
    </section>
  )
}
