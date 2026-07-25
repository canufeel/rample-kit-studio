/**
 * The timer that drives the lookahead scheduler.
 *
 * A plain `setInterval` on the main thread is throttled to roughly once a second once
 * its tab is backgrounded. With a 100 ms lookahead that means the scheduler queues
 * 100 ms of music and then goes quiet for 900 ms — the loop falls apart the moment the
 * user switches tabs to fetch another sample.
 *
 * Running the timer in a dedicated worker is the standard fix (and the one "A Tale of
 * Two Clocks" recommends): worker timers are not subject to the same background
 * throttling, so the scheduler keeps waking up and keeps the audio thread fed. The
 * worker only ever says "tick" — all scheduling still happens on the main thread against
 * `AudioContext.currentTime`, so nothing about timing accuracy depends on it.
 */

const WORKER_SOURCE = `
let id = null
self.onmessage = (event) => {
  if (event.data.cmd === 'start') {
    clearInterval(id)
    id = setInterval(() => self.postMessage('tick'), event.data.interval)
  } else if (event.data.cmd === 'stop') {
    clearInterval(id)
    id = null
  }
}
`

export interface TickTimer {
  start(intervalMs: number, onTick: () => void): void
  stop(): void
  /** False when the worker could not be created and we fell back to the main thread. */
  readonly usesWorker: boolean
}

function createWorkerTimer(): TickTimer | null {
  try {
    // Built from a Blob rather than a separate file so the timer stays self-contained
    // and survives any bundler or static-host path arrangement.
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'application/javascript' }))
    const worker = new Worker(url)
    URL.revokeObjectURL(url)

    let handler: (() => void) | null = null
    worker.onmessage = () => handler?.()

    return {
      usesWorker: true,
      start(intervalMs, onTick) {
        handler = onTick
        worker.postMessage({ cmd: 'start', interval: intervalMs })
      },
      stop() {
        handler = null
        worker.postMessage({ cmd: 'stop' })
      },
    }
  } catch {
    return null
  }
}

function createIntervalTimer(): TickTimer {
  let id: ReturnType<typeof setInterval> | null = null
  return {
    usesWorker: false,
    start(intervalMs, onTick) {
      if (id !== null) clearInterval(id)
      id = setInterval(onTick, intervalMs)
    },
    stop() {
      if (id !== null) clearInterval(id)
      id = null
    },
  }
}

let timer: TickTimer | null = null

export function getTickTimer(): TickTimer {
  if (!timer) timer = createWorkerTimer() ?? createIntervalTimer()
  return timer
}
