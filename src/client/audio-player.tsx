/**
 * Custom audio player: play/pause, seekable progress and time readout.
 * Replaces the native `<audio controls>` look with a themed control so the
 * panel matches the DSH design tokens in light and dark modes.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { MuteIcon, PauseIcon, PlayIcon, VolumeIcon } from './icons.tsx'
import css from './audio-panel.module.css'

function format(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const whole = Math.floor(seconds)
  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  return `${minutes}:${rest < 10 ? `0${rest}` : String(rest)}`
}

export function AudioPlayer(props: {
  src: string
  compact?: boolean
  /** Optional key to force a fresh element when the source changes identity. */
  itemKey?: string
}): React.JSX.Element {
  const ref = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    // Reset when the source changes (the media element re-loads).
    setPlaying(false)
    setCurrent(0)
    setDuration(0)
  }, [props.src])

  const toggle = useCallback((): void => {
    const el = ref.current
    if (el === null) return
    if (el.paused) void el.play().catch(() => { /* autoplay/interrupt best-effort */ })
    else el.pause()
  }, [])

  const seek = useCallback((event: React.MouseEvent<HTMLDivElement>): void => {
    const el = ref.current
    if (el === null || duration <= 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
    el.currentTime = ratio * duration
  }, [duration])

  const toggleMute = useCallback((): void => {
    const el = ref.current
    if (el === null) return
    el.muted = !el.muted
    setMuted(el.muted)
  }, [])

  const percent = duration > 0 ? Math.min(100, (current / duration) * 100) : 0

  return (
    <div className={props.compact === true ? css.playerCompact : css.player} data-playing={playing ? 'true' : 'false'}>
      <audio
        ref={ref}
        src={props.src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={event => setCurrent(event.currentTarget.currentTime)}
        onLoadedMetadata={event => setDuration(event.currentTarget.duration)}
      />
      <button type="button" className={css.playButton} aria-label={playing ? '暂停' : '播放'} onClick={toggle}>
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className={css.track} role="slider" aria-label="播放进度" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(current)} onClick={seek}>
        <div className={css.trackFill} style={{ width: `${percent}%` }} />
        <div className={css.trackKnob} style={{ left: `${percent}%` }} />
      </div>
      <span className={css.time}>{format(current)}{duration > 0 ? ` / ${format(duration)}` : ''}</span>
      <button type="button" className={css.muteButton} aria-label={muted ? '取消静音' : '静音'} onClick={toggleMute}>
        {muted ? <MuteIcon /> : <VolumeIcon />}
      </button>
    </div>
  )
}
