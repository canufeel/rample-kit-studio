import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import styles from './Controls.module.css'

type Variant = 'default' | 'accent' | 'primary' | 'danger' | 'ghost'

const VARIANT_CLASS: Record<Variant, string> = {
  default: '',
  accent: styles.accent!,
  primary: styles.primary!,
  danger: styles.danger!,
  ghost: styles.ghost!,
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  small?: boolean
}

/** Forwards its ref so a dialog can place initial focus on a specific button. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', small, className, ...props },
  ref,
) {
  const classes = [styles.button, VARIANT_CLASS[variant], small ? styles.small : '', className]
    .filter(Boolean)
    .join(' ')
  return <button ref={ref} type="button" className={classes} {...props} />
})

interface SegmentedProps<T extends string> {
  value: T
  options: readonly { value: T; label: string; title?: string }[]
  onChange: (value: T) => void
  label: string
}

export function Segmented<T extends string>({ value, options, onChange, label }: SegmentedProps<T>) {
  return (
    <div className={styles.segmented} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          title={option.title}
          className={[styles.segment, option.value === value ? styles.segmentActive : '']
            .filter(Boolean)
            .join(' ')}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

type BadgeTone = 'neutral' | 'queued' | 'accent' | 'warning' | 'danger'

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: styles.badgeNeutral!,
  queued: styles.badgeQueued!,
  accent: styles.badgeAccent!,
  warning: styles.badgeWarning!,
  danger: styles.badgeDanger!,
}

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`${styles.badge} ${TONE_CLASS[tone]}`}>{children}</span>
}
