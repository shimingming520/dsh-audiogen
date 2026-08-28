/**
 * The AI 音频 panel: a compact audio-generation studio.
 */

import { useEffect, useMemo, useState } from 'react'
import type { AudiogenApi } from './api.ts'
import type { AudiogenScope } from './settings-scope.ts'
import { audioModelOptions } from './settings-scope.ts'
import { tt } from './helpers.ts'
import { GENERATE_API, HISTORY_API, type AudioMode, type GeneratedAudio, type HistoryEntry } from '../protocol.ts'
import css from './audio-panel.module.css'

function useConfig(scope: AudiogenScope) {
  const [value, setValue] = useState(scope.getSnapshot().value)
  useEffect(() => scope.subscribe(() => { setValue(scope.getSnapshot().value) }), [scope])
  return value
}

function useHistory(): { entries: HistoryEntry[]; reload: () => void; clear: () => void } {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const reload = (): void => {
    void fetch(HISTORY_API.list, { method: 'POST' })
      .then(async response => {
        const body = await response.json() as { ok?: boolean; history?: HistoryEntry[] }
        if (body.ok === true) setEntries(body.history ?? [])
      })
      .catch(() => { /* history is best-effort */ })
  }
  useEffect(() => { reload() }, [])
  const clear = (): void => {
    void fetch(HISTORY_API.clear, { method: 'POST' })
      .then(() => reload())
      .catch(() => { /* best-effort */ })
  }
  return { entries, reload, clear }
}

function dataUrlOf(audio: GeneratedAudio): string {
  return `data:${audio.mime};base64,${audio.b64}`
}

