import styles from './Fader.module.css'

interface FaderProps {
  label: string
  value: number
  onChange: (value: number) => void
  disabled?: boolean
}

/**
 * Preview-level control. Values are 0..1 linear; the engine applies the actual slew, so
 * dragging is smooth rather than stepped.
 *
 * Shown as a percentage rather than dBFS: this is a balance control for judging four
 * voices against each other, not a mastering meter, and nothing about it is exported.
 */
export function Fader({ label, value, onChange, disabled }: FaderProps) {
  return (
    <div className={styles.fader}>
      <span className={styles.label}>{label}</span>
      <input
        type="range"
        className={styles.slider}
        min={0}
        max={1}
        step={0.01}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`${label} volume`}
      />
      <span className={styles.value}>{Math.round(value * 100)}</span>
    </div>
  )
}
