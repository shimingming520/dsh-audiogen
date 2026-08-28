/**
 * Tiny inline SVG icon set for the AI 音频 panel (no icon dependency).
 * Each icon is a 1em × 1em stroke/fill glyph that inherits currentColor.
 */

import type { JSX, ReactNode } from 'react'

function Svg(props: { children: ReactNode; viewBox?: string }): JSX.Element {
  return (
    <svg
      width="1em"
      height="1em"
      viewBox={props.viewBox ?? '0 0 16 16'}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {props.children}
    </svg>
  )
}

export function PlayIcon(): JSX.Element {
  return (
    <Svg viewBox="0 0 16 16">
      <path d="M5 3.2v9.6a.6.6 0 0 0 .9.5l7.5-4.8a.6.6 0 0 0 0-1L5.9 2.7a.6.6 0 0 0-.9.5Z" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function PauseIcon(): JSX.Element {
  return (
    <Svg viewBox="0 0 16 16">
      <rect x="4.2" y="2.8" width="2.6" height="10.4" rx="0.9" fill="currentColor" stroke="none" />
      <rect x="9.2" y="2.8" width="2.6" height="10.4" rx="0.9" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function StarIcon(props: { filled?: boolean }): JSX.Element {
  return (
    <Svg viewBox="0 0 16 16">
      <path
        d="M8 1.9l1.8 3.7 4.1.6-3 2.9.7 4.1L8 11.2l-3.6 1.9.7-4.1-3-2.9 4.1-.6L8 1.9Z"
        fill={props.filled === true ? 'currentColor' : 'none'}
      />
    </Svg>
  )
}

export function DownloadIcon(): JSX.Element {
  return (
    <Svg viewBox="0 0 16 16">
      <path d="M8 2.5v7M8 9.5l-2.6-2.6M8 9.5l2.6-2.6" />
      <path d="M2.8 10.8v1.7a1 1 0 0 0 1 1h8.4a1 1 0 0 0 1-1v-1.7" />
    </Svg>
  )
}

export function TrashIcon(): JSX.Element {
  return (
    <Svg viewBox="0 0 16 16">
      <path d="M3 4.4h10M6.2 2.9h3.6M5.2 4.4l.5 8a1 1 0 0 0 1 .9h2.6a1 1 0 0 0 1-.9l.5-8" />
    </Svg>
  )
}

export function SearchIcon(): JSX.Element {
  return (
    <Svg viewBox="0 0 16 16">
      <circle cx="7" cy="7" r="4.2" />
      <path d="m10.2 10.2 3 3" />
    </Svg>
  )
}

export function CopyIcon(): JSX.Element {
  return (
    <Svg viewBox="0 0 16 16">
      <rect x="5.4" y="5.4" width="7.4" height="7.4" rx="1.2" />
      <path d="M10.6 5.4V4a1.2 1.2 0 0 0-1.2-1.2H4A1.2 1.2 0 0 0 2.8 4v5.4A1.2 1.2 0 0 0 4 10.6h1.4" />
    </Svg>
  )
}

export function CheckIcon(): JSX.Element {
  return (
    <Svg viewBox="0 0 16 16">
      <path d="m3.2 8.4 3.1 3.1L12.8 4.9" />
    </Svg>
  )
}

export function CloseIcon(): JSX.Element {
  return (
    <Svg viewBox="0 0 16 16">
      <path d="m4 4 8 8M12 4l-8 8" />
    </Svg>
  )
}

export function VolumeIcon(): JSX.Element {
  return (
    <Svg viewBox="0 0 16 16">
      <path d="M2.8 6.2v3.6h2.4l3 2.6V3.6l-3 2.6H2.8Z" fill="currentColor" stroke="none" />
      <path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12 4.2a5.6 5.6 0 0 1 0 7.6" />
    </Svg>
  )
}

export function MuteIcon(): JSX.Element {
  return (
    <Svg viewBox="0 0 16 16">
      <path d="M2.8 6.2v3.6h2.4l3 2.6V3.6l-3 2.6H2.8Z" fill="currentColor" stroke="none" />
      <path d="m10.4 6.2 3.2 3.6M13.6 6.2l-3.2 3.6" />
    </Svg>
  )
}

export function MicIcon(): JSX.Element {
  return (
    <Svg viewBox="0 0 16 16">
      <rect x="5.8" y="2" width="4.4" height="7.2" rx="2.2" />
      <path d="M3.2 8a4.8 4.8 0 0 0 9.6 0M8 12.8V14" />
    </Svg>
  )
}

export function MusicNoteIcon(): JSX.Element {
  return (
    <Svg viewBox="0 0 16 16">
      <path d="M6.2 12.6V4l6-1.4v8.6" />
      <circle cx="4.7" cy="12.6" r="1.7" />
      <circle cx="10.7" cy="11.2" r="1.7" />
    </Svg>
  )
}

export function WaveIcon(): JSX.Element {
  return (
    <Svg viewBox="0 0 16 16">
      <path d="M2 6h1M4.5 3.5v9M7.2 2v12M9.9 4v8M12.6 5.5v5M14.5 6.5v3" />
    </Svg>
  )
}

export function GridIcon(): JSX.Element {
  return (
    <Svg viewBox="0 0 16 16">
      <rect x="2.5" y="2.5" width="4.6" height="4.6" rx="1" />
      <rect x="8.9" y="2.5" width="4.6" height="4.6" rx="1" />
      <rect x="2.5" y="8.9" width="4.6" height="4.6" rx="1" />
      <rect x="8.9" y="8.9" width="4.6" height="4.6" rx="1" />
    </Svg>
  )
}

export function ListIcon(): JSX.Element {
  return (
    <Svg viewBox="0 0 16 16">
      <path d="M5.4 4.2h8.2M5.4 8h8.2M5.4 11.8h8.2" />
      <circle cx="2.8" cy="4.2" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="2.8" cy="8" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="2.8" cy="11.8" r="0.8" fill="currentColor" stroke="none" />
    </Svg>
  )
}
