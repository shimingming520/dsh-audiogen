/**
 * Inline renderer for audio-generation tool results.
 *
 * The model-facing tool result is a JSON text envelope with same-origin audio
 * URLs; this view turns it into a small audio-player card.
 */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { useEffect, useMemo, useState } from 'react'
import css from './audio-toolview.module.css'

export interface AudioToolViewOwnerProps {
  callId: string
  toolName: string
  block: unknown
  cwd?: string
  home?: string
  openFile: (path: string) => void
  inspect?: () => void
}

interface AudioFileRef {
  id?: string
  url: string
  mime: string
  bytes: number
}

interface AudioToolViewProps extends AudioToolViewOwnerProps {
  sessionId: SessionId
}

function isSettled(block: unknown): block is { content?: Array<{ type: string; text?: string }>; isError?: boolean } {
  return typeof block === 'object' && block !== null && 'content' in block
}

function textOf(block: unknown): string {
  if (!isSettled(block)) return ''
  return (block.content ?? [])
    .filter(content => content.type === 'text' && typeof content.text === 'string')
    .map(content => content.text as string)
    .join('\n')
}

function parseResult(block: unknown): { status: string; message: string; audio: AudioFileRef[]; error?: string } {
  const text = textOf(block)
  if (text === '') return { status: 'running', message: '正在生成音频…', audio: [] }
  try {
    const parsed = JSON.parse(text) as { status?: string; message?: string; audio?: AudioFileRef[]; error?: string }
    return {
      status: parsed.status ?? 'completed',
      message: parsed.message ?? '',
      audio: Array.isArray(parsed.audio) ? parsed.audio.filter((item): item is AudioFileRef => {
        return typeof item === 'object' && item !== null && typeof (item as AudioFileRef).url === 'string'
      }) : [],
      ...(typeof parsed.error === 'string' ? { error: parsed.error } : {}),
    }
  } catch {
    return { status: 'completed', message: text, audio: [] }
  }
}

function statusLabel(status: string): string {
  if (status === 'running' || status === 'queued') return '生成中'
  if (status === 'failed') return '生成失败'
  if (status === 'cancelled') return '已取消'
  return '音频结果'
}

function mimeExt(mime: string): string {
  if (mime.includes('wav')) return 'wav'
  if (mime.includes('flac')) return 'flac'
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a'
  return 'mp3'
}

export function registerAudioToolviews(ctx: ClientContext): void {
  const AudioToolView = (props: AudioToolViewProps): React.JSX.Element => {
    const result = useMemo(() => parseResult(props.block), [props.block])
    const [active, setActive] = useState<string | null>(null)
    useEffect(() => { setActive(null) }, [props.callId])
    const title = props.toolName === 'generate_audio' ? '生成音频' : props.toolName
    return (
      <section className={css.root} data-state={result.status} data-tool={props.toolName}>
        <header className={css.header}>
          <span className={css.icon} aria-hidden="true">♫</span>
          <strong>{title}</strong>
          <span className={css.status}>{statusLabel(result.status)}</span>
        </header>
        {result.message !== '' && <p className={css.message}>{result.message}</p>}
        {result.error !== undefined && <p className={css.error}>{result.error}</p>}
        {result.audio.length > 0 && (
          <div className={css.audios}>
            {result.audio.map((audio, index) => (
              <div className={css.audioRow} key={audio.id ?? audio.url}>
                <audio
                  className={css.audio}
                  controls
                  preload="metadata"
                  src={audio.url}
                  onPlay={() => setActive(audio.url)}
                />
                <a className={css.download} href={audio.url} download={`generated-${index + 1}.${mimeExt(audio.mime)}`}>
                  下载
                </a>
              </div>
            ))}
          </div>
        )}
        {result.audio.length === 0 && result.status !== 'running' && <p className={css.empty}>未返回可播放的音频。</p>}
      </section>
    )
  }

  ctx.slots.inject('tool.call.toolview', function* () {
    yield ctx.slots.register({ name: 'tool.call.toolview', key: 'generate_audio' }, AudioToolView)
  })
}
