/**
 * Studio view: the generation form (left), result cards (center) and the
 * compact generation history (right). Owns the «加入资源库» interactions —
 * a pre-generation checkbox, a per-card save dialog, and a history star —
 * plus a model-comparison mode that runs the same prompt across several
 * models and shows one result group per model.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { AudiogenApi } from './api.ts'
import type { AudiogenConfig, AudiogenScope } from './settings-scope.ts'
import { audioModelOptions } from './settings-scope.ts'
import { globalFieldSpecs, overrideRowSpecs, presetLabel, type FieldSpec } from './field-specs.ts'
import { tt } from './helpers.ts'
import {
  HISTORY_API,
  type AudioMode, type GeneratedAudio, type GenerateAudioRequest, type HistoryEntry, type LibraryEntry,
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

/** One row of a model-comparison run. */
interface CompareResult {
  model: string
  state: 'waiting' | 'running' | 'done' | 'error' | 'cancelled'
  outputs: GeneratedAudio[]
  error?: string
}

/** 一个生成任务（单模型或模型对比）：提交即建任务，非阻塞；可取消、可并行。 */
interface StudioTask {
  id: string
  mode: AudioMode
  kind: 'single' | 'compare'
  prompt?: string
  label: string
  status: 'running' | 'done' | 'failed' | 'cancelled'
  progress: { done: number; total: number; current: string }
  startedAt: number
  finishedAt?: number
  groups: CompareResult[]
  error?: string
}

