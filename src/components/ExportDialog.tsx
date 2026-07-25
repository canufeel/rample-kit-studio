import { useEffect, useMemo, useState } from 'react'
import { planExport, planExportAll } from '~/export/buildKit'
import type { ExportPlan } from '~/export/buildKit'
import { ExportCancelled, downloadZip, supportsDirectoryWrite, writeToDirectory } from '~/export/writers'
import { formatSize } from '~/lib/format'
import { useSession } from '~/store/useSession'
import { Button, Segmented } from './ui/Controls'
import { CloseIcon, FolderIcon, DownloadIcon, WarningIcon } from './ui/Icons'
import styles from './ExportDialog.module.css'

type Scope = 'active' | 'all'

/**
 * Shows exactly what will land on the card before anything is written.
 *
 * The Rample gives no feedback beyond refusing to open a kit, so a mistake here costs a
 * round trip to the hardware to discover. Naming every file, and every sample that is
 * *not* making it, turns that into something checkable in the browser.
 */
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const kits = useSession((s) => s.kits)
  const activeKitId = useSession((s) => s.activeKitId)
  const notify = useSession((s) => s.notify)

  const [scope, setScope] = useState<Scope>('active')
  const [plans, setPlans] = useState<ExportPlan[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [override, setOverride] = useState(false)

  const activeKit = useMemo(
    () => kits.find((k) => k.id === activeKitId) ?? kits[0]!,
    [kits, activeKitId],
  )

  useEffect(() => {
    let cancelled = false
    setPlans(null)
    const build = scope === 'all' ? planExportAll(kits) : planExport(activeKit).then((p) => [p])
    build
      .then((result) => {
        if (!cancelled) setPlans(result)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        notify('error', error instanceof Error ? error.message : 'Could not prepare the export')
        setPlans([])
      })
    return () => {
      cancelled = true
    }
  }, [scope, kits, activeKit, notify])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const blocking = plans?.flatMap((p) => p.warnings).filter((w) => w.blocking) ?? []
  const advisory = plans?.flatMap((p) => p.warnings).filter((w) => !w.blocking) ?? []
  const totalFiles = plans?.reduce((sum, p) => sum + p.entries.length, 0) ?? 0
  const totalBytes =
    plans?.reduce((sum, p) => sum + p.entries.reduce((s, e) => s + e.bytes.byteLength, 0), 0) ?? 0

  const isBlocked = blocking.length > 0 && !override
  const canExport = Boolean(plans) && totalFiles > 0 && !isBlocked && !busy

  async function run(writer: 'zip' | 'directory') {
    if (!plans) return
    setBusy(true)
    try {
      if (writer === 'zip') {
        const name = scope === 'all' ? 'rample-kits.zip' : `${activeKit.code}.zip`
        await downloadZip(plans, name)
        notify('success', `Exported ${totalFiles} file${totalFiles === 1 ? '' : 's'} as ${name}.`)
      } else {
        const written = await writeToDirectory(plans)
        notify('success', `Wrote ${written} file${written === 1 ? '' : 's'} to the chosen folder.`)
      }
      onClose()
    } catch (error) {
      if (error instanceof ExportCancelled) return
      notify('error', error instanceof Error ? error.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.backdrop} onClick={onClose} role="presentation">
      <div
        className={styles.dialog}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Export kits"
      >
        <header className={styles.header}>
          <h2 className={styles.title}>Export</h2>
          <div className={styles.scopeRow}>
            <Segmented
              label="Export scope"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'active', label: `This kit (${activeKit.code})` },
                { value: 'all', label: `All kits (${kits.length})` },
              ]}
            />
            <Button variant="ghost" small onClick={onClose} aria-label="Close">
              <CloseIcon />
            </Button>
          </div>
        </header>

        <div className={styles.body}>
          {blocking.map((warning) => (
            <div key={`${warning.code}-${warning.voice}`} className={styles.blocker}>
              <WarningIcon className={styles.icon} />
              <span>{warning.message}</span>
            </div>
          ))}

          {advisory.map((warning) => (
            <div key={`${warning.code}-${warning.voice}`} className={styles.warning}>
              <WarningIcon className={styles.icon} />
              <span>{warning.message}</span>
            </div>
          ))}

          {!plans && <p className={styles.empty}>Preparing…</p>}

          {plans?.map((plan) => (
            <div key={plan.kitCode} className={styles.kitBlock}>
              <div className={styles.kitHeader}>
                <FolderIcon />
                {plan.kitCode}/
                <span className={styles.kitCount}>
                  {plan.entries.length} file{plan.entries.length === 1 ? '' : 's'}
                </span>
              </div>

              {plan.entries.length > 0 ? (
                <ul className={styles.fileList}>
                  {plan.entries.map((entry) => (
                    <li key={entry.sampleId} className={styles.file}>
                      <span className={styles.fileName}>{entry.filename}</span>
                      <span className={styles.fileSource}>← {entry.sourceName}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.empty}>Nothing valid to export in this kit.</p>
              )}

              {plan.excluded.length > 0 && (
                <div className={styles.excluded}>
                  Not exported:{' '}
                  {plan.excluded.map((item, i) => (
                    <span key={`${item.sourceName}-${i}`}>
                      {i > 0 && ', '}
                      <span
                        className={
                          item.reason === 'invalid' ? styles.excludedItem : styles.excludedQueued
                        }
                        title={
                          item.reason === 'invalid'
                            ? `${item.channelName} → SP${item.slot}: does not match the voice format — convert it first`
                            : `${item.channelName} → SP${item.slot}: past the device's 12-layer limit`
                        }
                      >
                        {item.sourceName}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <footer className={styles.footer}>
          {blocking.length > 0 && (
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={override}
                onChange={(e) => setOverride(e.target.checked)}
              />
              Export anyway
            </label>
          )}
          <span className={styles.footerSpacer}>
            {totalFiles > 0 && (
              <span className={styles.fileSource}>
                {totalFiles} file{totalFiles === 1 ? '' : 's'} · {formatSize(totalBytes)}
              </span>
            )}
          </span>
          {supportsDirectoryWrite() && (
            <Button
              disabled={!canExport}
              onClick={() => void run('directory')}
              title="Write kit folders straight into a folder — point it at your SD card root"
            >
              <FolderIcon />
              Write to folder
            </Button>
          )}
          <Button variant="primary" disabled={!canExport} onClick={() => void run('zip')}>
            <DownloadIcon />
            {busy ? 'Exporting…' : 'Download ZIP'}
          </Button>
        </footer>
      </div>
    </div>
  )
}
