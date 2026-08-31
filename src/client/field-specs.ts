/**
 * 厂商感知的字段规格表：按（渠道 preset × 模式）声明面板该显示哪些参数，
 * 以及每个参数适用于哪些渠道。引擎不变——引擎本来就按渠道消费字段；
 * 这里只负责「该显示什么、标签/枚举/校验按渠道」。
 */

import type { AudioMode } from '../protocol.ts'

/** 与面板表单 state 对应的一组字段键。 */
export type FieldKey =
  | 'duration'
  | 'format'
  | 'lyrics'
  | 'instrumental'
  | 'sampleRate'
  | 'bitrate'
  | 'audioChannel'
  | 'voice'
  | 'speed'
  | 'emotion'
  | 'vol'
  | 'pitch'
  | 'toneText'
  | 'subtitle'
  | 'loop'
  | 'promptInfluence'
  | 'seed'
  | 'steps'
  | 'cfgScale'

export interface FieldSpec {
  key: FieldKey
  label: string
  type: 'text' | 'number' | 'select' | 'checkbox'
  options?: string[]
  placeholder?: string
  min?: number
  max?: number
  step?: number
  /** 官方字段名/说明（tooltip）。 */
  hint?: string
  /** 放在折叠「高级参数」里。 */
  advanced?: boolean
  /** 适用的渠道 preset；undefined 表示通用。 */
  presets?: string[]
}

const PRESET_MINIMAX = 'minimax'
const PRESET_ELEVENLABS = 'elevenlabs'
const PRESET_STABILITY = 'stability-audio'

/** 各 preset 支持的音乐输出格式（交集用于全局字段）。 */
const MUSIC_FORMATS: Record<string, string[]> = {
  [PRESET_MINIMAX]: ['mp3', 'wav', 'pcm'],
  [PRESET_ELEVENLABS]: ['mp3', 'wav'],
  [PRESET_STABILITY]: ['mp3', 'wav'],
}

const MUSIC_KEYS: FieldKey[] = ['duration', 'format', 'lyrics', 'instrumental', 'sampleRate', 'bitrate']
const TTS_KEYS: FieldKey[] = ['voice', 'speed', 'format', 'emotion', 'vol', 'pitch', 'toneText', 'sampleRate', 'bitrate', 'audioChannel', 'subtitle']
const SFX_KEYS: FieldKey[] = ['duration', 'format', 'loop', 'promptInfluence', 'seed', 'steps', 'cfgScale']

export function presetSupports(preset: string, key: FieldKey, mode: AudioMode): boolean {
  const p = preset.toLowerCase()
  const K = MUSIC_KEYS.includes(key) ? MUSIC_KEYS : TTS_KEYS.includes(key) ? TTS_KEYS : SFX_KEYS
  if (!K.includes(key)) return true
  switch (key) {
    case 'lyrics':
    case 'instrumental':
      return p === PRESET_MINIMAX || p === PRESET_ELEVENLABS
    case 'sampleRate':
    case 'bitrate':
    case 'audioChannel':
      return p === PRESET_MINIMAX
    case 'emotion':
    case 'vol':
    case 'pitch':
    case 'toneText':
    case 'subtitle':
      return p === PRESET_MINIMAX
    case 'loop':
    case 'promptInfluence':
      return p === PRESET_ELEVENLABS
    case 'seed':
    case 'steps':
    case 'cfgScale':
      return p === PRESET_STABILITY
    default:
      return true
  }
}

