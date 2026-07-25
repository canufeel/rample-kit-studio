/**
 * The Rample export contract.
 *
 * Every rule here is quoted from the official manual (https://squarp.net/rample/manual/).
 * Nothing else in the codebase is allowed to hardcode these numbers — if the device
 * contract ever changes, it changes here.
 *
 * Rample Turbo runs identical firmware (RampleOS) to the original Rample; the Turbo's
 * improvements are analogue (better DAC, quieter path) and a faster SD card. There is
 * no format difference between the two models.
 */

/** "These files must be in a standard .wav ... 44100 Hz". Not negotiable, not a maximum. */
export const DEVICE_SAMPLE_RATE = 44100

/** "16–bit or 8–bit". The DAC is 16-bit, so 8-bit is legal but strictly lossier. */
export const DEVICE_BIT_DEPTHS = [16, 8] as const
export type BitDepth = (typeof DEVICE_BIT_DEPTHS)[number]

/** Default conversion target. 16-bit matches the DAC. */
export const DEFAULT_BIT_DEPTH: BitDepth = 16

/** "minimum length 50ms. There is no size or duration limits." */
export const MIN_SAMPLE_SEC = 0.05

/**
 * Pad slightly past the 50 ms floor rather than landing exactly on it, so a sample
 * can't fail the device's check on a rounding boundary. ~51 ms.
 */
export const PAD_TARGET_FRAMES = 2250

/** "Each kit folder can includes up to 12 layers (.wav sample files) per voice." */
export const MAX_LAYERS_PER_VOICE = 12

/** 4 voices, SP1–SP4. */
export const VOICE_COUNT = 4
export const VOICE_INDICES = [1, 2, 3, 4] as const
export type VoiceIndex = (typeof VOICE_INDICES)[number]

/**
 * Kit folder name: "?X where ? is a bank letter (A-Z) and X is a kit number (0-99)".
 * "Up to 2600 folders can be created!" — 26 × 100, which only works if the number is
 * unpadded: A0 is valid, A00 is not (it would be a 2601st spelling of the same kit).
 */
export const KIT_CODE_RE = /^[A-Z](?:0|[1-9][0-9]?)$/

/** "All your kit folders must be located on the root of the SD card!" */
export const KIT_FOLDERS_AT_ROOT = true

/**
 * "The first character must be the number of the voice, from 1 to 4."
 * "Sample layer names are numerically and alphabetically sorted in Rample, handy to
 * create a special order." — so a zero-padded slot index right after the voice digit
 * pins layer order deterministically.
 */
export const EXPORT_FILENAME_SLOT_DIGITS = 2

/** The device reads .wav only. Anything else must be converted before export. */
export const DEVICE_CONTAINER = 'wav' as const
