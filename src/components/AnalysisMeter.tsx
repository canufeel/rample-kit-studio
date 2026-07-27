import { useAnalysisProgress } from '~/store/useAnalysis'
import styles from './AnalysisMeter.module.css'

/**
 * Progress while samples are being measured.
 *
 * Worth showing because the work is invisible and can be long: a card import queues two
 * thousand samples and takes the better part of a minute, during which type badges and
 * character lines fill in a few rows at a time with no explanation. Without this the app
 * looks like it is guessing at random and then correcting itself.
 *
 * Nothing here is blocking. The queue runs in the background and everything it feeds
 * degrades to "not known yet" rather than to an error, so this is a status line and not a
 * progress dialog. `aria-live` is off for the same reason — a screen reader announcing
 * every step of a two-thousand-file sweep would be unusable.
 */
export function AnalysisMeter() {
  const progress = useAnalysisProgress()
  if (!progress) return null

  const percent = Math.round((progress.done / progress.total) * 100)

  return (
    <span
      className={styles.meter}
      role="status"
      aria-live="off"
      title={`Working out what each sample sounds like. ${progress.done} of ${progress.total} done — nothing is blocked while this runs.`}
    >
      <span className={styles.bar} aria-hidden>
        <span className={styles.fill} style={{ width: `${percent}%` }} />
      </span>
      <span className={styles.text}>
        analysing {progress.done}/{progress.total}
      </span>
    </span>
  )
}
