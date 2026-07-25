import { useEffect, useRef, useState } from 'react'
import type { Voice } from '~/domain/types'
import { MAX_CHANNEL_NAME_LENGTH } from '~/domain/voice'
import { useSession } from '~/store/useSession'
import styles from './ChannelName.module.css'

/**
 * Click-to-rename a channel, matching how a kit tab is renamed.
 *
 * Shared by the channel panel and the sequencer row so a channel can be renamed wherever
 * the user is looking at it — the two views are the same channel, and having only one of
 * them editable is arbitrary.
 *
 * The name is cosmetic and never exported, so unlike the kit code it needs no validation
 * beyond trimming; an empty name falls back to the CH default.
 */
export function ChannelName({ voice, size = 'md' }: { voice: Voice; size?: 'sm' | 'md' }) {
  const renameChannel = useSession((s) => s.renameChannel)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(voice.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const sizeClass = size === 'sm' ? styles.sm! : ''

  if (editing) {
    const commit = () => {
      renameChannel(voice.index, draft)
      setEditing(false)
    }
    return (
      <input
        ref={inputRef}
        className={`${styles.input} ${sizeClass}`}
        value={draft}
        maxLength={MAX_CHANNEL_NAME_LENGTH}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          // Stops here rather than reaching the global 1-4 / space triggers.
          e.stopPropagation()
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            setDraft(voice.name)
            setEditing(false)
          }
        }}
        aria-label={`Rename channel ${voice.name}`}
      />
    )
  }

  return (
    <button
      type="button"
      className={`${styles.label} ${sizeClass}`}
      onClick={() => {
        setDraft(voice.name)
        setEditing(true)
      }}
      title={`${voice.name} — click to rename. Channel names are never exported.`}
    >
      {voice.name}
    </button>
  )
}
