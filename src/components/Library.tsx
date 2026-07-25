import { useEffect, useRef, useState } from 'react'
import { FACTORY_PRESETS } from '~/domain/factoryPresets'
import {
  MAX_NAME_LENGTH,
  defaultPatternName,
  describeSequence,
  isSilent,
  patternForRecall,
  presetForRecall,
  presetMatchesLive,
} from '~/domain/library'
import { resolvePattern } from '~/domain/sequence'
import type { ChannelSequence, SavedPattern, SavedPreset, Voice } from '~/domain/types'
import { channelsInSlotOrder } from '~/domain/voice'
import { formatTimestamp } from '~/lib/format'
import { useLibrary } from '~/store/useLibrary'
import {
  useActiveBpm,
  useActiveKit,
  useActivePresetId,
  useActiveSequences,
  useSession,
} from '~/store/useSession'
import { Button } from './ui/Controls'
import { CloseIcon, PlusIcon, SaveIcon } from './ui/Icons'
import styles from './Library.module.css'

/**
 * A pattern's shape at a glance, so it can be read before it is committed to a channel
 * Rendered from `resolvePattern`, so a generated Euclidean pattern and a
 * hand-drawn one preview through exactly the same path the sequencer plays.
 */
function Thumbnail({ sequence }: { sequence: ChannelSequence }) {
  const pattern = resolvePattern(sequence)
  return (
    <div className={styles.thumb} aria-hidden>
      {pattern.map((on, index) => (
        <span
          key={index}
          className={[
            styles.thumbCell,
            on ? styles.thumbOn : '',
            index % 4 === 0 ? styles.thumbDownbeat : '',
          ]
            .filter(Boolean)
            .join(' ')}
        />
      ))}
    </div>
  )
}

/** Click-to-rename, matching how a kit tab is renamed. */
function EditableName({
  value,
  onCommit,
  label,
}: {
  value: string
  onCommit: (name: string) => void
  label: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  if (!editing) {
    return (
      <button
        type="button"
        className={styles.name}
        onClick={() => {
          setDraft(value)
          setEditing(true)
        }}
        title="Click to rename"
      >
        {value}
      </button>
    )
  }

  function commit() {
    onCommit(draft)
    setEditing(false)
  }

  return (
    <input
      ref={inputRef}
      className={styles.nameInput}
      value={draft}
      maxLength={MAX_NAME_LENGTH}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') {
          setDraft(value)
          setEditing(false)
        }
      }}
      aria-label={label}
    />
  )
}

/**
 * The shared naming row for both tiers. Opens with its text selected, so the suggested
 * name is one keystroke from being accepted and one from being replaced.
 */
function NameForm({
  placeholder,
  initial = '',
  onSave,
  onCancel,
}: {
  placeholder: string
  initial?: string
  onSave: (name: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  return (
    <div className={styles.nameForm}>
      <input
        ref={inputRef}
        className={styles.nameInput}
        value={draft}
        placeholder={placeholder}
        maxLength={MAX_NAME_LENGTH}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSave(draft)
          if (e.key === 'Escape') onCancel()
        }}
        aria-label="Name"
      />
      <Button variant="accent" small onClick={() => onSave(draft)}>
        Save
      </Button>
      <Button variant="ghost" small onClick={onCancel} aria-label="Cancel">
        <CloseIcon />
      </Button>
    </div>
  )
}

/** The four recall targets on a pattern row — a pattern loads onto any channel. */
function RecallTargets({ entry, channels }: { entry: SavedPattern; channels: Voice[] }) {
  const loadPatternInto = useSession((s) => s.loadPatternInto)
  const notify = useSession((s) => s.notify)

  return (
    <div className={styles.targets} role="group" aria-label={`Load ${entry.name} onto a channel`}>
      {channels.map((channel) => (
        <button
          key={channel.index}
          type="button"
          className={styles.target}
          title={`Load “${entry.name}” onto ${channel.name}`}
          onClick={() => {
            loadPatternInto(channel.index, patternForRecall(entry))
            notify('success', `Loaded “${entry.name}” onto ${channel.name}.`)
          }}
        >
          {channel.name}
        </button>
      ))}
    </div>
  )
}