const SPECS: Record<FieldKey, Omit<FieldSpec, 'key' | 'presets'>> = {
  duration: { label: '时长（秒）', type: 'number', min: 1, max: 200, placeholder: '30', hint: 'MiniMax 音乐最长 190 秒；ElevenLabs 音乐 3-600 秒（自动换算）；Stability 音频按模型 190 或 380 秒' },
  format: { label: '输出格式', type: 'select', options: ['mp3', 'wav', 'pcm', 'flac', 'ogg'], hint: '可选格式：MiniMax 为 mp3 / wav / pcm；ElevenLabs 与 Stability 为 mp3 / wav' },
  lyrics: { label: '歌词（纯音乐模式可留空；多段用空行分隔）', type: 'text', placeholder: '第一段歌词…\n\n第二段歌词…', hint: '歌词与提示词分开；勾选纯音乐后无需填写，适用于 MiniMax 与 ElevenLabs 音乐' },
  instrumental: { label: '纯音乐（无歌词/人声）', type: 'checkbox', hint: '勾选后无需填写歌词即可生成；仅 MiniMax 与 ElevenLabs 音乐支持' },
  sampleRate: { label: '采样率', type: 'select', options: ['16000', '24000', '32000', '44100'], placeholder: '默认（44100）', hint: 'MiniMax 可选 16000 / 24000 / 32000 / 44100' },
  bitrate: { label: '码率', type: 'select', options: ['32000', '64000', '128000', '256000'], placeholder: '默认（256000）', hint: 'MiniMax 可选 32000 / 64000 / 128000 / 256000' },
  audioChannel: { label: '声道', type: 'select', options: ['1', '2'], placeholder: '默认(1)', hint: 'MiniMax 语音支持 1 或 2 声道' },
  voice: { label: '音色', type: 'text', placeholder: '自定义音色', hint: 'MiniMax 必填官方音色 ID；ElevenLabs 可填音色名' },
  speed: { label: '语速', type: 'number', min: 0.5, max: 2, step: 0.1, placeholder: '1.0', hint: 'MiniMax 语音语速，范围 0.5-2 倍，默认 1' },
  emotion: { label: '情绪', type: 'text', placeholder: 'happy / sad / angry / nervous…', hint: 'MiniMax 语音情绪，如 happy / sad / angry / nervous / fearful / bored，默认按音色本身', advanced: true },
  vol: { label: '音量（0-10）', type: 'number', min: 0, max: 10, step: 0.5, placeholder: '1', hint: 'MiniMax 语音音量，范围 0-10，默认 1', advanced: true },
  pitch: { label: '音调（-12~12 半音）', type: 'number', min: -12, max: 12, placeholder: '0', hint: 'MiniMax 语音音调偏移，范围 -12~12 半音，默认 0', advanced: true },
  toneText: { label: '发音词典（每行一条："文字/读音"）', type: 'text', placeholder: '处理/(chu3)(li3)\n危险/dangerous', hint: 'MiniMax 朗读读音定制，每行一条，如：危险/dangerous', advanced: true },
  subtitle: { label: '生成字幕', type: 'checkbox', hint: '勾选后返回 MiniMax 语音的字幕内容/文件', advanced: true },
  loop: { label: '循环音效（无缝循环）', type: 'checkbox', hint: 'ElevenLabs 音效无缝循环，仅音效模型支持' },
  promptInfluence: { label: '提示词影响度（0-1）', type: 'number', min: 0, max: 1, step: 0.1, placeholder: '0.3', hint: 'ElevenLabs 音效提示词影响度，范围 0-1，越高越贴提示词；默认 0.3' },
  seed: { label: '随机种子', type: 'number', min: 0, max: 4294967294, placeholder: '默认（随机）', hint: 'Stability 音频随机种子，相同种子与参数可复现；默认 0（随机）' },
  steps: { label: '采样步数', type: 'number', min: 4, max: 100, placeholder: '默认', hint: 'Stability 音频采样步数：stable-audio-2 为 30-100；2.5 / 3 为 4-8' },
  cfgScale: { label: '提示词遵循度', type: 'number', min: 1, max: 25, placeholder: '默认', hint: 'Stability 音频提示词遵循度，范围 1-25；stable-audio-2 默认 7，2.5 / 3 默认 1' },
}

function specOf(key: FieldKey, presets?: string[]): FieldSpec {
  return { key, ...SPECS[key], ...(presets === undefined ? {} : { presets }) }
}

