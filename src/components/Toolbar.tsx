import { useEffect, useRef, useState } from 'react'
import { kitCodeErrorMessage } from '~/domain/kitCode'
import type { Kit } from '~/domain/types'
import { formatTimestamp } from '~/lib/format'
import { planCardImport } from '~/domain/cardImport'
import { MAX_KITS_PER_SESSION } from '~/domain/limits'
import type { CardPlan } from '~/domain/cardImport'
import { NotAProjectFile, exportProject, importProject } from '~/storage/projectFile'
import { useLibrary } from '~/store/useLibrary'
import { useSession } from '~/store/useSession'
import { ConfirmDialog } from './ConfirmDialog'
import { ImportDialog } from './ImportDialog'
import { Button } from './ui/Controls'
import { CloseIcon, DownloadIcon, FolderIcon, PlusIcon, SaveIcon } from './ui/Icons'
import styles from './Toolbar.module.css'

/**
 * A kit tab. The label is not decoration — it is literally the folder name written to
 * the SD card, so editing it validates against the device's `[A-Z][0-99]` rule and
 * against the other tabs before it's accepted.
 */
function KitTab({ kit, active }: { kit: Kit; active: boolean }) {
  const setActiveKit = useSession((s) => s.setActiveKit)
  const removeKit = useSession((s) => s.removeKit)
  const renameKit = useSession((s) => s.renameKit)
  const kitCount = useSession((s) => s.kits.length)

  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [draft, setDraft] = useState(kit.code)
  const [error, setError] = useState<string | null>(null)
  const sampleCount = Object.keys(kit.samples).length
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function commit() {
    const result = renameKit(kit.id, draft)
    if (result) {
      setError(kitCodeErrorMessage(result))
      return
    }
    setError(null)
    setEditing(false)
  }

  function cancel() {
    setDraft(kit.code)
    setError(null)
    setEditing(false)
  }

  return (
    <div className={`${styles.tab} ${active ? styles.tabActive : ''}`}>
      {editing ? (
        <input
          ref={inputRef}
          className={`${styles.tabInput} ${error ? styles.tabInputError : ''}`}
          value={draft}
          maxLength={3}
          onChange={(e) => {
            setDraft(e.target.value.toUpperCase())
            setError(null)
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') cancel()
          }}
          aria-label="Kit code"
          aria-invalid={Boolean(error)}
        />
      ) : (
        <button
          type="button"
          className={styles.tabLabel}
          onClick={() => (active ? setEditing(true) : setActiveKit(kit.id))}
          title={active ? 'Click to rename — this is the SD card folder name' : `Switch to ${kit.code}`}
        >
          {kit.code}
        </button>
      )}

      {kitCount > 1 && (
        <button
          type="button"
          className={styles.tabClose}
          onClick={() => setConfirming(true)}
          aria-label={`Delete kit ${kit.code}`}
        >
          <CloseIcon size={11} />
        </button>
      )}

      {confirming && (
        <ConfirmDialog
          title={`Delete kit ${kit.code}?`}
          body={
            sampleCount === 0
              ? `${kit.code} is empty, so nothing will be lost.`
              : `${kit.code} holds ${sampleCount} sample${sampleCount === 1 ? '' : 's'} and its patterns. ` +
                'This cannot be undone from here.'
          }
          confirmLabel="Delete kit"
          onConfirm={() => {
            setConfirming(false)
            removeKit(kit.id)
          }}
          onCancel={() => setConfirming(false)}
        />
      )}

      {error && <span className={styles.codeError}>{error}</span>}
    </div>
  )
}

/**
 * The portable project file — a .zip holding the manifest plus every sample's WAV.
 *
 * Lives here rather than in a store action because it is the one operation that spans both
 * stores: the session owns the kits, the library owns the patterns, and neither should
 * import the other just to move a file across.
 */