function PatternRow({ entry, channels }: { entry: SavedPattern; channels: Voice[] }) {
  const renamePattern = useLibrary((s) => s.renamePattern)
  const deletePattern = useLibrary((s) => s.deletePattern)

  return (
    <li className={styles.row}>
      <div className={styles.rowHead}>
        <EditableName
          value={entry.name}
          onCommit={(name) => renamePattern(entry.id, name)}
          label="Pattern name"
        />
        <span
          className={styles.stamp}
          title={`Saved from ${entry.sourceChannel} at ${formatTimestamp(entry.savedAt)}`}
        >
          {entry.sourceChannel}
        </span>
        <button
          type="button"
          className={styles.delete}
          onClick={() => deletePattern(entry.id)}
          aria-label={`Delete pattern ${entry.name}`}
          title="Delete"
        >
          <CloseIcon size={11} />
        </button>
      </div>

      <span className={styles.params}>{describeSequence(entry.sequence)}</span>
      <Thumbnail sequence={entry.sequence} />
      <RecallTargets entry={entry} channels={channels} />
    </li>
  )
}

function PresetRow({
  entry,
  active,
  modified,
  readOnly,
}: {
  entry: SavedPreset
  active: boolean
  modified: boolean
  /** Factory entries ship with the app: loadable, but not renameable or deletable. */
  readOnly: boolean
}) {
  const renamePreset = useLibrary((s) => s.renamePreset)
  const deletePreset = useLibrary((s) => s.deletePreset)
  const loadPreset = useSession((s) => s.loadPreset)
  const notify = useSession((s) => s.notify)

  return (
    <li className={`${styles.row} ${active ? styles.rowActive : ''}`}>
      <div className={styles.rowHead}>
        {active && (
          <span
            className={`${styles.marker} ${modified ? styles.markerModified : ''}`}
            title={
              modified
                ? 'Loaded scene — the channels have been edited since'
                : 'Loaded scene — matches the channels'
            }
            aria-label={modified ? 'Loaded and modified' : 'Loaded'}
          />
        )}

        {readOnly ? (
          <span className={styles.name} title={entry.note}>
            {entry.name}
          </span>
        ) : (
          <EditableName
            value={entry.name}
            onCommit={(name) => renamePreset(entry.id, name)}
            label="Preset name"
          />
        )}

        <span
          className={styles.stamp}
          title={readOnly ? 'Ships with the app' : `Saved ${formatTimestamp(entry.savedAt)}`}
        >
          {entry.bpm} BPM
        </span>
        <Button
          variant="accent"
          small
          title="Overwrites all four channels, their names and the tempo"
          onClick={() => {
            const { sequences, channelNames, bpm } = presetForRecall(entry)
            // The kit records which preset it now is, as part of the same update.
            loadPreset(sequences, channelNames, bpm, entry.id)
            notify('success', `Loaded preset “${entry.name}” — 4 channels at ${bpm} BPM.`)
          }}
        >
          Load
        </Button>
        {!readOnly && (
          <button
            type="button"
            className={styles.delete}
            onClick={() => deletePreset(entry.id)}
            aria-label={`Delete preset ${entry.name}`}
            title="Delete"
          >
            <CloseIcon size={11} />
          </button>
        )}
      </div>

      {entry.note && <span className={styles.note}>{entry.note}</span>}

      {/* The four-channel summary: every slot shown, including silent ones,
          so a preset can be judged as a whole scene rather than one channel at a time.
          Labelled by SP slot, because that is the order the scene reloads in, with the
          channel name it carries beside it — for a factory preset that name is the hint
          about which sample belongs there. */}
      <ul className={styles.channels}>
        {entry.channels.map((sequence, index) => (
          <li key={index} className={styles.channelRow}>
            <span className={`${styles.channelName} ${isSilent(sequence) ? styles.channelMuted : ''}`}>
              SP{index + 1}
            </span>
            <span className={styles.savedFrom} title="Channel name this scene carries">
              {entry.channelNames[index]}
            </span>
            <span className={styles.params}>
              {isSilent(sequence) ? 'silent' : describeSequence(sequence)}
            </span>
            <Thumbnail sequence={sequence} />
          </li>
        ))}
      </ul>
    </li>
  )
}

