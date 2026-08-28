/**
 * Studio view: the generation form (left), result cards (center) and the
 * compact generation history (right). Owns the «加入资源库» interactions —
 * a pre-generation checkbox, a per-card save dialog, and a history star.
 */

import { useEffect, useMemo, useState } from 'react'
import type { AudiogenApi } from './api.ts'
import type { AudiogenConfig, AudiogenScope } from './settings-scope.ts'
import { audioModelOptions } from './settings-scope.ts'
import { tt } from './helpers.ts'
import {
  HISTORY_API,
  type AudioMode, type GenerateAudioRequest, type GeneratedAudio, type HistoryEntry, type LibraryEntry,
} from '../protocol.ts'
import { AudioPlayer } from './audio-player.tsx'
import { LibrarySaveDialog, type SaveDialogContext } from './library-save-dialog.tsx'
import { CheckIcon, DownloadIcon, StarIcon } from './icons.tsx'
import css from './audio-panel.module.css'

export interface StudioReuse {
  nonce: number
  mode: AudioMode
  voice?: string
  model?: string
  voiceId?: string
}

/** 每模型可覆盖的参数行（留空 = 自动，沿用上方全局配置）。 */
const OVERRIDE_ROWS: Array<{ key: string; label: string; type: 'text' | 'number' | 'select'; options?: string[]; placeholder?: string }> = [
  { key: 'format', label: '输出格式', type: 'select', options: ['mp3', 'wav', 'pcm', 'flac', 'ogg'], placeholder: '自动' },
  { key: 'duration', label: '时长(秒)', type: 'number', placeholder: '自动' },
  { key: 'voice', label: '音色', type: 'text', placeholder: '自动' },
  { key: 'speed', label: '语速', type: 'number', placeholder: '自动' },
  { key: 'emotion', label: '情绪', type: 'text', placeholder: '自动' },
  { key: 'sample_rate', label: '采样率', type: 'number', placeholder: '自动' },
  { key: 'bitrate', label: '码率', type: 'number', placeholder: '自动' },
  { key: 'lyrics', label: '歌词', type: 'text', placeholder: '自动' },
  { key: 'seed', label: 'seed', type: 'number', placeholder: '自动' },
  { key: 'steps', label: 'steps', type: 'number', placeholder: '自动' },
  { key: 'cfg_scale', label: 'cfg_scale', type: 'number', placeholder: '自动' },
]

/** 每模型覆盖值 → 请求字段的数值/类型转换（空值跳过）。 */
function overrideSpread(override: Record<string, string>): Partial<GenerateAudioRequest> {
  const out: Partial<GenerateAudioRequest> = {}
  const val = override.format?.trim() ?? ''
  if (val !== '') out.format = val
  const num = (key: string): number | undefined => {
    const raw = (override[key] ?? '').trim()
    if (raw === '') return undefined
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  const duration = num('duration')
  if (duration !== undefined) out.duration = duration
  const voice = override.voice?.trim() ?? ''
  if (voice !== '') out.voice = voice
  const speed = num('speed')
  if (speed !== undefined) out.speed = speed
  const emotion = override.emotion?.trim() ?? ''
  if (emotion !== '') out.emotion = emotion
  const sampleRate = num('sample_rate')
  if (sampleRate !== undefined) out.sampleRate = sampleRate
  const bitrate = num('bitrate')
  if (bitrate !== undefined) out.bitrate = bitrate
  const lyrics = override.lyrics?.trim() ?? ''
  if (lyrics !== '') out.lyrics = lyrics
  const seed = num('seed')
  if (seed !== undefined) out.seed = seed
  const steps = num('steps')
  if (steps !== undefined) out.steps = steps
  const cfgScale = num('cfg_scale')
  if (cfgScale !== undefined) out.cfgScale = cfgScale
  return out
}

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

function fileNameOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url, 'http://localhost').pathname.split('/').pop() ?? '')
  } catch {
    return ''
  }
}

/** Turn a history entry's audio refs into GeneratedAudio-shaped inputs. */
function audioRefsOfEntry(entry: HistoryEntry): GeneratedAudio[] {
  return entry.audio.map(audio => {
    const file = fileNameOf(audio.url)
    return {
      id: file.replace(/\.[a-z0-9]+$/i, ''),
      file,
      url: audio.url,
      mime: audio.mime,
      bytes: 0,
      b64: '',
      ...(audio.duration === undefined ? {} : { duration: audio.duration }),
      ...(audio.voiceId === undefined ? {} : { voiceId: audio.voiceId }),
    }
  })
}

