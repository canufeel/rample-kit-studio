import { useEffect, useState } from 'react'
import { storageLevel } from '~/domain/limits'
import { formatSize } from '~/lib/format'
import { estimateUsage } from '~/storage/audioStore'
import { useSession } from '~/store/useSession'
import styles from './StorageMeter.module.css'

/**
 * How much of the browser's storage quota this origin is using.
 *
 * Worth showing because the failure it predicts is otherwise baffling: an import that dies
 * partway with a per-file error, at a moment the user had no reason to expect a limit. A
 * card of samples is hundreds of megabytes, and nothing else in the UI hints at a ceiling.
 *
 * The figure is the whole origin's usage as the browser reports it, not just our audio —
 * that is what the quota is actually measured against, so it is the honest number even
 * though it includes a little overhead we did not put there.
 */
export function StorageMeter() {
  const kits = useSession((s) => s.kits)
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    // Debounced: a card import churns the kit list continuously, and `estimate()` is not
    // free. One reading once things settle is all this needs.
    const timer = setTimeout(() => {
      void estimateUsage().then((result) => {
        if (!cancelled) setEstimate(result)
      })
    }, 800)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [kits])

  // Firefox and Safari have both, at times, withheld `storage.estimate`. No reading is a
  // reason to show nothing, not to show a zero.
  if (!estimate || estimate.quota <= 0) return null

  const fraction = estimate.usage / estimate.quota
  const level = storageLevel(fraction)
  const percent = Math.min(100, Math.round(fraction * 100))

  return (
    <span
      className={`${styles.meter} ${styles[level]}`}
      title={
        level === 'ok'
          ? `${formatSize(estimate.usage)} of about ${formatSize(estimate.quota)} of browser storage used by this site.`
          : `${formatSize(estimate.usage)} of about ${formatSize(estimate.quota)} used. Deleting kits or samples and then saving reclaims space.`
      }
    >
      <span className={styles.bar} aria-hidden>
        <span className={styles.fill} style={{ width: `${percent}%` }} />
      </span>
      <span className={styles.text}>
        {formatSize(estimate.usage)} / {formatSize(estimate.quota)}
        <span className={styles.percent}>{percent}%</span>
      </span>
    </span>
  )
}
