import { useEffect, useRef, useState } from 'react'
import styles from './NumberStepper.module.css'

/**
 * A small integer field with its own − / + buttons.
 *
 * Replaces `<input type="number">` for the sequencer's Len/Trig/Rot, for two reasons.
 *
 * The visible one is reach: the native spin buttons are unusable at this size and were
 * suppressed, which left arrow keys as the only way to nudge a value.
 *
 * The other is that a number input commits on every keystroke. Clearing the field yielded
 * `Number('') === 0`, the store clamped that to the minimum and wrote it back, and the
 * field was then repopulated — so typing "2" after clearing produced "02", with no way to
 * remove the leading digit. This keeps the half-typed text in `draft` and commits only on
 * blur or Enter, so an empty field is simply an empty field until the user is done.
 */

/** How long a button must be held before it starts repeating, and how fast it then goes. */
const HOLD_DELAY_MS = 400
const HOLD_INTERVAL_MS = 70

interface NumberStepperProps {
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  /** Accessible name for the field. The two buttons derive theirs from it. */
  label: string
  /** Width of the text box. Wide enough for the largest value it can hold. */
  width?: string
  className?: string
}

export function NumberStepper({
  value,
  min,
  max,
  onChange,
  label,
  width = '3ch',
  className,
}: NumberStepperProps) {
  // `null` means "not being edited": the box shows the committed value, so a change from
  // elsewhere — a preset recall, a clamp — appears immediately without fighting the caret.
  const [draft, setDraft] = useState<string | null>(null)

  const timers = useRef<{
    delay?: ReturnType<typeof setTimeout>
    repeat?: ReturnType<typeof setInterval>
  }>({})

  // A held button must stop when the pointer is released anywhere, not just over the
  // button — and must not outlive the component either.
  useEffect(() => {
    const stop = () => {
      clearTimeout(timers.current.delay)
      clearInterval(timers.current.repeat)
      timers.current = {}
    }
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      stop()
    }
  }, [])

  const clamp = (n: number) => Math.max(min, Math.min(max, Math.round(n)))

  /** The number the field is showing, whether or not it has been committed yet. */
  function shownValue(): number {
    const text = draft?.trim()
    if (text) {
      const parsed = Number(text)
      if (Number.isFinite(parsed)) return clamp(parsed)
    }
    return value
  }

  function step(delta: number) {
    // Stepping from half-typed text: "20" then + should give 21, not one more than
    // whatever was committed before the typing started.
    const next = clamp(shownValue() + delta)
    setDraft(null)
    if (next !== value) onChange(next)
  }

  /**
   * Press-and-hold repeat. The running value is kept in the closure rather than read back
   * from the prop: at 70 ms a repaint is not guaranteed between ticks, and re-reading a
   * value React had not yet updated would make the counter stall.
   */
  function hold(delta: number) {
    let current = clamp(shownValue() + delta)
    setDraft(null)
    if (current !== value) onChange(current)

    timers.current.delay = setTimeout(() => {
      timers.current.repeat = setInterval(() => {
        const next = clamp(current + delta)
        if (next === current) {
          clearInterval(timers.current.repeat)
          return
        }
        current = next
        onChange(next)
      }, HOLD_INTERVAL_MS)
    }, HOLD_DELAY_MS)
  }

  /** Parse what was typed, or put the committed value back if it was not a number. */
  function commit() {
    const text = draft?.trim() ?? ''
    setDraft(null)
    if (text === '') return
    const parsed = Number(text)
    if (!Number.isFinite(parsed)) return
    const next = clamp(parsed)
    if (next !== value) onChange(next)
  }

  return (
    <span className={[styles.stepper, className].filter(Boolean).join(' ')}>
      <button
        type="button"
        className={styles.button}
        onPointerDown={() => hold(-1)}
        // Assistive tech activates a button without a pointer behind it, which arrives as
        // a click with `detail === 0`. A mouse click reports 1 or more and is already
        // handled by the pointerdown above, so the two paths never double-fire.
        onClick={(e) => {
          if (e.detail === 0) step(-1)
        }}
        disabled={value <= min}
        aria-label={`Decrease ${label}`}
        // Not a tab stop: three of these per channel would be twenty-four extra stops in
        // the sequencer. The field itself is a spinbutton, so arrow keys do the same job.
        tabIndex={-1}
      >
        −
      </button>

      <input
        type="text"
        inputMode="numeric"
        className={styles.input}
        style={{ width }}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            setDraft(null)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            step(1)
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            step(-1)
          }
        }}
        aria-label={label}
        role="spinbutton"
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
      />

      <button
        type="button"
        className={styles.button}
        onPointerDown={() => hold(1)}
        onClick={(e) => {
          if (e.detail === 0) step(1)
        }}
        disabled={value >= max}
        aria-label={`Increase ${label}`}
        tabIndex={-1}
      >
        +
      </button>
    </span>
  )
}
