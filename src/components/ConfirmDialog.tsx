import { useEffect, useRef } from 'react'
import { Button } from './ui/Controls'
import { WarningIcon } from './ui/Icons'
import styles from './ConfirmDialog.module.css'

/**
 * A blocking confirmation, used only where an action cannot be undone from the notice bar.
 *
 * Deleting a single row offers an undo instead, because that is a frequent editing move and
 * a dialog on each one would be exhausting. This is for the two actions that are neither
 * frequent nor cheap: discarding a whole kit, and resetting the session.
 *
 * The destructive button is *not* focused on open. Confirming should take a deliberate move
 * — with focus on Cancel, a stray Return keeps everything.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className={styles.backdrop} onClick={onCancel} role="presentation">
      <div
        className={styles.dialog}
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
      >
        <div className={styles.head}>
          <WarningIcon className={styles.icon} size={16} />
          <h2 className={styles.title} id="confirm-title">
            {title}
          </h2>
        </div>

        <p className={styles.body} id="confirm-body">
          {body}
        </p>

        <div className={styles.actions}>
          <Button ref={cancelRef} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