function PatternColumn({ channels }: { channels: Voice[] }) {
  const patterns = useLibrary((s) => s.patterns)
  const pendingVoice = useLibrary((s) => s.pendingVoice)
  const beginPatternSave = useLibrary((s) => s.beginPatternSave)
  const cancelPatternSave = useLibrary((s) => s.cancelPatternSave)
  const savePattern = useLibrary((s) => s.savePattern)
  const sequences = useActiveSequences()

  const pending = pendingVoice === null ? null : channels.find((c) => c.index === pendingVoice)
  const pendingSequence = pendingVoice === null ? null : sequences[pendingVoice - 1]!

  return (
    <div className={styles.column}>
      <div className={styles.columnHead}>
        <h3 className={styles.columnTitle}>
          Patterns <span className={styles.count}>{patterns.length}</span>
        </h3>
        <span className={styles.columnHint}>Save one channel</span>
        <div className={styles.targets} role="group" aria-label="Save a channel's pattern">
          {channels.map((channel) => (
            <button
              key={channel.index}
              type="button"
              className={`${styles.target} ${pendingVoice === channel.index ? styles.targetActive : ''}`}
              onClick={() => beginPatternSave(channel.index)}
              title={`Save ${channel.name}'s current pattern to the library`}
            >
              {channel.name}
            </button>
          ))}
        </div>
      </div>

      {pending && pendingSequence && (
        <NameForm
          placeholder={`Name for ${pending.name}'s pattern`}
          // Prefilled from what the pattern was last called plus the channel it is coming
          // from, so re-saving a tweak suggests a name near the original.
          initial={defaultPatternName(pendingSequence, pending.name)}
          onSave={(name) => savePattern(name, pending.index, pending.name, pendingSequence)}
          onCancel={cancelPatternSave}
        />
      )}

      {patterns.length === 0 ? (
        <p className={styles.empty}>
          No saved patterns. Pick a channel above to store its current pattern — it can then be
          recalled onto any channel.
        </p>
      ) : (
        <ul className={styles.list}>
          {patterns.map((entry) => (
            <PatternRow key={entry.id} entry={entry} channels={channels} />
          ))}
        </ul>
      )}
    </div>
  )
}

type Bank = 'factory' | 'user'

