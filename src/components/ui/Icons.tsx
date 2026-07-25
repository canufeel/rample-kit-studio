/**
 * Inline SVG icons. Bundled rather than pulled from an icon package so the app has no
 * runtime font or network dependency — it must work fully offline, including inside the
 * Stage-7 Tauri shell.
 *
 * All icons inherit `currentColor` and size from the `size` prop.
 */

interface IconProps {
  size?: number
  className?: string
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
})

export function PlayIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5 3.5v9l7-4.5-7-4.5Z" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function StopIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function CloseIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  )
}

export function PlusIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  )
}

export function DownloadIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M8 2.5v7.5M4.75 7l3.25 3 3.25-3M3 13h10" />
    </svg>
  )
}

export function SaveIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3 3h7.5L13 5.5V13H3V3Z" />
      <path d="M5.5 3v3.5h5V3M5.5 13v-3.5h5V13" />
    </svg>
  )
}

export function ConvertIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M2.5 6.5h9L9 4M13.5 9.5h-9L7 12" />
    </svg>
  )
}

export function GripIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={0}>
      <g fill="currentColor">
        <circle cx="6" cy="4" r="1.1" />
        <circle cx="10" cy="4" r="1.1" />
        <circle cx="6" cy="8" r="1.1" />
        <circle cx="10" cy="8" r="1.1" />
        <circle cx="6" cy="12" r="1.1" />
        <circle cx="10" cy="12" r="1.1" />
      </g>
    </svg>
  )
}

export function WarningIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M8 2.5 14.5 13.5h-13L8 2.5Z" />
      <path d="M8 6.5v3M8 11.5h.01" />
    </svg>
  )
}

export function FolderIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M2 4.5h4l1.25 1.5H14v6.5H2v-8Z" />
    </svg>
  )
}
