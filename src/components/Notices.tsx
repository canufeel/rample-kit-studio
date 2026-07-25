import { useEffect } from 'react'
import { useSession } from '~/store/useSession'
import { CloseIcon } from './ui/Icons'
import styles from './Notices.module.css'

/** Errors stay until dismissed — they usually name a file the user needs to act on. */
const AUTO_DISMISS_MS = 6000

export function Notices() {
  const notices = useSession((s) => s.notices)
  const dismiss = useSession((s) => s.dismissNotice)

  useEffect(() => {
    const timers = notices
      .filter((notice) => notice.kind !== 'error')
      .map((notice) => setTimeout(() => dismiss(notice.id), AUTO_DISMISS_MS))
    return () => timers.forEach(clearTimeout)
  }, [notices, dismiss])

  if (notices.length === 0) return null

  return (
    <div className={styles.stack} role="log" aria-live="polite">
      {notices.map((notice) => (
        <div key={notice.id} className={`${styles.notice} ${styles[notice.kind]}`}>
          <span className={styles.message}>{notice.message}</span>
          {/* The notice's own lifetime is the undo window: dismissing it — by hand or by
              the auto-dismiss timer — is what withdraws the offer, so there is no second
              deadline to keep in step with this one. */}
          {notice.action && (
            <button
              type="button"
              className={styles.action}
              onClick={() => {
                notice.action?.run()
                dismiss(notice.id)
              }}
            >
              {notice.action.label}
            </button>
          )}
          <button
            type="button"
            className={styles.dismiss}
            onClick={() => dismiss(notice.id)}
            aria-label="Dismiss"
          >
            <CloseIcon size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
