import { KIT_CODE_RE } from './device'

export type KitCodeError = 'empty' | 'format' | 'duplicate'

export const KIT_CODE_HINT = 'Bank letter A–Z followed by 0–99, e.g. A0, E10, Z99'

export function isKitCode(value: string): boolean {
  return KIT_CODE_RE.test(value)
}

/** Uppercases and strips whitespace so typing "a0" or " a0 " still lands on A0. */
export function normaliseKitCode(value: string): string {
  return value.trim().toUpperCase()
}

export function validateKitCode(value: string, takenCodes: readonly string[]): KitCodeError | null {
  const code = normaliseKitCode(value)
  if (!code) return 'empty'
  if (!isKitCode(code)) return 'format'
  if (takenCodes.some((c) => c === code)) return 'duplicate'
  return null
}

export function kitCodeErrorMessage(error: KitCodeError): string {
  switch (error) {
    case 'empty':
      return 'Kit code is required'
    case 'format':
      return KIT_CODE_HINT
    case 'duplicate':
      return 'Another kit already uses this code'
  }
}

/**
 * First unused code, scanning A0…A99, B0…B99, … Z99 — the same order the device
 * lists banks in, so successive new kits land somewhere predictable.
 */
export function nextAvailableKitCode(takenCodes: readonly string[]): string {
  const taken = new Set(takenCodes)
  for (let letter = 0; letter < 26; letter++) {
    for (let number = 0; number < 100; number++) {
      const code = `${String.fromCharCode(65 + letter)}${number}`
      if (!taken.has(code)) return code
    }
  }
  // All 2600 slots used. Vanishingly unlikely, but don't hand back undefined.
  return 'A0'
}
