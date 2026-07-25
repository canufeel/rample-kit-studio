import { useEffect, useState } from 'react'
import { isRunning, onTransport, startTransport, stopTransport } from '~/audio/scheduler'
import { MAX_BPM, MIN_BPM, isPolymetric } from '~/domain/sequence'
import { useActiveBpm, useActiveSequences, useSession } from '~/store/useSession'
import { Button } from './ui/Controls'
import { Fader } from './ui/Fader'
import { PlayIcon, StopIcon } from './ui/Icons'
import styles from './Transport.module.css'

/**
 * Global transport: one clock, four channels derived from it.
 *
 * All of this is preview-only. The Rample has no sequencer — it is triggered by external
 * gate/CV or MIDI — so nothing here is exported. It exists to simulate that external
 * triggering so a kit can be judged as a kit rather than as four isolated samples.
 */
export function Transport() {
  const bpm = useActiveBpm()
  const masterVolume = useSession((s) => s.master.volume)
  const keepAlive = useSession((s) => s.keepAlive)
  const sequences = useActiveSequences()
  const setBpm = useSession((s) => s.setBpm)
  const setMasterVolume = useSession((s) => s.setMasterVolume)
  const setKeepAlive = useSession((s) => s.setKeepAlive)
  const randomiseAll = useSession((s) => s.randomiseAll)
  const notify = useSession((s) => s.notify)

  const [playing, setPlaying] = useState(false)
  const [bpmDraft, setBpmDraft] = useState(String(bpm))

  useEffect(() => onTransport((snapshot) => setPlaying(snapshot.playing)), [])
  useEffect(() => setBpmDraft(String(bpm)), [bpm])

  // Stop the clock if the component ever unmounts, so a stray interval can't outlive it.
  useEffect(() => () => stopTransport(), [])

  async function toggle() {
    if (isRunning()) {
      stopTransport()
      return
    }
    const { missing } = await startTransport()
    if (missing > 0) {
      notify(
        'warning',
        `${missing} sample${missing === 1 ? '' : 's'} could not be decoded and will be skipped while the sequencer runs.`,
      )
    }
  }

  const polymetric = isPolymetric(sequences)

  return (
    <section className={styles.transport} aria-label="Transport">
      <div className={styles.group}>
        <button
          type="button"
          className={`${styles.playButton} ${playing ? styles.playing : ''}`}
          onClick={() => void toggle()}
          aria-label={playing ? 'Stop' : 'Play'}
          title={playing ? 'Stop (space)' : 'Play (space)'}
        >
          {playing ? <StopIcon size={16} /> : <PlayIcon size={16} />}
        </button>

        <span className={styles.label}>BPM</span>
        <input
          className={styles.bpmInput}
          value={bpmDraft}
          inputMode="numeric"
          onChange={(e) => setBpmDraft(e.target.value)}
          // Committed on blur rather than per keystroke, so typing "9" on the way to
          // "90" doesn't briefly clamp the tempo to the minimum.
          onBlur={() => setBpm(Number(bpmDraft))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          aria-label={`Tempo, ${MIN_BPM} to ${MAX_BPM} BPM`}
        />
      </div>

      <div className={`${styles.group} ${styles.master}`}>
        <Fader label="Master" value={masterVolume} onChange={setMasterVolume} />
      </div>

      <Button small onClick={randomiseAll} title="Roll all four channels at their own densities">
        Randomise all
      </Button>

      <span className={styles.spacer} />

      {polymetric && (
        <span className={`${styles.hint} ${styles.polymeter}`}>
          Polymeter — channel lengths differ, so the loop phases rather than repeating.
        </span>
      )}

      <label className={styles.toggle} title="Keeps an inaudible signal on the output so Bluetooth links never idle and swallow a sample's attack. Harmless but unnecessary on wired output.">
        <input
          type="checkbox"
          checked={keepAlive}
          onChange={(e) => setKeepAlive(e.target.checked)}
        />
        Bluetooth keep-alive
      </label>
    </section>
  )
}
