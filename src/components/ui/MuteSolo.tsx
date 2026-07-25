import type { Kit, Voice } from '~/domain/types'
import { isSoloing } from '~/domain/voice'
import { useSession } from '~/store/useSession'
import styles from './MuteSolo.module.css'

/**
 * Per-channel mute and solo, shared by the channel panel and the sequencer row.
 *
 * Both places show the same pair rather than one being the "real" one, because both are
 * places you are already looking at a channel. Solo wins over mute, and any solo silences
 * every channel that is not soloed — so a channel that is being silenced *by someone
 * else's* solo is dimmed, which is the only way to explain why an unmuted channel is quiet.
 */
export function MuteSolo({ kit, voice, size = 'md' }: { kit: Kit; voice: Voice; size?: 'sm' | 'md' }) {
  const toggleMute = useSession((s) => s.toggleMute)
  const toggleSolo = useSession((s) => s.toggleSolo)

  const soloing = isSoloing(kit)
  const silencedByOthers = soloing && !voice.soloed
  // Muted *and* soloed: solo wins, so the channel sounds. Without saying so, a lit M on a
  // channel you can hear reads as the mute being broken.
  const muteOverridden = voice.muted && voice.soloed

  const classes = (active: boolean, activeClass: string) =>
    [styles.button, size === 'sm' ? styles.sm : '', active ? activeClass : '']
      .filter(Boolean)
      .join(' ')

  return (
    <div className={styles.group} role="group" aria-label={`${voice.name} mute and solo`}>
      <button
        type="button"
        className={[
          classes(voice.muted, styles.muted!),
          silencedByOthers ? styles.dimmed : '',
          muteOverridden ? styles.overridden : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={() => toggleMute(voice.index)}
        aria-pressed={voice.muted}
        title={
          muteOverridden
            ? `${voice.name} is muted, but its own solo overrides that — it is sounding. Release the solo to hear the mute.`
            : voice.muted
              ? `${voice.name} is muted — the sequencer will not sound it. Auditioning a row still works.`
              : `Mute ${voice.name} in the sequencer`
        }
      >
        M
      </button>
      <button
        type="button"
        className={classes(voice.soloed, styles.soloed!)}
        onClick={() => toggleSolo(voice.index)}
        aria-pressed={voice.soloed}
        title={
          voice.soloed
            ? `${voice.name} is soloed. Solo more channels to hear them together.`
            : `Solo ${voice.name}${soloing ? ' as well' : ''}`
        }
      >
        S
      </button>
    </div>
  )
}