function ProjectFileControls() {
  const notify = useSession((s) => s.notify)
  const replaceSession = useSession((s) => s.replaceSession)
  const replaceLibrary = useLibrary((s) => s.replaceLibrary)
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  async function doExport() {
    setBusy(true)
    try {
      const { kits, activeKitId, transport, master, keepAlive } = useSession.getState()
      const { patterns, presets } = useLibrary.getState()
      const result = await exportProject(
        { kits, activeKitId, transport, master, keepAlive },
        { patterns, presets },
      )
      notify('success', `Saved ${result.filename} — ${result.samples} sample${result.samples === 1 ? '' : 's'} included.`)
      if (result.missing.length > 0) {
        notify(
          'warning',
          `${result.missing.length} sample${result.missing.length === 1 ? '' : 's'} had no stored audio and could not be included.`,
        )
      }
    } catch (error) {
      notify('error', error instanceof Error ? error.message : 'Could not write the project file')
    } finally {
      setBusy(false)
    }
  }

  async function doImport(file: File) {
    setBusy(true)
    try {
      const result = await importProject(file)
      // Library first: the session swap re-renders everything, and arriving at a panel
      // whose entries land a tick later reads as a glitch.
      replaceLibrary(result.library.patterns, result.library.presets)
      replaceSession(result.session)
      notify('success', `Imported ${file.name}.`)
      if (result.missingAudio.length > 0) {
        notify(
          'warning',
          `Dropped ${result.missingAudio.length} sample${result.missingAudio.length === 1 ? '' : 's'} with no audio in the archive: ${result.missingAudio.slice(0, 3).join(', ')}${result.missingAudio.length > 3 ? '…' : ''}`,
        )
      }
    } catch (error) {
      const message =
        error instanceof NotAProjectFile
          ? error.message
          : error instanceof Error
            ? error.message
            : 'Could not read the project file'
      notify('error', message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        small
        disabled={busy}
        onClick={() => void doExport()}
        title="Download this whole project — kits, samples, sequences and library — as a portable .zip you can reopen here"
      >
        <DownloadIcon />
        Download
      </Button>
      <Button
        variant="ghost"
        small
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        title="Open a project .zip — replaces the current session, and merges its library into yours"
      >
        <FolderIcon />
        Open
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        className={styles.hiddenInput}
        onChange={(e) => {
          const file = e.target.files?.[0]
          // Cleared so choosing the same file twice in a row still fires a change event.
          e.target.value = ''
          if (file) void doImport(file)
        }}
        aria-label="Open a project file"
      />
    </>
  )
}

/**
 * Reading kit folders off an SD card.
 *
 * Grouped with Export rather than with the project controls, because the two of them are
 * the pair that talks to the device: Import reads a card, Export writes one. Open and
 * Download move this *application's* own project file, which is a different thing entirely
 * and the reason the toolbar separates them.
 */
function CardImportControls() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [plan, setPlan] = useState<CardPlan<File> | null>(null)

  return (
    <>
      <Button
        variant="ghost"
        small
        onClick={() => inputRef.current?.click()}
        title="Read kit folders from an SD card or a copy of one — pick the card root for every kit, or a single kit folder"
      >
        <FolderIcon />
        Import
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple
        // Picking a directory rather than files. Non-standard but implemented everywhere the
        // app targets, and unlike showDirectoryPicker it needs no permission handshake.
        {...({ webkitdirectory: '' } as Record<string, string>)}
        className={styles.hiddenInput}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          // Cleared so picking the same folder twice in a row still fires a change event.
          e.target.value = ''
          if (files.length > 0) setPlan(planCardImport(files))
        }}
        aria-label="Import kit folders from a card"
      />
      {plan && <ImportDialog plan={plan} onClose={() => setPlan(null)} />}
    </>
  )
}

export function Toolbar({ onExport }: { onExport: () => void }) {
  const kits = useSession((s) => s.kits)
  const activeKitId = useSession((s) => s.activeKitId)
  const addKit = useSession((s) => s.addKit)
  const save = useSession((s) => s.save)
  const dirty = useSession((s) => s.dirty)
  const lastSavedAt = useSession((s) => s.lastSavedAt)

  return (
    <header className={styles.toolbar}>
      <div className={styles.brand}>
        <span className={styles.brandName}>
          Rample <span className={styles.brandAccent}>Kit Studio</span>
        </span>
      </div>

      <nav className={styles.tabs} aria-label="Kits">
        {kits.map((kit) => (
          <KitTab key={kit.id} kit={kit} active={kit.id === activeKitId} />
        ))}
        <button
          type="button"
          className={styles.addTab}
          onClick={addKit}
          disabled={kits.length >= MAX_KITS_PER_SESSION}
          aria-label="Add kit"
          title={
            kits.length >= MAX_KITS_PER_SESSION
              ? `A session holds at most ${MAX_KITS_PER_SESSION} kits — past that the tab row stops being navigable. Export what you have, then start a new session.`
              : 'Add a kit'
          }
        >
          <PlusIcon />
        </button>
      </nav>

      <div className={styles.actions}>
        {/* Two groups on purpose. The left one moves this application's own project; the
            right one talks to the SD card. They were previously mixed together, which made
            "Open" (a project file) and "Import" (a card) look like the same kind of thing. */}
        <div className={styles.group} aria-label="Project actions">
          <span className={styles.groupLabel}>Project</span>
          <Button
            onClick={save}
            small
            title={
              lastSavedAt
                ? `Last saved to this browser ${formatTimestamp(lastSavedAt)}${dirty ? ' — unsaved changes' : ''}`
                : 'Save this session to your browser'
            }
          >
            <SaveIcon />
            Save
            {dirty && <span className={styles.dirtyDot} aria-label="Unsaved changes" />}
          </Button>
          <ProjectFileControls />
        </div>

        <span className={styles.groupDivider} aria-hidden />

        <div className={styles.group} aria-label="Card actions">
          <span className={styles.groupLabel}>Card</span>
          <CardImportControls />
          <Button variant="primary" small onClick={onExport}>
            <DownloadIcon />
            Export
          </Button>
        </div>
      </div>
    </header>
  )
}