function contextOfEntry(entry: HistoryEntry): SaveDialogContext {
  return {
    mode: entry.mode,
    prompt: entry.prompt,
    ...(entry.voice === undefined ? {} : { voice: entry.voice }),
    ...(entry.voiceId === undefined ? {} : { voiceId: entry.voiceId }),
    ...(entry.model === undefined ? {} : { model: entry.model }),
    ...(entry.channel === undefined ? {} : { channel: entry.channel }),
    ...(entry.channelId === undefined ? {} : { channelId: entry.channelId }),
    ...(entry.params === undefined ? {} : { params: entry.params }),
  }
}

interface SaveDialogState {
  files: GeneratedAudio[]
  context: SaveDialogContext
}

export function StudioView(props: {
  api: AudiogenApi
  scope: AudiogenScope
  config?: AudiogenConfig
  reuse?: StudioReuse | null
  onLibraryChanged: () => void
  showToast: (text: string) => void
}): React.JSX.Element {
  const { api, scope, config, reuse } = props
  const effectiveConfig = useConfig(scope)
  const cfg = (config ?? effectiveConfig)
  const enabled = cfg?.enabled ?? true
  const modelOptions = audioModelOptions(cfg)
  const channels = cfg?.channels ?? []
  const connected = enabled && channels.some(channel => {
    const keyHeld = scope.getSecretSetSnapshot(`channelSecrets.${channel.id}`)
    return channel.apiUrl.trim() !== '' && keyHeld && (channel.models.length > 0 || channel.preset === 'minimax')
  })

  const [mode, setMode] = useState<AudioMode>('tts')
  const [prompt, setPrompt] = useState('')
  const [previewText, setPreviewText] = useState('')
  const [model, setModel] = useState('')
  // 多模型对比：同一提示词逐模型生成
  const [selectedModels, setSelectedModels] = useState<string[]>([])
  // 每模型参数覆盖（留空 = 自动沿用全局配置）
  const [overrides, setOverrides] = useState<Record<string, Record<string, string>>>({})
  const [voice, setVoice] = useState('')
  const [speed, setSpeed] = useState('')
  const [duration, setDuration] = useState('')
  const [lyrics, setLyrics] = useState('')
  const [instrumental, setInstrumental] = useState(false)
  // ElevenLabs 音效参数
  const [loop, setLoop] = useState(false)
  const [promptInfluence, setPromptInfluence] = useState('')
  const [format, setFormat] = useState('mp3')
  // MiniMax TTS 高级参数（其他厂商忽略）
  const [emotion, setEmotion] = useState('')
  const [vol, setVol] = useState('')
  const [pitch, setPitch] = useState('')
  const [toneText, setToneText] = useState('')
  const [sampleRate, setSampleRate] = useState('')
  const [bitrate, setBitrate] = useState('')
  const [audioChannel, setAudioChannel] = useState('')
  const [subtitle, setSubtitle] = useState(false)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<Array<{ model: string; outputs: GeneratedAudio[]; error?: string }>>([])
  // 资源库
  const [saveToLibrary, setSaveToLibrary] = useState(cfg?.autoSaveToLibrary === true)
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const [saveDialog, setSaveDialog] = useState<SaveDialogState | null>(null)
  const { entries, reload, clear } = useHistory()
  // 音色设计模式的厂商/渠道选择（默认渠道）
  const [designChannelId, setDesignChannelId] = useState('')

  const isMiniMaxChannel = useMemo(() => {
    const target = channels.find(candidate => candidate.id === modelOptions.defaultChannelId) ?? channels[0]
    return target !== undefined && (target.preset === 'minimax' || /minimax/i.test(target.apiUrl))
  }, [channels, modelOptions.defaultChannelId])

  useEffect(() => {
    if (channels.length === 0) return
    if (designChannelId === '' || !channels.some(candidate => candidate.id === designChannelId)) {
      setDesignChannelId(modelOptions.defaultChannelId ?? channels[0]!.id)
    }
  }, [channels, modelOptions.defaultChannelId, designChannelId])

  const visibleModels = useMemo(() => {
    if (mode === 'voice_design') return []
    return modelOptions.models
      .filter(entry => entry.category === undefined || entry.category === 'tts' && mode === 'tts' || entry.category === mode)
      .map(entry => entry.alias)
  }, [modelOptions.models, mode])

  useEffect(() => {
    if (visibleModels.length === 0) return
    setSelectedModels(current => {
      const valid = current.filter(item => visibleModels.includes(item))
      if (valid.length > 0) return valid
      return [visibleModels[0]!]
    })
  }, [visibleModels])

  // 每模型覆盖值随勾选模型收缩（保留仍在勾选中的覆盖）
  useEffect(() => {
    setOverrides(current => {
      const next: Record<string, Record<string, string>> = {}
      for (const alias of selectedModels) {
        if (current[alias] !== undefined) next[alias] = current[alias]!
      }
      return next
    })
  }, [selectedModels])

  const setOverrideValue = (model: string, key: string, value: string): void => {
    setOverrides(current => ({
      ...current,
      [model]: { ...(current[model] ?? {}), [key]: value },
    }))
  }

  useEffect(() => {
    if (visibleModels.length > 0 && !visibleModels.includes(model)) {
      setModel(visibleModels[0]!)
    }
  }, [visibleModels, model])

  // 资源库「用此音色」回填
  useEffect(() => {
    if (reuse === undefined || reuse === null) return
    setMode(reuse.mode)
    if (reuse.voiceId !== undefined || reuse.voice !== undefined) setVoice(reuse.voiceId ?? reuse.voice ?? '')
    if (reuse.model !== undefined && reuse.model !== '') {
      setModel(reuse.model)
      setSelectedModels([reuse.model])
    }
  }, [reuse?.nonce])

  const submit = async (): Promise<void> => {
    if (prompt.trim() === '') {
      setError(tt('prompt.required'))
      return
    }
    // 待生成模型列表：音色设计单渠道；其余支持多模型（同一提示词逐一生成，供对比）。
    const targets = mode === 'voice_design'
      ? ['']
      : selectedModels.length > 0
        ? selectedModels
        : (model !== '' ? [model] : visibleModels.length > 0 ? [visibleModels[0]!] : [])
    if (targets.length === 0) {
      setError('当前模式暂无可用模型')
      return
    }
    setLoading(true)
    setError(null)
    setProgress('')
    const gathered: Array<{ model: string; outputs: GeneratedAudio[]; error?: string }> = []
    let anySaved = false
    try {
      for (const [index, target] of targets.entries()) {
        setProgress(`生成中 ${index + 1}/${targets.length}（${target || '音色设计'}）…`)
        let response
        try {
          response = await api.generate({
            mode,
            model: target,
            prompt: prompt.trim(),
            saveToLibrary,
            ...(mode === 'voice_design' && designChannelId !== '' ? { channelId: designChannelId } : {}),
            ...(previewText.trim() !== '' ? { previewText: previewText.trim() } : {}),
            ...(voice.trim() !== '' ? { voice: voice.trim() } : {}),
            ...(speed.trim() !== '' ? { speed: Number(speed) } : {}),
            ...(duration.trim() !== '' ? { duration: Number(duration) } : {}),
            ...(lyrics.trim() !== '' ? { lyrics: lyrics.trim() } : {}),
            ...(instrumental ? { isInstrumental: true } : {}),
            ...(loop ? { loop: true } : {}),
            ...(promptInfluence.trim() !== '' ? { promptInfluence: Number(promptInfluence) } : {}),
            ...(format.trim() !== '' ? { format: format.trim() } : {}),
            ...(emotion.trim() !== '' ? { emotion: emotion.trim() } : {}),
            ...(vol.trim() !== '' ? { vol: Number(vol) } : {}),
            ...(pitch.trim() !== '' ? { pitch: Number(pitch) } : {}),
            ...(toneText.trim() !== '' ? { pronunciationTone: toneText.split('\n').map(item => item.trim()).filter(item => item !== '') } : {}),
            ...(sampleRate.trim() !== '' ? { sampleRate: Number(sampleRate) } : {}),
            ...(bitrate.trim() !== '' ? { bitrate: Number(bitrate) } : {}),
            ...(audioChannel.trim() !== '' ? { audioChannel: Number(audioChannel) } : {}),
            ...(subtitle ? { subtitleEnable: true } : {}),
            // 每模型参数覆盖（后置覆盖全局；仅音色设计外生效）
            ...(target === '' ? {} : overrideSpread(overrides[target] ?? {})),
          })
        } catch (err) {
          gathered.push({ model: target, outputs: [], error: err instanceof Error ? err.message : String(err) })
          continue
        }
        if (!response.ok) {
          gathered.push({ model: target, outputs: [], error: response.message ?? '生成失败' })
          continue
        }
        const generated = response.outputs ?? []
        gathered.push({ model: target, outputs: generated })
        if ((response.resources?.length ?? 0) > 0 && saveToLibrary) anySaved = true
      }
      setResults(gathered)
      if (anySaved) {
        setSavedIds(current => new Set([...current, ...gathered.flatMap(group => group.outputs.map(item => item.id))]))
        props.showToast('已保存到资源库')
        props.onLibraryChanged()
      }
      const failed = gathered.filter(group => group.error !== undefined && group.outputs.length === 0)
      if (failed.length > 0 && failed.length === gathered.length) {
        setError(failed.map(group => `「${group.model || '音色设计'}」${group.error}`).join('；'))
      }
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
      setProgress('')
    }
  }

  const openSaveDialog = (files: GeneratedAudio[], context: SaveDialogContext): void => {
    setSaveDialog({ files, context })
  }

  const onDialogSaved = (entry: LibraryEntry): void => {
    if (saveDialog !== null) {
      setSavedIds(current => new Set([...current, ...saveDialog.files.map(file => file.id)]))
    }
    setSaveDialog(null)
    props.showToast(`已保存「${entry.name}」`)
    props.onLibraryChanged()
  }

  const modeLabel = useMemo(() => {
    if (mode === 'tts') return tt('mode.tts')
    if (mode === 'music') return tt('mode.music')
    if (mode === 'sfx') return tt('mode.sfx')
    return tt('mode.voiceDesign')
  }, [mode])

  const needModel = mode !== 'voice_design'

  return (
    <div className={css.studio}>
      <div className={css.formCol}>
        <div className={css.modeRow}>
          {(['tts', 'music', 'sfx', 'voice_design'] as const).map(item => (
            <button
              key={item}
              type="button"
              className={css.modeButton}
              data-active={mode === item ? 'true' : 'false'}
              onClick={() => setMode(item)}
            >
              {item === 'tts' ? tt('mode.tts') : item === 'music' ? tt('mode.music') : item === 'sfx' ? tt('mode.sfx') : tt('mode.voiceDesign')}
            </button>
          ))}
        </div>

        <label className={css.label}>
          <span>{mode === 'voice_design' ? '音色描述' : mode === 'tts' ? '文本' : '提示词'}</span>
          <textarea className={css.textarea} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={tt('prompt.placeholder')} />
        </label>

        {mode === 'voice_design' ? (
          <>
            <label className={css.label}>
              <span>厂商 / 渠道</span>
              <select className={css.input} value={designChannelId} onChange={event => setDesignChannelId(event.target.value)}>
                {channels.length === 0 ? <option value="">（尚未配置渠道）</option> : null}
                {channels.map(candidate => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}（{candidate.preset === 'minimax' ? 'MiniMax' : candidate.preset === 'elevenlabs' ? 'ElevenLabs' : candidate.preset || '自定义'}）
                  </option>
                ))}
              </select>
            </label>
            <p className={css.hint}>MiniMax：/v1/voice_design；ElevenLabs：/v1/text-to-voice/design（试听文本 100-1000 字符，过短将自动生成）</p>
            <label className={css.label}>
              <span>试听文本</span>
              <input className={css.input} value={previewText} onChange={event => setPreviewText(event.target.value)} placeholder="你好，这是新设计的音色试听。" />
            </label>
          </>
        ) : null}

        {needModel ? (
          <label className={css.label}>
            <span>{tt('model.label')}（可多选，同一提示词逐个生成以对比）</span>
            <div className={css.modelCheckList}>
              {visibleModels.length === 0 ? <p className={css.hint}>（当前模式暂无可用模型）</p> : null}
              {visibleModels.map(item => (
                <label key={item} className={css.checkbox}>
                  <input
                    type="checkbox"
                    checked={selectedModels.includes(item)}
                    onChange={event => {
                      const checked = event.target.checked
                      setSelectedModels(current => checked ? [...new Set([...current, item])] : current.filter(alias => alias !== item))
                      if (checked && (model === '' || !visibleModels.includes(model))) setModel(item)
                    }}
                  />
                  <span title="点击生成对比">{item}</span>
                </label>
              ))}
            </div>
          </label>
        ) : null}

        {needModel && selectedModels.length > 0 ? (
          <details className={css.advanced}>
            <summary>每模型参数覆盖（默认自动：沿用上方相同配置，如输出格式均为 mp3）</summary>
            <div className={css.overrideTable}>
              <div className={css.overrideRow}>
                <span className={`${css.overrideCell} ${css.overrideCellHead}`} />
                {selectedModels.map(item => <span key={item} className={`${css.overrideCell} ${css.overrideCellHead}`}>{item}</span>)}
              </div>
              {OVERRIDE_ROWS.map(row => (
                <div key={row.key} className={css.overrideRow}>
                  <span className={css.overrideCell} title={row.label}>{row.label}</span>
                  {selectedModels.map(item => {
                    const value = overrides[item]?.[row.key] ?? ''
                    return (
                      <span key={item} className={css.overrideCell}>
                        {row.type === 'select' ? (
                          <select className={css.input} value={value} onChange={event => setOverrideValue(item, row.key, event.target.value)}>
                            <option value="">自动</option>
                            {row.options!.map(option => <option key={option} value={option}>{option}</option>)}
                          </select>
                        ) : (
                          <input
                            className={css.input}
                            type={row.type === 'number' ? 'number' : 'text'}
                            value={value}
                            placeholder={row.placeholder ?? '自动'}
                            onChange={event => setOverrideValue(item, row.key, event.target.value)}
                          />
                        )}
                      </span>
                    )
                  })}
                </div>
              ))}
            </div>
          </details>
        ) : null}

        {mode === 'tts' ? (
          <label className={css.label}>
            <span>{tt('voice.label')}</span>
            <input className={css.input} value={voice} onChange={event => setVoice(event.target.value)} placeholder={isMiniMaxChannel ? 'male-qn-qingse / female-shaonv' : 'alloy / 自定义音色'} />
          </label>
        ) : null}

        {mode === 'tts' ? (
          <label className={css.label}>
            <span>{tt('speed.label')}</span>
            <input className={css.input} type="number" step="0.1" min="0.5" max="2" value={speed} onChange={event => setSpeed(event.target.value)} placeholder="1.0" />
          </label>
        ) : null}

        {mode === 'tts' && isMiniMaxChannel ? (
          <details className={css.advanced}>
            <summary>MiniMax 高级参数</summary>
            <label className={css.label}>
              <span>情绪 emotion</span>
              <input className={css.input} value={emotion} onChange={event => setEmotion(event.target.value)} placeholder="happy / sad / angry / nervous…" />
            </label>
            <div className={css.row}>
              <label className={css.label}>
                <span>音量 vol (0-10)</span>
                <input className={css.input} type="number" min="0" max="10" step="0.5" value={vol} onChange={event => setVol(event.target.value)} placeholder="1" />
              </label>
              <label className={css.label}>
                <span>音调 pitch (-12~12)</span>
                <input className={css.input} type="number" min="-12" max="12" value={pitch} onChange={event => setPitch(event.target.value)} placeholder="0" />
              </label>
            </div>
            <div className={css.row}>
              <label className={css.label}>
                <span>采样率</span>
                <input className={css.input} type="number" min="16000" max="48000" step="8000" value={sampleRate} onChange={event => setSampleRate(event.target.value)} placeholder="32000" />
              </label>
              <label className={css.label}>
                <span>码率 bps</span>
                <input className={css.input} type="number" min="64000" max="320000" step="8000" value={bitrate} onChange={event => setBitrate(event.target.value)} placeholder="128000" />
              </label>
              <label className={css.label}>
                <span>声道</span>
                <select className={css.input} value={audioChannel} onChange={event => setAudioChannel(event.target.value)}>
                  <option value="">默认(1)</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                </select>
              </label>
            </div>
            <label className={css.label}>
              <span>发音词典（每行一条："文字/读音"）</span>
              <textarea className={css.textarea} value={toneText} onChange={event => setToneText(event.target.value)} placeholder={'处理/(chu3)(li3)\n危险/dangerous'} />
            </label>
            <label className={css.checkbox}>
              <input type="checkbox" checked={subtitle} onChange={event => setSubtitle(event.target.checked)} />
              <span>生成字幕 subtitle_enable</span>
            </label>
          </details>
        ) : null}

        {mode === 'music' || mode === 'sfx' ? (
          <label className={css.label}>
            <span>{tt('duration.label')}</span>
            <input className={css.input} type="number" step="1" min="1" max="120" value={duration} onChange={event => setDuration(event.target.value)} placeholder="30" />
          </label>
        ) : null}

        {mode === 'sfx' ? (
          <>
            <label className={css.checkbox}>
              <input type="checkbox" checked={loop} onChange={event => setLoop(event.target.checked)} />
              <span>循环音效 loop（无缝循环，需 eleven_text_to_sound_v2）</span>
            </label>
            <label className={css.label}>
              <span>提示词影响度 prompt_influence (0-1)</span>
              <input className={css.input} type="number" step="0.1" min="0" max="1" value={promptInfluence} onChange={event => setPromptInfluence(event.target.value)} placeholder="0.3" />
            </label>
          </>
        ) : null}

        {mode === 'music' ? (
          <>
            <label className={css.label}>
              <span>歌词（纯音乐模式可留空；多段用空行分隔）</span>
              <textarea className={css.textarea} value={lyrics} onChange={event => setLyrics(event.target.value)} placeholder={'第一段歌词…\n\n第二段歌词…'} />
            </label>
            <label className={css.checkbox}>
              <input type="checkbox" checked={instrumental} onChange={event => setInstrumental(event.target.checked)} />
              <span>纯音乐（无歌词/人声）is_instrumental</span>
            </label>
            <div className={css.row}>
              <label className={css.label}>
                <span>采样率</span>
                <select className={css.input} value={sampleRate} onChange={event => setSampleRate(event.target.value)}>
                  <option value="">默认（44100）</option>
                  <option value="16000">16000</option>
                  <option value="24000">24000</option>
                  <option value="32000">32000</option>
                  <option value="44100">44100</option>
                </select>
              </label>
              <label className={css.label}>
                <span>码率 bps</span>
                <select className={css.input} value={bitrate} onChange={event => setBitrate(event.target.value)}>
                  <option value="">默认（256000）</option>
                  <option value="32000">32000</option>
                  <option value="64000">64000</option>
                  <option value="128000">128000</option>
                  <option value="256000">256000</option>
                </select>
              </label>
            </div>
          </>
        ) : null}

        {needModel ? (
          <label className={css.label}>
            <span>{tt('format.label')}</span>
            <select className={css.input} value={format} onChange={event => setFormat(event.target.value)}>
              <option value="mp3">mp3</option>
              <option value="wav">wav</option>
              {mode === 'tts' ? (
                <>
                  <option value="flac">flac</option>
                  <option value="ogg">ogg</option>
                </>
              ) : null}
              <option value="pcm">pcm</option>
            </select>
          </label>
        ) : null}

        <label className={css.checkbox} title="生成完成后自动保存到资源库；也可在设置中开启全部自动保存">
          <input type="checkbox" checked={saveToLibrary} onChange={event => setSaveToLibrary(event.target.checked)} />
          <span>生成后保存到资源库</span>
        </label>

        {!connected && <p className={css.hint}>{tt('config.missing')}</p>}
        <button type="button" className={css.generate} disabled={loading || !connected || (needModel && visibleModels.length === 0)} onClick={() => void submit()}>
          {loading ? (progress !== '' ? progress : tt('generating')) : tt('generate')}
        </button>
      </div>

      <div className={css.resultCol}>
        {error !== null ? <p className={css.error}>{error}</p> : null}
        {results.length === 0 ? (
          <div className={css.resultEmpty}>
            <span className={css.resultEmptyIcon}>🎵</span>
            <p>{tt('result.empty')}</p>
            <p className={css.resultEmptyHint}>生成结果将在这里播放、下载，并可一键加入资源库</p>
          </div>
        ) : (
          <>
            <div className={css.resultMeta}>
              <span>{tt('result.done', { count: results.reduce((sum, group) => sum + group.outputs.length, 0) })}</span>
              <span className={css.resultModeChip}>{modeLabel}</span>
            </div>
            <div className={css.resultGroups}>
              {results.map((group, groupIndex) => (
                <div className={css.resultGroup} key={`${group.model}-${groupIndex}`}>
                  <div className={css.resultGroupHead}>
                    <span className={css.resultGroupChip}>{group.model || '音色设计'}</span>
                    {group.error !== undefined ? <span className={css.resultGroupError}>生成失败：{group.error}</span> : null}
                    {group.outputs.length > 0 ? <span className={css.resultGroupCount}>{group.outputs.length} 段</span> : null}
                  </div>
                  {group.outputs.length > 0 ? (
                    <div className={css.audioList}>
                      {group.outputs.map((audio, index) => {
                        const saved = savedIds.has(audio.id)
                        return (
                          <div className={css.audioCard} key={audio.id} data-saved={saved ? 'true' : 'false'}>
                            <div className={css.audioCardHead}>
                              {audio.voiceId !== undefined ? <span className={css.voiceIdChip} title="新音色 ID">新音色 {audio.voiceId}</span> : null}
                              {saved ? (
                                <span className={css.savedChip}><CheckIcon /> 已入库</span>
                              ) : null}
                              <span className={css.audioCardIndex}>#{index + 1}</span>
                            </div>
                            <AudioPlayer src={dataUrlOf(audio)} itemKey={audio.id} />
                            <div className={css.audioCardActions}>
                              <a className={css.ghostButton} href={dataUrlOf(audio)} download={`generated-${groupIndex + 1}-${index + 1}.${audio.mime.split('/')[1]?.replace('mpeg', 'mp3') ?? 'mp3'}`}>
                                <DownloadIcon /> 下载
                              </a>
                              {saved ? (
                                <button type="button" className={css.ghostButton} onClick={() => props.showToast('该音频已加入资源库')}>
                                  <CheckIcon /> 已入库
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className={css.ghostButton}
                                  onClick={() => openSaveDialog([audio], {
                                    mode,
                                    prompt: prompt.trim(),
                                    ...(voice.trim() !== '' ? { voice: voice.trim() } : {}),
                                    ...(audio.voiceId === undefined ? {} : { voiceId: audio.voiceId }),
                                    ...(group.model !== '' ? { model: group.model } : {}),
                                    ...(channels.length > 0 ? { channel: channels.find(candidate => candidate.id === (mode === 'voice_design' ? designChannelId : modelOptions.defaultChannelId))?.name ?? channels[0]?.name ?? '' } : {}),
                                    params: {
                                      mode,
                                      model: mode === 'voice_design' ? '' : group.model,
                                      prompt: prompt.trim(),
                                      ...(voice.trim() !== '' ? { voice: voice.trim() } : {}),
                                      ...(speed.trim() !== '' ? { speed: Number(speed) } : {}),
                                      ...(duration.trim() !== '' ? { duration: Number(duration) } : {}),
                                      ...(format.trim() !== '' ? { format: format.trim() } : {}),
                                    },
                                  })}
                                >
                                  <StarIcon /> 加入资源库
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <aside className={css.historyCol}>
        <div className={css.historyHeader}>
          <strong className={css.historyTitle}>{tt('history.title')}</strong>
          <button type="button" className={css.historyClear} onClick={clear}>清空</button>
        </div>
        {entries.length === 0 ? <p className={css.historyEmpty}>{tt('history.empty')}</p> : (
          <div className={css.historyList}>
            {entries.map(entry => (
              <div className={css.historyItem} key={entry.id}>
                <div className={css.historyPrompt}>{entry.prompt}</div>
                <div className={css.historyMeta}>{entry.mode} · {entry.model}{entry.channel ? ` · ${entry.channel}` : ''}</div>
                {entry.audio.map((audio, index) => (
                  <AudioPlayer key={index} src={audio.url} compact itemKey={`${entry.id}-${index}`} />
                ))}
                <div className={css.historyActions}>
                  <button type="button" className={css.historyAction} onClick={() => openSaveDialog(audioRefsOfEntry(entry), contextOfEntry(entry))}>
                    <StarIcon /> 入库
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </aside>

      {saveDialog !== null ? (
        <LibrarySaveDialog
          api={api}
          files={saveDialog.files}
          context={saveDialog.context}
          onClose={() => setSaveDialog(null)}
          onSaved={onDialogSaved}
        />
      ) : null}
    </div>
  )
}
