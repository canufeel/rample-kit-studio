import { KIT_CODE_RE, VOICE_COUNT } from './device'
import type { VoiceIndex } from './device'

/**
 * Reading an SD card back into the app.
 *
 * This is the inverse of the export: the card holds kit folders named `A0`, `B7` and so on,
 * each containing WAVs whose first character is the device voice they belong to. That is
 * the whole format, and it is enough to reconstruct kits, voices and layer order from a
 * plain directory listing — no manifest, nothing app-specific.
 *
 * Pure, and deliberately generic over the file type, so the interpretation of a card can be
 * tested without a browser or a real `File`.
 */

/** The minimum a picked file has to tell us. Browsers give both on a directory pick. */
export interface PickedFile {
  name: string
  /** Path relative to the picked folder, e.g. `resources/A0/1 KICK LOW 01.wav`. */
  webkitRelativePath?: string
}

export type SkipReason = 'notAudio' | 'notInKitFolder' | 'noVoiceDigit'

export interface PlannedLayer<F> {
  voice: VoiceIndex
  file: F
}

export interface PlannedKit<F> {
  /** The folder name, which is also the kit code the device uses. */
  code: string
  /** In device order: grouped by voice, then numerically-and-alphabetically by filename. */
  layers: PlannedLayer<F>[]
}

export interface CardPlan<F> {
  kits: PlannedKit<F>[]
  skipped: { path: string; reason: SkipReason }[]
}

/**
 * What the browser can plausibly decode. Anything else on a card — the credits `.rtf`
 * files the factory card ships, `.DS_Store`, the device's own `_save/*.rpl` state — is
 * skipped rather than treated as a failed sample.
 */
const AUDIO_EXTENSIONS = new Set([
  'wav',
  'mp3',
  'flac',
  'ogg',
  'oga',
  'm4a',
  'mp4',
  'aac',
  'opus',
  'webm',
  'aif',
  'aiff',
])

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * The device sorts layers "numerically and alphabetically", so a plain lexicographic sort
 * would put `10` before `2`. `numeric: true` reproduces the device's own ordering, which is
 * what makes the imported layer order match what the hardware would have played.
 */
function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * Group a flat directory pick into kits.
 *
 * The kit folder is the *last* path segment that looks like a kit code, so picking the card
 * root (`CARD/A0/1 kick.wav`) and picking a single kit folder (`A0/1 kick.wav`) both work,
 * and a stray nested folder cannot be mistaken for a kit.
 */
export function planCardImport<F extends PickedFile>(files: readonly F[]): CardPlan<F> {
  const byCode = new Map<string, PlannedLayer<F>[]>()
  const skipped: { path: string; reason: SkipReason }[] = []

  for (const file of files) {
    const path = file.webkitRelativePath || file.name
    const segments = path.split('/').filter(Boolean)
    const filename = segments[segments.length - 1] ?? file.name

    if (!AUDIO_EXTENSIONS.has(extensionOf(filename))) {
      skipped.push({ path, reason: 'notAudio' })
      continue
    }

    const directories = segments.slice(0, -1)
    const code = [...directories].reverse().find((segment) => KIT_CODE_RE.test(segment))
    if (!code) {
      skipped.push({ path, reason: 'notInKitFolder' })
      continue
    }

    // "The first character must be the number of the voice, from 1 to 4."
    const digit = Number(filename[0])
    if (!Number.isInteger(digit) || digit < 1 || digit > VOICE_COUNT) {
      skipped.push({ path, reason: 'noVoiceDigit' })
      continue
    }

    const layers = byCode.get(code) ?? []
    layers.push({ voice: digit as VoiceIndex, file })
    byCode.set(code, layers)
  }

  const kits = [...byCode.entries()]
    .map(([code, layers]) => ({
      code,
      // Voice first, then the device's own filename ordering within each voice.
      layers: [...layers].sort(
        (a, b) => a.voice - b.voice || compareNames(nameOf(a.file), nameOf(b.file)),
      ),
    }))
    .sort((a, b) => compareNames(a.code, b.code))

  return { kits, skipped }
}

function nameOf(file: PickedFile): string {
  const path = file.webkitRelativePath || file.name
  return path.split('/').pop() ?? file.name
}

/** Total layers across a plan, for the confirmation summary. */
export function countLayers<F>(plan: CardPlan<F>): number {
  return plan.kits.reduce((sum, kit) => sum + kit.layers.length, 0)
}

/**
 * How an incoming kit code is reconciled with what is already open.
 *
 * A fresh session always holds one empty `A0`, so importing a card that contains `A0` would
 * otherwise collide immediately. Taking over an *empty* kit is what the user means; taking
 * over one with samples in it is not, so that one is renamed and reported instead of
 * silently destroying work.
 */
export type CodeResolution =
  | { kind: 'fresh'; code: string }
  | { kind: 'takeover'; code: string; kitId: string }
  | { kind: 'renamed'; code: string; from: string }

export function resolveCode(
  code: string,
  existing: readonly { id: string; code: string; sampleCount: number }[],
  taken: ReadonlySet<string>,
): CodeResolution {
  const clash = existing.find((kit) => kit.code === code)
  if (!clash) return { kind: 'fresh', code }
  if (clash.sampleCount === 0) return { kind: 'takeover', code, kitId: clash.id }

  // Keep the bank letter and walk the number up, so a renamed A0 becomes A1 rather than
  // landing in an unrelated bank.
  const letter = code[0]!
  for (let n = 0; n < 100; n++) {
    const candidate = `${letter}${n}`
    if (!taken.has(candidate) && !existing.some((kit) => kit.code === candidate)) {
      return { kind: 'renamed', code: candidate, from: code }
    }
  }
  // The bank is full. Fall back to any free code at all rather than refusing the import.
  for (let c = 65; c <= 90; c++) {
    for (let n = 0; n < 100; n++) {
      const candidate = `${String.fromCharCode(c)}${n}`
      if (!taken.has(candidate) && !existing.some((kit) => kit.code === candidate)) {
        return { kind: 'renamed', code: candidate, from: code }
      }
    }
  }
  return { kind: 'renamed', code, from: code }
}
