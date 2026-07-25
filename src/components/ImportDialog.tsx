import { useEffect, useMemo, useState } from 'react'
import { VOICE_INDICES } from '~/domain/device'
import { countLayers } from '~/domain/cardImport'
import { MAX_KITS_PER_SESSION } from '~/domain/limits'
import type { CardPlan, SkipReason } from '~/domain/cardImport'
import { formatSize } from '~/lib/format'
import { useSession } from '~/store/useSession'
import { Button } from './ui/Controls'
import { CloseIcon, FolderIcon, WarningIcon } from './ui/Icons'
import styles from './ImportDialog.module.css'

const SKIP_LABEL: Record<SkipReason, string> = {
  notAudio: 'not audio',
  notInKitFolder: 'not inside a kit folder',
  noVoiceDigit: 'no leading voice digit (1–4)',
}

/**
 * Shows what a picked card folder would become before any of it is imported.
 *
 * Worth a confirmation step rather than importing on pick: a full factory card is 184 kits
 * and several hundred megabytes, and the numbers here are the only warning the user gets
 * that they picked the card root when they meant one kit.
 */
export function ImportDialog({ plan, onClose }: { plan: CardPlan<File>; onClose: () => void }) {
  const importCard = useSession((s) => s.importCard)
  const notify = useSession((s) => s.notify)
  const kits = useSession((s) => s.kits)

  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const layers = countLayers(plan)
  const bytes = useMemo(
    () => plan.kits.reduce((sum, kit) => sum + kit.layers.reduce((s, l) => s + l.file.size, 0), 0),
    [plan],
  )

  // Which incoming codes clash with a kit that already has samples, so the summary can warn
  // before the import rather than reporting it afterwards.
  const willRename = useMemo(() => {
    const occupied = new Set(
      kits.filter((k) => Object.keys(k.samples).length > 0).map((k) => k.code),
    )
    return plan.kits.filter((k) => occupied.has(k.code)).map((k) => k.code)
  }, [plan, kits])

  const skippedByReason = useMemo(() => {
    const counts = new Map<SkipReason, number>()
    for (const item of plan.skipped) counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1)
    return [...counts.entries()]
  }, [plan])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Not while running: a half-finished import would leave the dialog gone and the kits
      // arriving anyway, which reads as a glitch.
      if (e.key === 'Escape' && !progress) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, progress])

  async function run() {
    setProgress({ done: 0, total: layers })
    try {
      const result = await importCard(plan, (done, total) => setProgress({ done, total }))
      notify(
        'success',
        `Imported ${result.kits} kit${result.kits === 1 ? '' : 's'} and ${result.layers} sample${result.layers === 1 ? '' : 's'}.`,
      )
      if (result.renamed.length > 0) {
        notify(
          'info',
          `Renamed to avoid overwriting kits that already have samples: ${result.renamed
            .map((r) => `${r.from} → ${r.to}`)
            .join(', ')}.`,
        )
      }
      if (result.skipped.length > 0) {
        notify(
          'warning',
          `${result.skipped.length} kit${result.skipped.length === 1 ? '' : 's'} did not fit — a session holds at most ${MAX_KITS_PER_SESSION}. Skipped: ${result.skipped.slice(0, 4).join(', ')}${result.skipped.length > 4 ? '…' : ''}`,
        )
      }
      if (result.failed.length > 0) {
        notify(
          'warning',
          `${result.failed.length} file${result.failed.length === 1 ? '' : 's'} could not be read: ${result.failed.slice(0, 3).join(', ')}${result.failed.length > 3 ? '…' : ''}`,
        )
      }
      onClose()
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'Could not import the card')
      setProgress(null)
    }
  }

  const percent = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0

  return (
    <div className={styles.backdrop} onClick={progress ? undefined : onClose} role="presentation">
      <div
        className={styles.dialog}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Import kits from a card"
      >
        <header className={styles.header}>
          <h2 className={styles.title}>Import kits</h2>
          <span className={styles.headerSpacer} />
          {!progress && (
            <Button variant="ghost" small onClick={onClose} aria-label="Close">
              <CloseIcon />
            </Button>
          )}
        </header>

        <div className={styles.body}>
          {plan.kits.length === 0 ? (
            <div className={styles.blocker}>
              <WarningIcon className={styles.icon} />
              <span>
                No kit folders in that selection. A kit folder is named like <code>A0</code> or{' '}
                <code>B7</code> and holds .wav files whose first character is the voice number.
              </span>
            </div>
          ) : (
            <p className={styles.summary}>
              <strong>{plan.kits.length}</strong> kit{plan.kits.length === 1 ? '' : 's'} ·{' '}
              <strong>{layers}</strong> sample{layers === 1 ? '' : 's'} · {formatSize(bytes)}
            </p>
          )}

          {willRename.length > 0 && (
            <div className={styles.warning}>
              <WarningIcon className={styles.icon} />
              <span>
                {willRename.join(', ')} {willRename.length === 1 ? 'is' : 'are'} already open with
                samples in {willRename.length === 1 ? 'it' : 'them'}, so the incoming{' '}
                {willRename.length === 1 ? 'kit' : 'kits'} will be given free codes instead. Nothing
                open is overwritten.
              </span>
            </div>
          )}

          {plan.kits.length > 0 && (
            <ul className={styles.kitList}>
              {plan.kits.map((kit) => {
                const perVoice = VOICE_INDICES.map(
                  (voice) => kit.layers.filter((l) => l.voice === voice).length,
                )
                return (
                  <li key={kit.code} className={styles.kitRow}>
                    <FolderIcon />
                    <span className={styles.kitCode}>{kit.code}</span>
                    <span className={styles.kitVoices}>
                      {perVoice.map((count, i) => (
                        <span key={i} className={count === 0 ? styles.voiceEmpty : undefined}>
                          SP{i + 1} {count}
                        </span>
                      ))}
                    </span>
                    <span className={styles.kitCount}>{kit.layers.length}</span>
                  </li>
                )
              })}
            </ul>
          )}

          {skippedByReason.length > 0 && (
            <p className={styles.skipped}>
              Skipped:{' '}
              {skippedByReason.map(([reason, count], i) => (
                <span key={reason}>
                  {i > 0 && ' · '}
                  {count} {SKIP_LABEL[reason]}
                </span>
              ))}
            </p>
          )}
        </div>

        <footer className={styles.footer}>
          {progress ? (
            <>
              <div className={styles.progressTrack} role="progressbar" aria-valuenow={Math.round(percent)}>
                <div className={styles.progressFill} style={{ width: `${percent}%` }} />
              </div>
              <span className={styles.progressLabel}>
                {progress.done} / {progress.total}
              </span>
            </>
          ) : (
            <>
              <span className={styles.footerSpacer} />
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" disabled={plan.kits.length === 0} onClick={() => void run()}>
                <FolderIcon />
                Import {plan.kits.length > 0 ? `${plan.kits.length} kit${plan.kits.length === 1 ? '' : 's'}` : ''}
              </Button>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}