function PresetColumn({ channels }: { channels: Voice[] }) {
  const userPresets = useLibrary((s) => s.presets)
  const savePreset = useLibrary((s) => s.savePreset)
  const activePresetId = useActivePresetId()
  const sequences = useActiveSequences()
  const bpm = useActiveBpm()
  const clearSequences = useSession((s) => s.clearSequences)
  const notify = useSession((s) => s.notify)

  const [bank, setBank] = useState<Bank>('factory')
  const [naming, setNaming] = useState(false)

  // Slot order throughout: a scene is saved, previewed and reloaded top to bottom.
  const slotSequences = channels.map((channel) => sequences[channel.index - 1]!)
  const channelNames = channels.map((channel) => channel.name)

  // The loaded scene can come from either bank, so the status line searches both.
  const activePreset =
    [...FACTORY_PRESETS, ...userPresets].find((p) => p.id === activePresetId) ?? null
  const modified = activePreset ? !presetMatchesLive(activePreset, slotSequences, bpm) : false

  const shown = bank === 'factory' ? FACTORY_PRESETS : userPresets

  return (
    <div className={styles.column}>
      <div className={styles.columnHead}>
        <h3 className={styles.columnTitle}>Presets</h3>

        {/* Factory ships with the app and is read-only; everything the user saves lands in
            User. Splitting them means "Save scene" can never overwrite a shipped groove. */}
        <div className={styles.banks} role="tablist" aria-label="Preset bank">
          {(['factory', 'user'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={bank === id}
              className={`${styles.bank} ${bank === id ? styles.bankActive : ''}`}
              onClick={() => setBank(id)}
              title={
                id === 'factory'
                  ? 'Grooves that ship with the app — load them, but they cannot be edited'
                  : 'Scenes you have saved in this browser'
              }
            >
              {id === 'factory' ? 'Factory' : 'User'}
              <span className={styles.count}>
                {id === 'factory' ? FACTORY_PRESETS.length : userPresets.length}
              </span>
            </button>
          ))}
        </div>

        {/* What the channels currently are, as a scene: the loaded preset's name, whether
            it still matches, or that this scene has never been saved at all. */}
        <span
          className={`${styles.status} ${activePreset ? '' : styles.statusUnsaved}`}
          title={
            activePreset
              ? modified
                ? `The channels no longer match “${activePreset.name}” — save to the User bank to keep this version`
                : `The channels match “${activePreset.name}”`
              : 'This scene has never been saved to the library'
          }
        >
          {activePreset ? (
            <>
              <span className={`${styles.marker} ${modified ? styles.markerModified : ''}`} />
              {activePreset.name}
              {modified && <span className={styles.statusSuffix}>modified</span>}
            </>
          ) : (
            'Unsaved'
          )}
        </span>

        <Button
          small
          onClick={() => {
            // Saving always targets User, so switch there rather than saving into a bank
            // the new entry would not appear in.
            setBank('user')
            setNaming(true)
          }}
          title="Save all four channels, their names and the tempo to the User bank"
        >
          <SaveIcon />
          Save scene
        </Button>
        <Button
          variant="ghost"
          small
          title="Clear all four channels to build a scene from scratch"
          onClick={() => {
            // clearSequences also drops the kit's preset link — cleared channels are not
            // any stored scene any more.
            clearSequences()
            notify('info', 'All four channels cleared.')
          }}
        >
          <PlusIcon />
          New
        </Button>
      </div>

      {naming && (
        <NameForm
          placeholder="Name for this scene"
          initial={activePreset?.name ?? ''}
          onSave={(name) => {
            savePreset(name, slotSequences, channelNames, bpm)
            setNaming(false)
          }}
          onCancel={() => setNaming(false)}
        />
      )}

      {shown.length === 0 ? (
        <p className={styles.empty}>
          Nothing in the User bank yet. “Save scene” stores all four channel patterns, their names
          and the tempo together — or start from a Factory groove and save your edit here.
        </p>
      ) : (
        <ul className={styles.list}>
          {shown.map((entry) => (
            <PresetRow
              key={entry.id}
              entry={entry}
              active={entry.id === activePresetId}
              modified={modified}
              readOnly={bank === 'factory'}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The two-tier library.
 *
 * Tier 2 holds single channels and recalls onto any channel; Tier 3 holds whole
 * four-channel scenes with their tempo. Both are global and hold parameters only — no
 * audio, no kit data — which is what lets a groove move between kits and sessions.
 */
export function Library() {
  const hydrate = useLibrary((s) => s.hydrate)
  const kit = useActiveKit()
  const channels = channelsInSlotOrder(kit)

  useEffect(() => {
    hydrate()
  }, [hydrate])

  return (
    <section className={styles.library} aria-label="Library">
      <header className={styles.header}>
        <h2 className={styles.title}>Library</h2>
        <span className={styles.subtitle}>
          Saved in this browser, shared across every kit — patterns and tempo only, never audio
        </span>
      </header>

      <div className={styles.columns}>
        <PatternColumn channels={channels} />
        <PresetColumn channels={channels} />
      </div>
    </section>
  )
}
