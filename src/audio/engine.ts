import { VOICE_INDICES } from '~/domain/device'
import type { VoiceIndex } from '~/domain/device'
import { getAudioContext } from './context'

/**
 * The preview audio graph.
 *
 *   per voice:  BufferSource → envelope Gain → voice Gain → master Gain → destination
 *   always-on:  keep-alive source → its own Gain → destination
 *
 * This module knows nothing about kits, samples or patterns — it takes a buffer, a voice
 * number and a time, and makes sound. Layer selection lives in player.ts and timing in
 * scheduler.ts, so each layer can be reasoned about (and the timing tested) on its own.
 */

/** Release ramp on a stolen voice. Long enough to kill the click, short enough to feel instant. */
const STEAL_RELEASE_SEC = 0.008

/** Slew on fader moves, to avoid zipper noise from stepping a gain value directly. */
const FADER_SLEW_SEC = 0.015

interface VoiceBus {
  gain: GainNode
  playing: PlayingSource | null
}

interface PlayingSource {
  source: AudioBufferSourceNode
  envelope: GainNode
  released: boolean
}

interface Graph {
  master: GainNode
  voices: Map<VoiceIndex, VoiceBus>
  keepAlive: { source: AudioBufferSourceNode; gain: GainNode } | null
}

let graph: Graph | null = null

/** Levels applied to buses that may not exist yet, so the UI can set them at any time. */
const pendingLevels = { master: 0.8, voices: new Map<VoiceIndex, number>() }

function buildGraph(): Graph {
  const ctx = getAudioContext()

  const master = ctx.createGain()
  master.gain.value = pendingLevels.master
  master.connect(ctx.destination)

  const voices = new Map<VoiceIndex, VoiceBus>()
  for (const index of VOICE_INDICES) {
    const gain = ctx.createGain()
    gain.gain.value = pendingLevels.voices.get(index) ?? 0.8
    gain.connect(master)
    voices.set(index, { gain, playing: null })
  }

  return { master, voices, keepAlive: null }
}

/**
 * The graph is built lazily because constructing an AudioContext outside a user gesture
 * leaves it suspended and logs an autoplay warning. Call this from a gesture handler.
 */
export function getGraph(): Graph {
  if (!graph) {
    graph = buildGraph()
    applyKeepAlive(graph)
  }
  return graph
}

export function masterGain(): GainNode {
  return getGraph().master
}

function rampTo(param: AudioParam, value: number): void {
  const ctx = getAudioContext()
  // setTargetAtTime approaches exponentially rather than stepping, which is what keeps
  // a dragged fader from producing zipper noise.
  param.setTargetAtTime(value, ctx.currentTime, FADER_SLEW_SEC)
}

export function setMasterVolume(value: number): void {
  pendingLevels.master = value
  if (graph) rampTo(graph.master.gain, value)
}

export function setVoiceVolume(voice: VoiceIndex, value: number): void {
  pendingLevels.voices.set(voice, value)
  const bus = graph?.voices.get(voice)
  if (bus) rampTo(bus.gain.gain, value)
}

/**
 * Cut whatever this voice is currently playing.
 *
 * Each Rample voice is monophonic — re-triggering it stops the sound already there — so
 * the preview has to do the same or a busy pattern would stack up sound the hardware
 * never would. The short gain ramp before `stop()` is what stops that cut being an
 * audible click: ending a waveform mid-cycle is a step discontinuity.
 */
function steal(bus: VoiceBus, when: number): void {
  const playing = bus.playing
  if (!playing || playing.released) return

  const gain = playing.envelope.gain
  gain.cancelScheduledValues(when)
  // The envelope sits at unity until released, so this is its value at `when` — reading
  // .value would give the value *now*, which is not the same thing for a future event.
  gain.setValueAtTime(1, when)
  gain.linearRampToValueAtTime(0, when + STEAL_RELEASE_SEC)
  playing.source.stop(when + STEAL_RELEASE_SEC)
  playing.released = true
}

export interface TriggerHandle {
  /** Resolves when this source finishes or is stolen. */
  onEnded: (fn: () => void) => void
}

/**
 * Play a buffer on a voice, stealing whatever was there.
 *
 * `when` is an AudioContext timestamp. Passing a future time is how the sequencer gets
 * sample-accurate placement: the audio thread starts the source exactly then, regardless
 * of when the JS timer that scheduled it happened to run.
 */
export function triggerVoice(voice: VoiceIndex, buffer: AudioBuffer, when?: number): void {
  const ctx = getAudioContext()
  const at = when ?? ctx.currentTime
  const bus = getGraph().voices.get(voice)
  if (!bus) return

  steal(bus, at)

  const envelope = ctx.createGain()
  envelope.gain.value = 1
  envelope.connect(bus.gain)

  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(envelope)

  const playing: PlayingSource = { source, envelope, released: false }

  source.onended = () => {
    envelope.disconnect()
    if (bus.playing === playing) bus.playing = null
    endedListeners.forEach((fn) => fn(voice))
  }

  source.start(at)
  bus.playing = playing
}

/** Stop a voice without starting anything new. */
export function stopVoice(voice: VoiceIndex, when?: number): void {
  const bus = graph?.voices.get(voice)
  if (!bus) return
  steal(bus, when ?? getAudioContext().currentTime)
  bus.playing = null
}

export function stopAllVoices(): void {
  for (const index of VOICE_INDICES) stopVoice(index)
}

const endedListeners = new Set<(voice: VoiceIndex) => void>()

export function onVoiceEnded(fn: (voice: VoiceIndex) => void): () => void {
  endedListeners.add(fn)
  return () => endedListeners.delete(fn)
}

// ── Bluetooth keep-alive ─────────────────────────────────────────────────

/**
 * A2DP links go idle during silence and swallow the attack of whatever wakes them, at
 * an inconsistent delay. Keeping a continuous inaudible signal on the output stops the
 * link ever idling.
 *
 * Dither rather than digital silence, because some stacks treat a stream of zeroes as
 * silence and suspend anyway. -90 dBFS is below the noise floor of any playback system
 * and roughly a third of a 16-bit LSB.
 *
 * Routed to the destination rather than through the master bus, deliberately: its whole
 * job is to never stop, and going through master would silence it whenever the user
 * pulled the master fader down — exactly when they might then hit play and lose the
 * first transient.
 */
const KEEP_ALIVE_AMPLITUDE = 3.2e-5

let keepAliveWanted = true

/**
 * Records the preference and applies it if there is a graph to apply it to.
 *
 * Deliberately does not build the graph: this is called from a settings toggle and from
 * session restore, neither of which should conjure an AudioContext on a page that has
 * not yet made a sound. The preference is applied for real when the graph is first built.
 */
export function setKeepAlive(enabled: boolean): void {
  keepAliveWanted = enabled
  if (graph) applyKeepAlive(graph)
}

function applyKeepAlive(g: Graph): void {
  const ctx = getAudioContext()

  if (!keepAliveWanted) {
    if (g.keepAlive) {
      g.keepAlive.source.stop()
      g.keepAlive.gain.disconnect()
      g.keepAlive = null
    }
    return
  }

  if (g.keepAlive) return

  const frames = Math.floor(ctx.sampleRate)
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * KEEP_ALIVE_AMPLITUDE

  const gain = ctx.createGain()
  gain.gain.value = 1
  gain.connect(ctx.destination)

  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.loop = true
  source.connect(gain)
  source.start()

  g.keepAlive = { source, gain }
}

export function isKeepAliveRunning(): boolean {
  return Boolean(graph?.keepAlive)
}