export function AudioGenPanel(props: { api: AudiogenApi; scope: AudiogenScope }) {
  const { api, scope } = props
  const config = useConfig(scope)
  const enabled = config?.enabled ?? true
  const modelOptions = audioModelOptions(config)
  const channels = config?.channels ?? []
  const connected = enabled && channels.some(channel => {
    const keyHeld = scope.getSecretSetSnapshot(`channelSecrets.${channel.id}`)
    return channel.apiUrl.trim() !== '' && keyHeld && channel.models.length > 0
  })

  const [mode, setMode] = useState<AudioMode>('tts')
  const [prompt, setPrompt] = useState('')
  const [model, setModel] = useState('')
  const [voice, setVoice] = useState('')
  const [speed, setSpeed] = useState('')
  const [duration, setDuration] = useState('')
  const [format, setFormat] = useState('mp3')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outputs, setOutputs] = useState<GeneratedAudio[]>([])
  const { entries, reload, clear } = useHistory()

  useEffect(() => {
    if (modelOptions.models.length > 0 && !modelOptions.models.includes(model)) {
      setModel(modelOptions.models[0]!)
    }
  }, [modelOptions.models, model])

  const submit = async (): Promise<void> => {
    if (prompt.trim() === '') {
      setError(tt('prompt.required'))
      return
    }
    setLoading(true)
    setError(null)
    try {
      const response = await api.generate({
        mode,
        model: (model || modelOptions.models[0]) ?? '',
        prompt: prompt.trim(),
        ...(voice.trim() !== '' ? { voice: voice.trim() } : {}),
        ...(speed.trim() !== '' ? { speed: Number(speed) } : {}),
        ...(duration.trim() !== '' ? { duration: Number(duration) } : {}),
        ...(format.trim() !== '' ? { format: format.trim() } : {}),
      })
      if (!response.ok) {
        setError(response.message ?? '生成失败')
        return
      }
      setOutputs(response.outputs ?? [])
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const modeLabel = useMemo(() => {
    if (mode === 'tts') return tt('mode.tts')
    if (mode === 'music') return tt('mode.music')
    return tt('mode.sfx')
  }, [mode])

  return (
    <div className={css.panel}>
      <header className={css.header}>
        <h2 className={css.title}>{tt('panel.title')}</h2>
        <span className={css.hint}>{modeLabel}</span>
      </header>
      <div className={css.layout}>
        <div className={css.form}>
          <div className={css.modeRow}>
            {(['tts', 'music', 'sfx'] as const).map(item => (
              <button
                key={item}
                type="button"
                className={css.modeButton}
                data-active={mode === item ? 'true' : 'false'}
                onClick={() => setMode(item)}
              >
                {item === 'tts' ? tt('mode.tts') : item === 'music' ? tt('mode.music') : tt('mode.sfx')}
              </button>
            ))}
          </div>
          <label className={css.label}>
            <span>{mode === 'tts' ? '文本' : '提示词'}</span>
            <textarea className={css.textarea} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={tt('prompt.placeholder')} />
          </label>
          <label className={css.label}>
            <span>{tt('model.label')}</span>
            <select className={css.select} value={model} onChange={event => setModel(event.target.value)}>
              {modelOptions.models.length === 0 ? <option value="">（请在设置中添加）</option> : null}
              {modelOptions.models.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          {mode === 'tts' ? (
            <label className={css.label}>
              <span>{tt('voice.label')}</span>
              <input className={css.input} value={voice} onChange={event => setVoice(event.target.value)} placeholder="alloy / 自定义音色" />
            </label>
          ) : null}
          <label className={css.label}>
            <span>{tt('speed.label')}</span>
            <input className={css.input} type="number" step="0.1" min="0.5" max="2" value={speed} onChange={event => setSpeed(event.target.value)} placeholder="1.0" />
          </label>
          <label className={css.label}>
            <span>{tt('duration.label')}</span>
            <input className={css.input} type="number" step="1" min="1" max="120" value={duration} onChange={event => setDuration(event.target.value)} placeholder="30" />
          </label>
          <label className={css.label}>
            <span>{tt('format.label')}</span>
            <select className={css.select} value={format} onChange={event => setFormat(event.target.value)}>
              <option value="mp3">mp3</option>
              <option value="wav">wav</option>
              <option value="flac">flac</option>
              <option value="ogg">ogg</option>
              <option value="pcm">pcm</option>
            </select>
          </label>
          {!connected && <p className={css.hint}>{tt('config.missing')}</p>}
          <button type="button" className={css.generate} disabled={loading || !connected} onClick={() => void submit()}>
            {loading ? tt('generating') : tt('generate')}
          </button>
        </div>
        <div className={css.result}>
          {error !== null ? <p className={css.error}>{error}</p> : null}
          {outputs.length === 0 ? <p className={css.empty}>{tt('result.empty')}</p> : (
            <>
              <p className={css.hint}>{tt('result.done', { count: outputs.length })}</p>
              <div className={css.audioList}>
                {outputs.map((audio, index) => (
                  <div className={css.audioCard} key={audio.id}>
                    <audio className={css.audio} controls preload="metadata" src={dataUrlOf(audio)} />
                    <a className={css.download} href={dataUrlOf(audio)} download={`generated-${index + 1}.${audio.mime.split('/')[1]?.replace('mpeg', 'mp3') ?? 'mp3'}`}>下载</a>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <aside className={css.history}>
          <div className={css.historyHeader}>
            <strong className={css.historyTitle}>{tt('history.title')}</strong>
            <button type="button" onClick={clear} style={{ border: 0, background: 'none', cursor: 'pointer', color: 'inherit', fontSize: 12 }}>清空</button>
          </div>
          {entries.length === 0 ? <p className={css.historyEmpty}>{tt('history.empty')}</p> : (
            <div>
              {entries.map(entry => (
                <div className={css.historyItem} key={entry.id}>
                  <div className={css.historyPrompt}>{entry.prompt}</div>
                  <div className={css.historyMeta}>{entry.mode} · {entry.model}{entry.channel ? ` · ${entry.channel}` : ''}</div>
                  {entry.audio.map((audio, index) => (
                    <audio key={index} className={css.historyAudio} controls preload="none" src={audio.url} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
