import { VOICE_INDICES } from '~/domain/device'
import type { VoiceIndex } from '~/domain/device'
import { advanceClock, resolvePattern } from '~/domain/sequence'
import type { ChannelClock } from '~/domain/sequence'
import type { ChannelSequence } from '~/domain/types'
import { activeLayers } from '~/domain/voice'
import { getActiveKit, useSession } from '~/store/useSession'
import { preload } from './buffers'
import { getAudioContext, resumeAudio } from './context'
import { stopAllVoices } from './engine'
import { resetCursors, triggerScheduled } from './player'
import { getTickTimer } from './tickTimer'

/**
 * The lookahead scheduler — "A Tale of Two Clocks".
 *
 * JS timers are the wrong clock for music: `setInterval` drifts by milliseconds under
 * load and is throttled to once a second in a background tab, which would turn a groove
 * into a stutter the moment the user switched tabs. The audio clock, by contrast, is
 * sample-accurate but cannot run our code.
 *
 * So we use both. A coarse timer wakes up every 25 ms and asks "what falls due in the
 * next 100 ms?", then hands those events to the audio thread with exact
 * `AudioContext.currentTime` offsets. The sloppy clock decides *what* to schedule; the
 * audio clock decides *when* it sounds. Timer jitter of a few milliseconds is invisible
 * because it only affects how far ahead we queue, never where a hit lands.
 */

/**
 * How often the timer wakes. Small enough to stay ahead of the lookahead window, large
 * enough not to spin. Driven from a worker (see tickTimer.ts) so backgrounding the tab
 * doesn't throttle it below the rate the window needs.
 */
const TICK_MS = 25

/** How far ahead events are handed to the audio thread. Must exceed worst-case timer jitter. */
const SCHEDULE_AHEAD_SEC = 0.1

/** Small offset on start so the first hit isn't scheduled in the past. */
const START_LATENCY_SEC = 0.06

/** Backstop on loop boundaries handled in a single tick. See the tick loop. */
const MAX_WRAPS_PER_TICK = 64

const clocks = new Map<VoiceIndex, ChannelClock>()
let running = false

// ── Playhead, published outside React state ─────────────────────────────────────

export interface TransportSnapshot {
  playing: boolean
  /** Current step index per voice, or null when that channel is idle. */
  steps: Partial<Record<VoiceIndex, number | null>>
}

let snapshot: TransportSnapshot = { playing: false, steps: {} }
const listeners = new Set<(s: TransportSnapshot) => void>()
let frame: number | null = null

/**
 * Playheads move up to sixteen times a second per channel. Publishing every change
 * straight to React would mean ~64 renders a second across four channels; coalescing to
 * one animation frame caps it at the display's refresh rate and drops updates nobody
 * could see anyway.
 */
function publish(): void {
  if (frame !== null) return
  frame = requestAnimationFrame(() => {
    frame = null
    snapshot = { ...snapshot, steps: { ...snapshot.steps } }
    for (const listener of listeners) listener(snapshot)
  })
}

export function onTransport(listener: (s: TransportSnapshot) => void): () => void {
  listeners.add(listener)
  listener(snapshot)
  return () => listeners.delete(listener)
}

export function getTransportSnapshot(): TransportSnapshot {
  return snapshot
}

// ── Scheduling ──────────────────────────────────────────────────────────────────

function sequenceFor(voice: VoiceIndex): ChannelSequence | undefined {
  return getActiveKit().sequences[voice - 1]
}

/**
 * Queue every step falling due inside the lookahead window.
 *
 * Each channel advances on its own clock. Because they share one tempo but keep their
 * own step counts and divisions, channels of differing length drift against each other
 * — polymeter, for free, and the reason this loop is per-channel rather than one global
 * step counter.
 */
function tick(): void {
  const ctx = getAudioContext()
  const horizon = ctx.currentTime + SCHEDULE_AHEAD_SEC
  const bpm = getActiveKit().bpm

  for (const voice of VOICE_INDICES) {
    let clock = clocks.get(voice)
    let sequence = sequenceFor(voice)
    if (!clock || !sequence) continue

    let pattern = resolvePattern(sequence)

    // Each pass runs to the horizon or to a loop boundary, whichever comes first. The
    // bound is a backstop against a pathologically short pattern at a fast division
    // producing an unbounded number of wraps inside one window.
    for (let pass = 0; pass < MAX_WRAPS_PER_TICK; pass++) {
      // Tempo and division are read fresh each pass, so a BPM change takes effect from
      // the next step rather than needing the transport restarted.
      const result = advanceClock(clock, pattern, sequence.division, bpm, horizon)

      for (const hit of result.hits) triggerScheduled(voice, hit.time)

      clock = result.clock
      clocks.set(voice, clock)
      snapshot.steps[voice] = clock.step

      if (!result.wrapped) break

      // A randomise requested mid-flight lands here, exactly on the boundary, so the
      // pattern never jumps under the user's ears.
      if (sequence.pendingRandomise) {
        useSession.getState().applyPendingRandomise(voice)
        const updated = sequenceFor(voice)
        if (!updated) break
        sequence = updated
        pattern = resolvePattern(updated)
      }
    }
  }

  publish()
}

/**
 * Start the transport.
 *
 * Preloads every layer first: the scheduler's inner loop must stay synchronous, so any
 * decoding has to be finished before the first tick rather than discovered during one.
 */
export async function startTransport(): Promise<{ missing: number }> {
  if (running) return { missing: 0 }

  await resumeAudio()

  const state = useSession.getState()
  const kit = state.kits.find((k) => k.id === state.activeKitId)
  const ids = kit ? kit.voices.flatMap((voice) => activeLayers(voice)) : []
  const failed = await preload(ids)

  // resumeAudio may have taken a moment; read the clock after it, not before.
  const start = getAudioContext().currentTime + START_LATENCY_SEC

  clocks.clear()
  resetCursors()
  for (const voice of VOICE_INDICES) {
    clocks.set(voice, { nextTime: start, step: 0 })
    snapshot.steps[voice] = 0
  }

  snapshot = { ...snapshot, playing: true }
  useSession.getState().setPlaying(true)

  running = true
  getTickTimer().start(TICK_MS, tick)
  tick()

  return { missing: failed.length }
}

export function stopTransport(): void {
  if (!running) return
  running = false
  getTickTimer().stop()
  clocks.clear()
  // Cut sounding voices rather than letting long samples ring on after Stop — the
  // transport button should mean silence.
  stopAllVoices()

  snapshot = { playing: false, steps: {} }
  useSession.getState().setPlaying(false)
  publish()
}

export function isRunning(): boolean {
  return running
}

/**
 * Patterns and tempo belong to the kit, so a kit switch is a hard cut for the clock.
 *
 * This lives with the clock rather than in `setActiveKit` for two reasons: whether the
 * transport is running is the scheduler's own business, and the store importing the
 * scheduler would close an import cycle between them.
 */
useSession.subscribe((state, previous) => {
  if (state.activeKitId === previous.activeKitId) return
  // Deferred by a microtask on purpose. This listener runs *inside* the store's own set(),
  // and stopTransport writes back to the store and publishes a snapshot. Doing that
  // re-entrantly leaves React's subscribers holding the pre-stop values: the clock really
  // stops, but the button still reads "Stop" and the playheads freeze mid-pattern.
  queueMicrotask(stopTransport)
})