/** 当前模式 + 所选模型集合（渠道集合）对应的「全局字段」清单。 */
export function globalFieldSpecs(mode: AudioMode, presets: string[]): FieldSpec[] {
  const list: FieldSpec[] = []
  const all = (key: FieldKey, keys: FieldKey[]): boolean => keys.includes(key) && presets.every(preset => presetSupports(preset, key, mode))
  if (mode === 'tts') {
    list.push(specOf('voice'), specOf('speed'))
    list.push({ ...specOf('format'), options: ['mp3', 'wav', 'flac', 'ogg', 'pcm'] })
    const advanced = (['emotion', 'vol', 'pitch', 'toneText', 'sampleRate', 'bitrate', 'audioChannel', 'subtitle'] as FieldKey[]).filter(key => all(key, TTS_KEYS) && presets.length > 0)
    for (const key of advanced) list.push(specOf(key))
  } else if (mode === 'music') {
    list.push(specOf('duration'))
    // 格式选项取所有选中渠道支持的交集（无交集则回退 mp3/wav）
    const supported: string[][] = presets.length === 0 ? [['mp3', 'wav', 'pcm']] : presets.map(preset => MUSIC_FORMATS[preset.toLowerCase()] ?? ['mp3', 'wav'])
    const intersect: string[] = supported.reduce<string[]>((acc, cur) => acc.filter(item => cur.includes(item)), supported[0] ?? ['mp3', 'wav'])
    list.push({ ...specOf('format'), options: intersect.length > 0 ? intersect : ['mp3', 'wav'] })
    if (all('lyrics', MUSIC_KEYS) && presets.length > 0) list.push(specOf('lyrics'))
    if (all('instrumental', MUSIC_KEYS) && presets.length > 0) list.push(specOf('instrumental'))
    if (all('sampleRate', MUSIC_KEYS) && presets.length > 0) list.push(specOf('sampleRate'))
    if (all('bitrate', MUSIC_KEYS) && presets.length > 0) list.push(specOf('bitrate'))
  } else if (mode === 'sfx') {
    list.push(specOf('duration'))
    list.push({ ...specOf('format'), options: ['mp3', 'wav', 'pcm'] })
    if (all('loop', SFX_KEYS) && presets.length > 0) list.push(specOf('loop'))
    if (all('promptInfluence', SFX_KEYS) && presets.length > 0) list.push(specOf('promptInfluence'))
    if (all('seed', SFX_KEYS) && presets.length > 0) list.push(specOf('seed'), specOf('steps'), specOf('cfgScale'))
  }
  return list
}

/** 「每模型参数覆盖」矩阵的字段全集（含适用渠道标注）。 */
export function overrideRowSpecs(mode: AudioMode): Array<FieldSpec & { presets: string[] }> {
  const rows: Array<FieldSpec & { presets: string[] }> = []
  const presets: Array<[FieldKey, string[]]> = [
    ['format', [PRESET_MINIMAX, PRESET_ELEVENLABS, PRESET_STABILITY]],
    ['duration', [PRESET_MINIMAX, PRESET_ELEVENLABS, PRESET_STABILITY]],
    ['voice', [PRESET_MINIMAX, PRESET_ELEVENLABS]],
    ['speed', [PRESET_MINIMAX, PRESET_ELEVENLABS]],
    ['lyrics', [PRESET_MINIMAX, PRESET_ELEVENLABS]],
    ['instrumental', [PRESET_MINIMAX, PRESET_ELEVENLABS]],
    ['sampleRate', [PRESET_MINIMAX]],
    ['bitrate', [PRESET_MINIMAX]],
    ['audioChannel', [PRESET_MINIMAX]],
    ['emotion', [PRESET_MINIMAX]],
    ['vol', [PRESET_MINIMAX]],
    ['pitch', [PRESET_MINIMAX]],
    ['toneText', [PRESET_MINIMAX]],
    ['subtitle', [PRESET_MINIMAX]],
    ['loop', [PRESET_ELEVENLABS]],
    ['promptInfluence', [PRESET_ELEVENLABS]],
    ['seed', [PRESET_STABILITY]],
    ['steps', [PRESET_STABILITY]],
    ['cfgScale', [PRESET_STABILITY]],
  ]
  for (const [key, applicable] of presets) {
    const spec = specOf(key, applicable)
    rows.push({ ...spec, presets: applicable })
  }
  return rows
}

/** 渠道 preset 的展示名。 */
export function presetLabel(preset: string): string {
  if (preset === PRESET_MINIMAX) return 'MiniMax'
  if (preset === PRESET_ELEVENLABS) return 'ElevenLabs'
  if (preset === PRESET_STABILITY) return 'Stability'
  if (preset === 'openai-tts') return 'OpenAI'
  return '自定义'
}
