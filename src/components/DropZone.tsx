import { useCallback, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import styles from './VoicePanel.module.css'

/**
 * File import target.
 *
 * Uses native HTML drag-and-drop rather than dnd-kit: dnd-kit moves DOM nodes within
 * the page and has no concept of a file coming in from the OS. The two systems listen
 * to different events (pointer vs drag) so they coexist without interfering.
 */

interface DropZoneProps {
  onFiles: (files: File[]) => void
  label: string
  hint: string
  accept: string
  disabled?: boolean
}

export function DropZone({ onFiles, label, hint, accept, disabled }: DropZoneProps) {
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // dragenter/dragleave fire for every child element the cursor crosses, so a plain
  // boolean flickers. Counting enters and leaves is the standard fix.
  const depth = useRef(0)

  const handleEnter = useCallback((event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    depth.current += 1
    setOver(true)
  }, [])

  const handleLeave = useCallback((event: DragEvent) => {
    event.preventDefault()
    depth.current -= 1
    if (depth.current <= 0) {
      depth.current = 0
      setOver(false)
    }
  }, [])

  const handleOver = useCallback((event: DragEvent) => {
    if (!event.dataTransfer.types.includes('Files')) return
    // Without this the browser navigates to the dropped file instead of giving it to us.
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault()
      depth.current = 0
      setOver(false)
      if (disabled) return
      const files = Array.from(event.dataTransfer.files)
      if (files.length > 0) onFiles(files)
    },
    [disabled, onFiles],
  )

  return (
    <>
      <div
        className={`${styles.dropZone} ${over ? styles.dropZoneOver : ''}`}
        onDragEnter={handleEnter}
        onDragLeave={handleLeave}
        onDragOver={handleOver}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            inputRef.current?.click()
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={label}
      >
        <span>{label}</span>
        <span className={styles.dropHint}>{hint}</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        className={styles.hiddenInput}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          if (files.length > 0) onFiles(files)
          // Reset so re-picking the same file fires change again.
          event.target.value = ''
        }}
      />
    </>
  )
}