/** 每模型覆盖值 → 请求字段的数值/类型转换（空值跳过）。 */
function overrideSpread(override: Record<string, string>): Partial<GenerateAudioRequest> {
  const out: Partial<GenerateAudioRequest> = {}
  const val = (override.format ?? '').trim()
  if (val !== '') out.format = val
  const num = (key: string): number | undefined => {
    const raw = (override[key] ?? '').trim()
    if (raw === '') return undefined
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  const duration = num('duration')
  if (duration !== undefined) out.duration = duration
  const voice = (override.voice ?? '').trim()
  if (voice !== '') out.voice = voice
  const speed = num('speed')
  if (speed !== undefined) out.speed = speed
  const emotion = (override.emotion ?? '').trim()
  if (emotion !== '') out.emotion = emotion
  const sampleRate = num('sample_rate')
  if (sampleRate !== undefined) out.sampleRate = sampleRate
  const bitrate = num('bitrate')
  if (bitrate !== undefined) out.bitrate = bitrate
  const lyrics = (override.lyrics ?? '').trim()
  if (lyrics !== '') out.lyrics = lyrics
  const seed = num('seed')
  if (seed !== undefined) out.seed = seed
  const steps = num('steps')
  if (steps !== undefined) out.steps = steps
  const cfgScale = num('cfg_scale')
  if (cfgScale !== undefined) out.cfgScale = cfgScale
  return out
}

/** 历史记录分组 tab（全部 + 按模式）。 */
type HistoryTab = 'all' | AudioMode

function taskIdOf(entry: HistoryEntry): string {
  const params = entry.params as Record<string, unknown> | undefined
  return typeof params?.taskId === 'string' && params.taskId !== '' ? params.taskId : ''
}

function modeLabelOf(mode: AudioMode): string {
  if (mode === 'tts') return tt('mode.tts')
  if (mode === 'music') return tt('mode.music')
  if (mode === 'sfx') return tt('mode.sfx')
  return tt('mode.voiceDesign')
}

/** 历史时间显示（YYYY-MM-DD HH:mm）。 */
function formatClock(timestamp: number): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function useConfig(scope: AudiogenScope) {
  const [value, setValue] = useState(scope.getSnapshot().value)
  useEffect(() => scope.subscribe(() => { setValue(scope.getSnapshot().value) }), [scope])
  return value
}

function useHistory(): { entries: HistoryEntry[]; reload: () => void; clear: () => void } {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const reload = (): void => {
    void fetch(HISTORY_API.list, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
      .then(async response => {
        const body = await response.json() as { ok?: boolean; history?: HistoryEntry[] }
        if (body.ok === true) setEntries(body.history ?? [])
      })
      .catch(() => { /* history is best-effort */ })
  }
  useEffect(() => { reload() }, [])
  const clear = (): void => {
    void fetch(HISTORY_API.clear, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
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
  // 提示词增强
  const [enhancing, setEnhancing] = useState(false)
  const [enhancePreview, setEnhancePreview] = useState<string | null>(null)
  // Stable Audio 参数（仅 Stability 渠道显示）
  const [seed, setSeed] = useState('')
  const [steps, setSteps] = useState('')
  const [cfgScale, setCfgScale] = useState('')
  const [error, setError] = useState<string | null>(null)
  // 任务列表：提交即建任务，非阻塞；可同时存在多个进行中的任务。
  const [tasks, setTasks] = useState<StudioTask[]>([])
  const tasksRef = useRef<StudioTask[]>([])
  useEffect(() => { tasksRef.current = tasks }, [tasks])
  const taskControllers = useRef(new Map<string, AbortController[]>())
  // 资源库
  const [saveToLibrary, setSaveToLibrary] = useState(cfg?.autoSaveToLibrary === true)
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const [saveDialog, setSaveDialog] = useState<SaveDialogState | null>(null)
  // 历史记录分类 tab
  const [historyTab, setHistoryTab] = useState<HistoryTab>('all')
  // 模型对比
  const [compareMode, setCompareMode] = useState(false)
  const [compareModels, setCompareModels] = useState<string[]>([])
  // 每模型参数覆盖（留空 = 自动沿用全局）
  const [overrides, setOverrides] = useState<Record<string, Record<string, string>>>({})
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

  // 当前模型所属渠道 preset（单模型模式）；对比模式为所选模型渠道集合。
  const currentPreset = useMemo(() => {
    if (mode === 'voice_design') return channels.find(candidate => candidate.id === designChannelId)?.preset ?? ''
    const picked = modelOptions.models.find(entry => entry.alias === model) ?? modelOptions.models.find(entry => entry.alias === (visibleModels[0] ?? ''))
    return picked?.preset ?? ''
  }, [mode, model, visibleModels, modelOptions.models, channels, designChannelId])

  const fieldPresets = useMemo(() => {
    if (mode === 'voice_design') return []
    if (compareMode) {
      const presets: string[] = []
      for (const alias of compareModels) {
        const entry = modelOptions.models.find(candidate => candidate.alias === alias)
        if (entry !== undefined && !presets.includes(entry.preset)) presets.push(entry.preset)
      }
      if (presets.length === 0) return [currentPreset].filter(value => value !== '')
      return presets
    }
    return [currentPreset].filter(value => value !== '')
  }, [mode, compareMode, compareModels, modelOptions.models, currentPreset])

  // 按（模式 × 渠道集合）计算全局字段：对比模式只留共有字段，独有字段在覆盖矩阵中。
  const globalSpecs = useMemo(() => globalFieldSpecs(mode, fieldPresets), [mode, fieldPresets])

  // 模型下拉按渠道分组。
  const groupedModels = useMemo(() => {
    const groups: Array<{ channelId: string; channelName: string; models: Array<{ alias: string }> }> = []
    for (const entry of modelOptions.models) {
      let group = groups.find(candidate => candidate.channelId === entry.channelId)
      if (group === undefined) {
        group = { channelId: entry.channelId, channelName: entry.channelName, models: [] }
        groups.push(group)
      }
      group.models.push({ alias: entry.alias })
    }
    return groups.map(group => ({ ...group, models: group.models.filter(entry => visibleModels.includes(entry.alias)) })).filter(group => group.models.length > 0)
  }, [modelOptions.models, visibleModels])

  useEffect(() => {
    if (visibleModels.length > 0 && !visibleModels.includes(model)) {
      setModel(visibleModels[0]!)
    }
  }, [visibleModels, model])

  // 切模式时清空对比结果（参数含义变了）
  useEffect(() => {
    setCompareModels(current => current.filter(item => visibleModels.includes(item)))
  }, [mode, visibleModels])

  // 进入对比模式时确保至少选中 2 个有效模型
  useEffect(() => {
    if (!compareMode) return
    setCompareModels(current => {
      const valid = current.filter(item => visibleModels.includes(item))
      const rest = visibleModels.filter(item => !valid.includes(item))
      while (valid.length < 2 && rest.length > 0) valid.push(rest.shift()!)
      return valid
    })
  }, [compareMode, visibleModels])

  // 资源库「用此音色」回填
  useEffect(() => {
    if (reuse === undefined || reuse === null) return
    setMode(reuse.mode)
    if (reuse.voiceId !== undefined || reuse.voice !== undefined) setVoice(reuse.voiceId ?? reuse.voice ?? '')
    if (reuse.model !== undefined && reuse.model !== '') setModel(reuse.model)
  }, [reuse?.nonce])

  /** Build the shared generation request for one model. */
  const requestOf = (modelName: string): GenerateAudioRequest => ({
    mode,
    model: modelName,
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
    ...(seed.trim() !== '' ? { seed: Number(seed) } : {}),
    ...(steps.trim() !== '' ? { steps: Number(steps) } : {}),
    ...(cfgScale.trim() !== '' ? { cfgScale: Number(cfgScale) } : {}),
  })

  const applyResponse = (response: Awaited<ReturnType<AudiogenApi['generate']>>): GeneratedAudio[] => {
    const generated = response.outputs ?? []
    if ((response.resources?.length ?? 0) > 0 && saveToLibrary) {
      setSavedIds(current => new Set([...current, ...generated.map(item => item.id)]))
      props.showToast('已保存到资源库')
      props.onLibraryChanged()
    }
    reload()
    return generated
  }

  const patchTask = (taskId: string, fn: (task: StudioTask) => StudioTask): void => {
    setTasks(current => current.map(task => task.id === taskId ? fn(task) : task))
  }

  /** 提交即建任务：非阻塞，可继续发起其他生成；并发由宿主「最大并发生成数」闸门控制。 */
  const submit = (): void => {
    if (prompt.trim() === '') {
      setError(tt('prompt.required'))
      return
    }
    const isCompare = compareMode && needModel
    const models = isCompare ? (compareModels.length >= 2 ? compareModels : visibleModels.slice(0, 2)) : []
    if (isCompare && models.length < 2) {
      setError('请至少选择 2 个模型进行对比')
      return
    }
    const singleModel = isCompare ? '' : (model || visibleModels[0] || '')
    if (!isCompare && singleModel === '') {
      setError('当前模式暂无可用模型')
      return
    }
    setError(null)
    const taskId = `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const planModels = isCompare ? models : [singleModel]
    // 参数快照：任务启动后表单再变化不影响本次生成；每模型再叠加各自覆盖。
    const plan = planModels.map(modelName => ({
      model: modelName,
      request: { ...requestOf(modelName), taskId, ...overrideSpread(overrides[modelName] ?? {}) },
    }))
    const task: StudioTask = {
      id: taskId,
      mode,
      prompt: prompt.trim(),
      kind: isCompare ? 'compare' : 'single',
      label: isCompare ? `对比 ${models.join(' / ')}` : singleModel,
      status: 'running',
      progress: { done: 0, total: plan.length, current: '' },
      startedAt: Date.now(),
      groups: planModels.map(modelName => ({ model: modelName, state: 'waiting' as const, outputs: [] as GeneratedAudio[] })),
    }
    setTasks(current => [task, ...current])
    void runTask(taskId, plan)
  }

  /** 执行一个任务：并行发起（宿主闸门限流），进度回写；支持取消。 */
  const runTask = async (taskId: string, plan: Array<{ model: string; request: GenerateAudioRequest }>): Promise<void> => {
    const controllers: AbortController[] = []
    taskControllers.current.set(taskId, controllers)
    const taskIsFinished = (): 'running' | 'cancelled' | 'pending' => {
      const task = tasksRef.current.find(candidate => candidate.id === taskId)
      if (task === undefined) return 'pending'
      if (task.status === 'cancelled') return 'cancelled'
      return 'running'
    }
    await Promise.allSettled(plan.map(async (step) => {
      const controller = new AbortController()
      controllers.push(controller)
      patchTask(taskId, task => ({
        ...task,
        progress: { ...task.progress, current: step.model },
        groups: task.groups.map(group => group.model === step.model ? { ...group, state: 'running' as const, error: undefined } : group),
      }))
      try {
        const response = await api.generate(step.request, controller.signal)
        if (!response.ok) throw new Error(response.message ?? '生成失败')
        const generated = applyResponse(response)
        patchTask(taskId, task => ({
          ...task,
          groups: task.groups.map(group => group.model === step.model ? { ...group, state: 'done' as const, outputs: generated } : group),
        }))
      } catch (err) {
        if (controller.signal.aborted === true || taskIsFinished() === 'cancelled') {
          patchTask(taskId, task => ({
            ...task,
            groups: task.groups.map(group => group.model === step.model ? { ...group, state: 'cancelled' as const, error: undefined } : group),
          }))
        } else {
          patchTask(taskId, task => ({
            ...task,
            groups: task.groups.map(group => group.model === step.model
              ? { ...group, state: 'error' as const, error: err instanceof Error ? err.message : String(err) }
              : group),
          }))
        }
      } finally {
        patchTask(taskId, task => ({ ...task, progress: { ...task.progress, done: task.progress.done + 1, current: '' } }))
      }
    }))
    taskControllers.current.delete(taskId)
    setTasks(current => current.map(task => {
      if (task.id !== taskId) return task
      if (task.status === 'cancelled') return { ...task, finishedAt: task.finishedAt ?? Date.now() }
      const done = task.groups.filter(group => group.state === 'done').length
      const failed = task.groups.filter(group => group.state === 'error').length
      const cancelled = task.groups.filter(group => group.state === 'cancelled').length
      if (done > 0) return { ...task, status: 'done', finishedAt: Date.now() }
      if (cancelled === task.groups.length) return { ...task, status: 'cancelled', finishedAt: Date.now() }
      return {
        ...task,
        status: 'failed',
        finishedAt: Date.now(),
        error: failed > 0 ? task.groups.filter(group => group.state === 'error').map(group => `「${group.model}」${group.error ?? ''}`).join('；') : '生成失败',
      }
    }))
  }

  /** 取消任务：本地中止在途 fetch + 宿主中断上游请求，剩余模型跳过。 */
  const cancelTask = (taskId: string): void => {
    for (const controller of taskControllers.current.get(taskId) ?? []) controller.abort()
    void api.cancelTask(taskId)
    patchTask(taskId, task => ({
      ...task,
      status: 'cancelled',
      finishedAt: Date.now(),
      progress: { ...task.progress, current: '' },
      groups: task.groups.map(group => group.state === 'waiting' || group.state === 'running'
        ? { ...group, state: 'cancelled' as const, error: undefined }
        : group),
    }))
  }

  const removeTask = (taskId: string): void => {
    setTasks(current => current.filter(task => task.id !== taskId))
  }

  /** 从历史参数回填表单（参考 AI 生图「恢复」）：配置 + prompt 一键复用。 */
  const restoreFromParams = (params: Record<string, unknown>, modeValue: AudioMode, singleModel: string, compareModelsRestore?: string[]): void => {
    const str = (key: string): string | undefined => {
      const v = params[key]
      return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
    }
    const num = (key: string): number | undefined => {
      const v = params[key]
      if (typeof v === 'number' && Number.isFinite(v)) return v
      if (typeof v === 'string' && v.trim() !== '') {
        const parsed = Number(v)
        return Number.isFinite(parsed) ? parsed : undefined
      }
      return undefined
    }
    const bool = (key: string): boolean | undefined => typeof params[key] === 'boolean' ? params[key] as boolean : undefined
    setMode(modeValue)
    const modelValue = str('model') ?? singleModel
    if (modelValue !== '') setModel(modelValue)
    if (compareModelsRestore !== undefined && compareModelsRestore.length > 0) {
      setCompareMode(true)
      setCompareModels(compareModelsRestore)
    } else {
      setCompareMode(false)
    }
    const voiceValue = str('voice')
    if (voiceValue !== undefined) setVoice(voiceValue)
    const speedValue = num('speed')
    if (speedValue !== undefined) setSpeed(String(speedValue))
    const durationValue = num('duration')
    if (durationValue !== undefined) setDuration(String(durationValue))
    const formatValue = str('format')
    if (formatValue !== undefined) setFormat(formatValue)
    const lyricsValue = str('lyrics')
    if (lyricsValue !== undefined) setLyrics(lyricsValue)
    const instrumentalValue = bool('isInstrumental')
    if (instrumentalValue !== undefined) setInstrumental(instrumentalValue)
    const loopValue = bool('loop')
    if (loopValue !== undefined) setLoop(loopValue)
    const influenceValue = num('promptInfluence')
    if (influenceValue !== undefined) setPromptInfluence(String(influenceValue))
    const emotionValue = str('emotion')
    if (emotionValue !== undefined) setEmotion(emotionValue)
    const volValue = num('vol')
    if (volValue !== undefined) setVol(String(volValue))
    const pitchValue = num('pitch')
    if (pitchValue !== undefined) setPitch(String(pitchValue))
    if (Array.isArray(params.pronunciationTone)) {
      setToneText(params.pronunciationTone.filter((item): item is string => typeof item === 'string').join('\n'))
    }
    const sampleRateValue = num('sampleRate')
    if (sampleRateValue !== undefined) setSampleRate(String(sampleRateValue))
    const bitrateValue = num('bitrate')
    if (bitrateValue !== undefined) setBitrate(String(bitrateValue))
    const channelValue = num('audioChannel')
    if (channelValue !== undefined) setAudioChannel(String(channelValue))
    const subtitleValue = bool('subtitleEnable')
    if (subtitleValue !== undefined) setSubtitle(subtitleValue)
    const seedValue = num('seed')
    if (seedValue !== undefined) setSeed(String(seedValue))
    const stepsValue = num('steps')
    if (stepsValue !== undefined) setSteps(String(stepsValue))
    const cfgValue = num('cfgScale')
    if (cfgValue !== undefined) setCfgScale(String(cfgValue))
    const previewValue = str('previewText')
    if (previewValue !== undefined) setPreviewText(previewValue)
    const channelIdValue = str('channelId')
    if (channelIdValue !== undefined && modeValue === 'voice_design') setDesignChannelId(channelIdValue)
    props.showToast('已恢复该次生成的配置，可直接再次生成')
  }

  /** 调用宿主增强（Agent 默认模型），结果先预览再应用。 */
  const runEnhance = async (): Promise<void> => {
    if (prompt.trim() === '') {
      setError('请先输入文本/提示词，再点击增强')
      return
    }
    setEnhancing(true)
    setError(null)
    try {
      const result = await api.enhancePrompt(prompt.trim(), mode)
      if (result.ok !== true || result.enhanced === undefined) {
        setError(result.message ?? '增强失败，请稍后重试')
        return
      }
      setEnhancePreview(result.enhanced)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setEnhancing(false)
    }
  }

  /** 删除历史记录（对比任务卡删除该任务的全部模型条目）。 */
  const deleteHistoryEntries = async (ids: string[]): Promise<void> => {
    try {
      for (const id of ids) await api.removeHistory(id)
    } catch {
      // best-effort
    }
    reload()
  }

  const openSaveDialog = (files: GeneratedAudio[], context: SaveDialogContext): void => {
    setSaveDialog({ files, context })
  }

  /** 按字段规格渲染一个表单控件（渠道/模式感知：字段集由 globalSpecs 决定）。 */
  const renderField = (spec: FieldSpec): React.JSX.Element => {
    const common = { className: css.input, disabled: false }
    switch (spec.key) {
      case 'voice':
        return (
          <label className={css.label} key={spec.key} title={spec.hint}>
            <span>{spec.label}</span>
            <input className={css.input} value={voice} onChange={event => setVoice(event.target.value)} placeholder={currentPreset === 'minimax' ? 'male-qn-qingse / female-shaonv' : 'alloy / 自定义音色'} />
          </label>
        )
      case 'speed':
        return (
          <label className={css.label} key={spec.key} title={spec.hint}>
            <span>{spec.label}</span>
            <input className={css.input} type="number" step={spec.step ?? 0.1} min={spec.min} max={spec.max} value={speed} onChange={event => setSpeed(event.target.value)} placeholder={spec.placeholder} />
          </label>
        )
      case 'duration':
        return (
          <label className={css.label} key={spec.key} title={spec.hint}>
            <span>{spec.label}</span>
            <input className={css.input} type="number" step={spec.step ?? 1} min={spec.min} max={spec.max} value={duration} onChange={event => setDuration(event.target.value)} placeholder={spec.placeholder} />
          </label>
        )
      case 'format':
        return (
          <label className={css.label} key={spec.key} title={spec.hint}>
            <span>{spec.label}</span>
            <select className={css.input} value={format} onChange={event => setFormat(event.target.value)}>
              {(spec.options ?? ['mp3', 'wav', 'pcm']).map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        )
      case 'lyrics':
        return (
          <label className={css.label} key={spec.key} title={spec.hint}>
            <span>{spec.label}</span>
            <textarea className={css.textarea} value={lyrics} onChange={event => setLyrics(event.target.value)} placeholder={'第一段歌词…\n\n第二段歌词…'} />
          </label>
        )
      case 'instrumental':
        return (
          <label className={css.checkbox} key={spec.key} title={spec.hint}>
            <input type="checkbox" checked={instrumental} onChange={event => setInstrumental(event.target.checked)} />
            <span>{spec.label}（是：{currentPreset === 'elevenlabs' ? 'force_instrumental' : 'is_instrumental'}）</span>
          </label>
        )
      case 'sampleRate':
        return (
          <label className={css.label} key={spec.key} title={spec.hint}>
            <span>{spec.label}</span>
            <select className={css.input} value={sampleRate} onChange={event => setSampleRate(event.target.value)}>
              <option value="">默认（44100）</option>
              {(spec.options ?? []).map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        )
      case 'bitrate':
        return (
          <label className={css.label} key={spec.key} title={spec.hint}>
            <span>{spec.label}</span>
            <select className={css.input} value={bitrate} onChange={event => setBitrate(event.target.value)}>
              <option value="">默认（256000）</option>
              {(spec.options ?? []).map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        )
      case 'audioChannel':
        return (
          <label className={css.label} key={spec.key} title={spec.hint}>
            <span>{spec.label}</span>
            <select className={css.input} value={audioChannel} onChange={event => setAudioChannel(event.target.value)}>
              <option value="">默认(1)</option>
              <option value="1">1</option>
              <option value="2">2</option>
            </select>
          </label>
        )
      case 'emotion':
        return (
          <label className={css.label} key={spec.key} title={spec.hint}>
            <span>{spec.label}</span>
            <input className={css.input} value={emotion} onChange={event => setEmotion(event.target.value)} placeholder={spec.placeholder} />
          </label>
        )
      case 'vol':
        return (
          <label className={css.label} key={spec.key} title={spec.hint}>
            <span>{spec.label}</span>
            <input className={css.input} type="number" min={spec.min} max={spec.max} step={spec.step ?? 0.5} value={vol} onChange={event => setVol(event.target.value)} placeholder={spec.placeholder} />
          </label>
        )
      case 'pitch':
        return (
          <label className={css.label} key={spec.key} title={spec.hint}>
            <span>{spec.label}</span>
            <input className={css.input} type="number" min={spec.min} max={spec.max} value={pitch} onChange={event => setPitch(event.target.value)} placeholder={spec.placeholder} />
          </label>
        )
      case 'toneText':
        return (
          <label className={css.label} key={spec.key} title={spec.hint}>
            <span>{spec.label}</span>
            <textarea className={css.textarea} value={toneText} onChange={event => setToneText(event.target.value)} placeholder={spec.placeholder} />
          </label>
        )
      case 'subtitle':
        return (
          <label className={css.checkbox} key={spec.key} title={spec.hint}>
            <input type="checkbox" checked={subtitle} onChange={event => setSubtitle(event.target.checked)} />
            <span>{spec.label}</span>
          </label>
        )
      case 'loop':
        return (
          <label className={css.checkbox} key={spec.key} title={spec.hint}>
            <input type="checkbox" checked={loop} onChange={event => setLoop(event.target.checked)} />
            <span>{spec.label}</span>
          </label>
        )
      case 'promptInfluence':
        return (
          <label className={css.label} key={spec.key} title={spec.hint}>
            <span>{spec.label}</span>
            <input className={css.input} type="number" step={spec.step ?? 0.1} min={spec.min} max={spec.max} value={promptInfluence} onChange={event => setPromptInfluence(event.target.value)} placeholder={spec.placeholder} />
          </label>
        )
      case 'seed':
      case 'steps':
      case 'cfgScale': {
        const value = spec.key === 'seed' ? seed : spec.key === 'steps' ? steps : cfgScale
        const setter = spec.key === 'seed' ? setSeed : spec.key === 'steps' ? setSteps : setCfgScale
        // 覆盖矩阵中的数字输入用统一 state（cfgScale 入参键 cfg_scale）。
        return (
          <label className={css.label} key={spec.key} title={spec.hint}>
            <span>{spec.label}</span>
            <input {...common} type="number" step={spec.step ?? 1} min={spec.min} max={spec.max} value={String(value)} placeholder={spec.placeholder} onChange={event => setter(event.target.value)} />
          </label>
        )
      }
      default:
        return <span key={spec.key}>{spec.label}</span>
    }
  }

  const onDialogSaved = (entry: LibraryEntry): void => {
    if (saveDialog !== null) {
      setSavedIds(current => new Set([...current, ...saveDialog.files.map(file => file.id)]))
    }
    setSaveDialog(null)
    props.showToast(`已保存「${entry.name}」`)
    props.onLibraryChanged()
  }

  /** One result card (single mode shares it with the compare groups). */
  const renderAudioCard = (audio: GeneratedAudio, index: number, label: string, contextModel: string): React.JSX.Element => {
    const saved = savedIds.has(audio.id)
    return (
      <div className={css.audioCard} key={`${label}-${audio.id}`} data-saved={saved ? 'true' : 'false'}>
        <div className={css.audioCardHead}>
          {audio.voiceId !== undefined ? <span className={css.voiceIdChip} title="新音色 ID">新音色 {audio.voiceId}</span> : null}
          {saved ? (
            <span className={css.savedChip}><CheckIcon /> 已入库</span>
          ) : null}
          <span className={css.audioCardIndex}>#{index + 1}</span>
        </div>
        <AudioPlayer src={dataUrlOf(audio)} itemKey={`${label}-${audio.id}`} />
        <div className={css.audioCardActions}>
          <a className={css.ghostButton} href={dataUrlOf(audio)} download={`generated-${index + 1}.${audio.mime.split('/')[1]?.replace('mpeg', 'mp3') ?? 'mp3'}`}>
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
                ...(contextModel !== '' ? { model: contextModel } : {}),
                ...(channels.length > 0 ? { channel: channels.find(candidate => candidate.id === (mode === 'voice_design' ? designChannelId : modelOptions.defaultChannelId))?.name ?? channels[0]?.name ?? '' } : {}),
                params: requestOf(contextModel) as unknown as Record<string, unknown>,
              })}
            >
              <StarIcon /> 加入资源库
            </button>
          )}
        </div>
      </div>
    )
  }

  const modeLabel = useMemo(() => {
    if (mode === 'tts') return tt('mode.tts')
    if (mode === 'music') return tt('mode.music')
    if (mode === 'sfx') return tt('mode.sfx')
    return tt('mode.voiceDesign')
  }, [mode])

  /** 历史记录：按 taskId 聚合出「单条 / 对比任务卡」两种条目。 */
  const historyItems = useMemo((): Array<{
    key: string
    kind: 'single' | 'compare'
    mode: AudioMode
    prompt: string
    createdAt: number
    entry: HistoryEntry
    models: Array<{ model: string; channel?: string; entry: HistoryEntry }>
  }> => {
    const taskCounts = new Map<string, number>()
    for (const entry of entries) {
      const taskId = taskIdOf(entry)
      if (taskId !== '') taskCounts.set(taskId, (taskCounts.get(taskId) ?? 0) + 1)
    }
    const merged: Array<{
      key: string
      kind: 'single' | 'compare'
      mode: AudioMode
      prompt: string
      createdAt: number
      entry: HistoryEntry
      models: Array<{ model: string; channel?: string; entry: HistoryEntry }>
    }> = []
    const byTask = new Map<string, typeof merged[number]>()
    for (const entry of entries) {
      const taskId = taskIdOf(entry)
      if (taskId !== '' && (taskCounts.get(taskId) ?? 0) > 1) {
        const existing = byTask.get(taskId)
        if (existing !== undefined) {
          existing.models.push({ model: entry.model, ...(entry.channel === undefined ? {} : { channel: entry.channel }), entry })
          if (entry.createdAt > existing.createdAt) existing.createdAt = entry.createdAt
          continue
        }
        const item: typeof merged[number] = {
          key: taskId,
          kind: 'compare',
          mode: entry.mode,
          prompt: entry.prompt,
          createdAt: entry.createdAt,
          entry,
          models: [{ model: entry.model, ...(entry.channel === undefined ? {} : { channel: entry.channel }), entry }],
        }
        byTask.set(taskId, item)
        merged.push(item)
        continue
      }
      merged.push({ key: entry.id, kind: 'single', mode: entry.mode, prompt: entry.prompt, createdAt: entry.createdAt, entry, models: [] })
    }
    return merged.sort((left, right) => right.createdAt - left.createdAt)
  }, [entries])

  const needModel = mode !== 'voice_design'
  const runningCount = tasks.filter(task => task.status === 'running').length

  return (
    <div className={css.studio}>
      <div className={css.formCol}>
        <div className={css.modeRow}>
          {([['tts', '🎙️'], ['music', '🎵'], ['sfx', '🔊'], ['voice_design', '🎨']] as Array<[AudioMode, string]>).map(([item, icon]) => (
            <button
              key={item}
              type="button"
              className={css.modeButton}
              data-active={mode === item ? 'true' : 'false'}
              onClick={() => setMode(item)}
            >
              <span className={css.modeIcon}>{icon}</span>
              {modeLabelOf(item)}
            </button>
          ))}
        </div>

        <div className={css.formSectionRow}>
          <p className={css.formSection}>输入</p>
          <button type="button" className={css.ghostButton} disabled={enhancing} onClick={() => void runEnhance()}>
            {enhancing ? '增强中…' : '✨ 增强提示词'}
          </button>
        </div>
        <label className={css.label}>
          <span>{mode === 'voice_design' ? '音色描述' : mode === 'tts' ? '文本' : '提示词'}</span>
          <textarea className={css.textarea} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={tt('prompt.placeholder')} />
        </label>
        {enhancePreview !== null ? (
          <div className={css.enhanceCard}>
            <div className={css.enhanceCardHead}>
              <strong>增强结果（{modeLabelOf(mode)}）</strong>
              <span className={css.enhanceActions}>
                <button type="button" className={css.ghostButton} onClick={() => { setPrompt(enhancePreview); setEnhancePreview(null); props.showToast('已应用增强结果') }}>应用</button>
                <button type="button" className={css.ghostButton} disabled={enhancing} onClick={() => void runEnhance()}>重新生成</button>
                <button type="button" className={css.ghostButton} onClick={() => setEnhancePreview(null)}>放弃</button>
              </span>
            </div>
            <textarea className={css.textarea} value={enhancePreview} readOnly />
          </div>
        ) : null}

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

        <p className={css.formSection}>模型</p>
        {needModel ? (
          <label className={css.checkbox} title="选择多个模型，用相同参数逐个生成，便于对比效果">
            <input type="checkbox" checked={compareMode} onChange={event => setCompareMode(event.target.checked)} />
            <span>模型对比（多模型同参数生成）</span>
          </label>
        ) : null}

        {needModel ? (
          compareMode ? (
            <div className={css.compareBox}>
              <span className={css.label}>对比模型（至少 2 个，最多 4 个）</span>
              <div className={css.compareChips}>
                {visibleModels.map(item => (
                  <button
                    key={item}
                    type="button"
                    className={css.compareChip}
                    data-active={compareModels.includes(item) ? 'true' : 'false'}
                    onClick={() => setCompareModels(current => current.includes(item)
                      ? current.filter(candidate => candidate !== item)
                      : current.length < 4 ? [...current, item] : current)}
                  >
                    {item}
                  </button>
                ))}
                {visibleModels.length === 0 ? <p className={css.hint}>当前模式暂无可用模型</p> : null}
              </div>
              <details className={css.advanced}>
                <summary>每模型参数覆盖（默认自动：沿用上方相同配置）</summary>
                <div className={css.overrideTable}>
                  <div className={css.overrideRow}>
                    <span className={`${css.overrideCell} ${css.overrideCellHead}`} />
                    {compareModels.map(item => <span key={item} className={`${css.overrideCell} ${css.overrideCellHead}`}>{item}</span>)}
                  </div>
                  {overrideRowSpecs(mode).map(row => (
                    <div key={row.key} className={css.overrideRow}>
                      <span className={css.overrideCell} title={`${row.hint ?? ''}${row.presets.length < 3 ? `（适用：${row.presets.map(presetLabel).join('/')}）` : ''}`}>
                        {row.label}
                        {row.presets.length < 3 ? <span className={css.overrideOnly}> 仅{row.presets.map(presetLabel).join('/')}</span> : null}
                      </span>
                      {compareModels.map(item => {
                        const entry = modelOptions.models.find(candidate => candidate.alias === item)
                        const applicable = entry !== undefined && row.presets.includes(entry.preset)
                        if (!applicable) {
                          return <span key={item} className={css.overrideCell}><span className={css.overrideDash}>—</span></span>
                        }
                        const value = overrides[item]?.[row.key] ?? ''
                        return (
                          <span key={item} className={css.overrideCell}>
                            {row.type === 'select' ? (
                              <select className={css.input} value={value} onChange={event => {
                                setOverrides(current => ({
                                  ...current,
                                  [item]: { ...(current[item] ?? {}), [row.key]: event.target.value },
                                }))
                              }}>
                                <option value="">自动</option>
                                {row.options!.map(option => <option key={option} value={option}>{option}</option>)}
                              </select>
                            ) : (
                              <input
                                className={css.input}
                                type={row.type === 'number' ? 'number' : 'text'}
                                value={value}
                                placeholder={row.placeholder ?? '自动'}
                                onChange={event => {
                                  setOverrides(current => ({
                                    ...current,
                                    [item]: { ...(current[item] ?? {}), [row.key]: event.target.value },
                                  }))
                                }}
                              />
                            )}
                          </span>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </details>
            </div>
          ) : (
            <label className={css.label}>
              <span>{tt('model.label')}</span>
              <select className={css.input} value={model} onChange={event => setModel(event.target.value)}>
                {visibleModels.length === 0 ? <option value="">（当前模式暂无可用模型）</option> : null}
                {groupedModels.map(group => (
                  <optgroup key={group.channelId} label={group.channelName}>
                    {group.models.map(item => <option key={item.alias} value={item.alias}>{item.alias}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
          )
        ) : null}

        {globalSpecs.some(spec => spec.advanced !== true) ? <p className={css.formSection}>生成参数</p> : null}
        <div className={css.formFields}>
          {globalSpecs.filter(spec => spec.advanced !== true).map(spec => (
            <div key={spec.key} className={spec.key === 'lyrics' || spec.key === 'toneText' ? css.fieldFull : css.fieldCell}>
              {renderField(spec)}
            </div>
          ))}
        </div>

        {mode === 'tts' && globalSpecs.some(spec => spec.advanced === true) ? (
          <details className={css.advanced}>
            <summary>MiniMax 高级参数</summary>
            {globalSpecs.filter(spec => spec.advanced === true).map(spec => renderField(spec))}
          </details>
        ) : null}

        <label className={css.checkbox} title="生成完成后自动保存到资源库；也可在设置中开启全部自动保存">
          <input type="checkbox" checked={saveToLibrary} onChange={event => setSaveToLibrary(event.target.checked)} />
          <span>生成后保存到资源库</span>
        </label>

        {!connected && <p className={css.hint}>{tt('config.missing')}</p>}
        <button
          type="button"
          className={css.generate}
          disabled={!connected || (compareMode && needModel ? compareModels.length < 2 : needModel && visibleModels.length === 0)}
          onClick={submit}
        >
          {(compareMode && needModel ? '对比生成' : tt('generate'))}
        </button>
        {runningCount > 0 ? <p className={css.hint}>进行中任务：{runningCount} 个（并发上限在「设置 → 插件 → AI 音频」调整）</p> : null}
      </div>

      <div className={css.resultCol}>
        {error !== null ? <p className={css.error}>{error}</p> : null}
        {tasks.length === 0 ? (
          <div className={css.resultEmpty}>
            <span className={css.resultEmptyIcon}>🎵</span>
            <p>{tt('result.empty')}</p>
            <p className={css.resultEmptyHint}>点击「开始生成」即创建一个任务，可同时进行多个；勾选「模型对比」用多个模型同参数生成对比</p>
            <button type="button" className={css.ghostButton} onClick={() => {
              const examples: Record<AudioMode, string> = {
                tts: '今天是不是很开心呀(laughs)，当然了！我们一起去公园散步吧。',
                music: 'Cinematic orchestral piece with a clear "before/after" transition at 1:00, starting minimalist piano + strings, then full orchestra entrance with timpani and brass at the 1-minute mark.',
                sfx: '科技感 UI 提示音：清脆短促，带轻微回声与空气感。',
                voice_design: '讲述悬疑故事的播音员，声音低沉富有磁性，语速时快时慢，营造紧张神秘的氛围。',
              }
              setPrompt(examples[mode] ?? '')
            }}>填入示例 prompt</button>
          </div>
        ) : (
          <div className={css.taskList}>
            {tasks.map(task => {
              const elapsed = task.finishedAt !== undefined
                ? Math.round((task.finishedAt - task.startedAt) / 1000)
                : Math.round((Date.now() - task.startedAt) / 1000)
              const statusText = task.status === 'running'
                ? `生成中 ${task.progress.done}/${task.progress.total}${task.progress.current !== '' ? ` · ${task.progress.current}` : ''} · ${elapsed}s`
                : task.status === 'done'
                  ? `完成 · ${task.groups.reduce((sum, group) => sum + group.outputs.length, 0)} 段 · ${elapsed}s`
                  : task.status === 'cancelled'
                    ? '已取消'
                    : '失败'
              return (
                <div className={css.taskCard} key={task.id} data-state={task.status}>
                  <div className={css.taskHead}>
                    <span className={css.resultModeChip}>{task.mode}</span>
                    <span className={css.taskLabel} title={task.prompt}>{task.label}</span>
                    <span className={css.taskStatus} data-state={task.status}>{statusText}</span>
                    {task.status === 'running' ? (
                      <span className={css.taskBar}><i style={{ width: `${task.progress.total > 0 ? Math.round((task.progress.done / task.progress.total) * 100) : 0}%` }} /></span>
                    ) : null}
                    <span className={css.taskActions}>
                      {task.status === 'running' ? (
                        <button type="button" className={css.ghostButton} onClick={() => cancelTask(task.id)}>取消</button>
                      ) : null}
                      <button type="button" className={css.ghostButton} onClick={() => removeTask(task.id)}>移除</button>
                    </span>
                  </div>
                  {task.error !== undefined ? <p className={css.hint} data-error>{task.error}</p> : null}
                  <div className={css.compareBoard}>
                    {task.groups.map(group => (
                      <div className={css.compareGroup} key={group.model} data-state={group.state}>
                        <div className={css.compareGroupHead}>
                          <span className={css.compareModelName}>{group.model}</span>
                          <span className={css.compareState}>
                            {group.state === 'waiting' ? '等待中…'
                              : group.state === 'running' ? '生成中…'
                                : group.state === 'done' ? <><CheckIcon /> 完成</>
                                  : group.state === 'cancelled' ? '已取消'
                                    : '失败'}
                          </span>
                        </div>
                        {group.state === 'error' ? <p className={css.hint} data-error>{group.error}</p> : null}
                        {group.outputs.length > 0 ? (
                          <div className={css.audioList}>
                            {group.outputs.map((audio, index) => renderAudioCard(audio, index, group.model, group.model))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <aside className={css.historyCol}>
        <div className={css.historyHeader}>
          <strong className={css.historyTitle}>{tt('history.title')}</strong>
          <button type="button" className={css.historyClear} onClick={clear}>清空</button>
        </div>
        {entries.length === 0 ? <p className={css.historyEmpty}>{tt('history.empty')}</p> : (
          <>
            <div className={css.historyTabs}>
              {(['all', 'tts', 'music', 'sfx', 'voice_design'] as const).map(tab => (
                <button
                  key={tab}
                  type="button"
                  className={css.historyTab}
                  data-active={historyTab === tab ? 'true' : 'false'}
                  onClick={() => setHistoryTab(tab)}
                >
                  {tab === 'all' ? '全部' : modeLabelOf(tab)}
                  <span className={css.historyTabCount}>
                    {tab === 'all' ? entries.length : historyItems.filter(item => item.mode === tab).length}
                  </span>
                </button>
              ))}
            </div>
            <div className={css.historyList}>
              {(historyTab === 'all' ? historyItems : historyItems.filter(item => item.mode === historyTab)).map(item => {
                if (item.kind === 'compare') {
                  return (
                    <details className={css.historyItem} key={item.key} open>
                      <summary className={css.historyCompareSummary}>
                        <span className={css.historyPrompt}>{item.prompt}</span>
                        <span className={css.historyCompareBadge}>对比 · {item.models.length} 个模型</span>
                        <span className={css.historyTime}>{formatClock(item.createdAt)}</span>
                      </summary>
                      <div className={css.historyMeta}>{modeLabelOf(item.mode)} · {item.models.map(model => model.model).join(' / ')}</div>
                      {item.models.map(model => (
                        <div key={model.entry.id} className={css.historyModelRow}>
                          <div className={css.historyMeta}>
                            <strong>{model.model}</strong>{model.channel !== undefined ? ` · ${model.channel}` : ''}
                          </div>
                          {model.entry.audio.map((audio, index) => (
                            <AudioPlayer key={index} src={audio.url} compact itemKey={`${item.key}-${model.entry.id}-${index}`} />
                          ))}
                          <div className={css.historyActions}>
                            <button type="button" className={css.historyAction} onClick={() => openSaveDialog(audioRefsOfEntry(model.entry), contextOfEntry(model.entry))}>
                              <StarIcon /> 入库
                            </button>
                          </div>
                        </div>
                      ))}
                      <div className={css.historyActions}>
                        <button type="button" className={css.historyIcon} title="恢复（回填配置与全部模型）" onClick={() => restoreFromParams(
                          (item.models[0]?.entry.params ?? {}) as Record<string, unknown>,
                          item.mode,
                          item.models[0]?.model ?? '',
                          item.models.map(model => model.model),
                        )}>↺</button>
                        <button type="button" className={css.historyIcon} title="删除整个对比任务" onClick={() => void deleteHistoryEntries(item.models.map(model => model.entry.id))}>✕</button>
                      </div>
                    </details>
                  )
                }
                const entry = item.entry
                return (
                  <div className={css.historyItem} key={item.key}>
                    <div className={css.historyPrompt}>{entry.prompt}</div>
                    <div className={css.historyMeta}>{modeLabelOf(entry.mode)} · {entry.model}{entry.channel ? ` · ${entry.channel}` : ''}</div>
                    <div className={css.historyTime}>{formatClock(entry.createdAt)}</div>
                    {entry.audio.map((audio, index) => (
                      <AudioPlayer key={index} src={audio.url} compact itemKey={`${entry.id}-${index}`} />
                    ))}
                    <div className={css.historyActions}>
                      <button type="button" className={css.historyIcon} title="恢复（回填配置与 prompt）" onClick={() => restoreFromParams(
                        (entry.params ?? {}) as Record<string, unknown>,
                        entry.mode,
                        entry.model,
                      )}>↺</button>
                      <button type="button" className={css.historyIcon} title="删除这条记录" onClick={() => void deleteHistoryEntries([entry.id])}>✕</button>
                      <button type="button" className={css.historyIcon} title="加入资源库" onClick={() => openSaveDialog(audioRefsOfEntry(entry), contextOfEntry(entry))}>
                        <StarIcon />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
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
