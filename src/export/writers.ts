import JSZip from 'jszip'
import type { ExportPlan } from './buildKit'

/**
 * Two ways out of the browser.
 *
 * ZIP is the default because it works everywhere. Direct-to-folder is offered where the
 * File System Access API exists (Chromium), because it removes the unzip step and lets
 * kits be written straight onto a mounted SD card — which, given kit folders must sit
 * at the card root, is exactly the shape the device wants.
 */

export function supportsDirectoryWrite(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoking immediately can cancel the download in some browsers; one tick is enough.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function downloadZip(plans: readonly ExportPlan[], zipName: string): Promise<void> {
  const zip = new JSZip()
  for (const plan of plans) {
    for (const entry of plan.entries) {
      zip.file(entry.path, entry.bytes)
    }
  }
  // No compression: PCM audio barely compresses, and DEFLATE on tens of megabytes
  // blocks the main thread for seconds to save a few percent.
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
  triggerDownload(blob, zipName)
}

interface DirectoryHandleLike {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{
    createWritable(): Promise<{ write(data: BufferSource): Promise<void>; close(): Promise<void> }>
  }>
}

export class ExportCancelled extends Error {
  constructor() {
    super('Export cancelled')
    this.name = 'ExportCancelled'
  }
}

/**
 * Write kit folders into a directory the user picks — ideally the SD card root.
 *
 * Resolves to the number of files written. Throws ExportCancelled if the user dismisses
 * the picker, which is a normal outcome rather than a failure.
 */
export async function writeToDirectory(plans: readonly ExportPlan[]): Promise<number> {
  if (!supportsDirectoryWrite()) {
    throw new Error('This browser cannot write directly to a folder. Use the ZIP export.')
  }

  let root: DirectoryHandleLike
  try {
    root = await (
      window as unknown as {
        showDirectoryPicker(options?: { mode?: string }): Promise<DirectoryHandleLike>
      }
    ).showDirectoryPicker({ mode: 'readwrite' })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new ExportCancelled()
    throw error
  }

  let written = 0
  for (const plan of plans) {
    const folder = await root.getDirectoryHandle(plan.kitCode, { create: true })
    for (const entry of plan.entries) {
      const file = await folder.getFileHandle(entry.filename, { create: true })
      const writable = await file.createWritable()
      await writable.write(entry.bytes)
      await writable.close()
      written++
    }
  }
  return written
}
