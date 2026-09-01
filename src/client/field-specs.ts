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
const SFX_KEYS: FieldKey[] = ['duration', 'format', 'sampleRate', 'bitrate', 'loop', 'promptInfluence', 'seed', 'steps', 'cfgScale']

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
      // MiniMax：采样率/码率独立字段（audio_setting）；ElevenLabs 仅音效：与格式组合为 output_format。
      return p === PRESET_MINIMAX || (mode === 'sfx' && p === PRESET_ELEVENLABS)
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
  duration: { label: '时长（秒）', type: 'number', min: 1, max: 200, placeholder: '30', hint: 'duration；MiniMax 音乐 ≤190、ElevenLabs 音乐 3-600（转 ms）、Stability 按模型 190/380' },
  format: { label: '输出格式', type: 'select', options: ['mp3', 'wav', 'pcm', 'flac', 'ogg'], hint: 'format / output_format / response_format' },
  lyrics: { label: '歌词（纯音乐模式可留空；多段用空行分隔）', type: 'text', placeholder: '第一段歌词…\n\n第二段歌词…', hint: 'MiniMax lyrics / ElevenLabs lyrics_text' },
  instrumental: { label: '纯音乐（无歌词/人声）', type: 'checkbox', hint: 'MiniMax is_instrumental / ElevenLabs force_instrumental' },
  sampleRate: { label: '采样率', type: 'select', options: ['16000', '24000', '32000', '44100'], placeholder: '默认（44100）', hint: 'audio_setting.sample_rate：16000-44100' },
  bitrate: { label: '码率 bps', type: 'select', options: ['32000', '64000', '128000', '256000'], placeholder: '默认（256000）', hint: 'audio_setting.bitrate：32000-256000' },
  audioChannel: { label: '声道', type: 'select', options: ['1', '2'], placeholder: '默认(1)', hint: 'audio_setting.channel（TTS）' },
  voice: { label: '音色', type: 'text', placeholder: '自定义音色', hint: 'voice_id（MiniMax 必填）/ voice（ElevenLabs）' },
  speed: { label: '语速', type: 'number', min: 0.5, max: 2, step: 0.1, placeholder: '1.0', hint: 'speed（MiniMax 0.5-2）' },
  emotion: { label: '情绪 emotion', type: 'text', placeholder: 'happy / sad / angry / nervous…', hint: 'voice_setting.emotion', advanced: true },
  vol: { label: '音量 vol (0-10)', type: 'number', min: 0, max: 10, step: 0.5, placeholder: '1', hint: 'voice_setting.vol', advanced: true },
  pitch: { label: '音调 pitch (-12~12)', type: 'number', min: -12, max: 12, placeholder: '0', hint: 'voice_setting.pitch', advanced: true },
  toneText: { label: '发音词典（每行一条："文字/读音"）', type: 'text', placeholder: '处理/(chu3)(li3)\n危险/dangerous', hint: 'pronunciation_dict.tone', advanced: true },
  subtitle: { label: '生成字幕 subtitle_enable', type: 'checkbox', hint: 'subtitle_enable', advanced: true },
  loop: { label: '循环音效 loop（无缝循环）', type: 'checkbox', hint: 'ElevenLabs loop（仅 eleven_text_to_sound_v2）' },
  promptInfluence: { label: '提示词影响度 prompt_influence (0-1)', type: 'number', min: 0, max: 1, step: 0.1, placeholder: '0.3', hint: 'prompt_influence：越高越贴提示词' },
  seed: { label: 'seed', type: 'number', min: 0, max: 4294967294, placeholder: '默认（随机）', hint: 'Stable Audio seed（同参数可复现）' },
  steps: { label: 'steps', type: 'number', min: 4, max: 100, placeholder: '默认', hint: 'Stable Audio 采样步数（2: 30-100；2.5/3: 4-8）' },
  cfgScale: { label: 'cfg_scale', type: 'number', min: 1, max: 25, placeholder: '默认', hint: 'Stable Audio 提示词遵循度（2 默认 7，2.5/3 默认 1）' },
}

function specOf(key: FieldKey, presets?: string[]): FieldSpec {
  return { key, ...SPECS[key], ...(presets === undefined ? {} : { presets }) }
}

/** 各 preset 支持的音效输出编码（ElevenLabs 为 output_format 的 codec；Stability 为 mp3/wav）。 */
const SFX_FORMATS: Record<string, string[]> = {
  [PRESET_ELEVENLABS]: ['mp3', 'pcm', 'ulaw', 'alaw', 'opus'],
  [PRESET_STABILITY]: ['mp3', 'wav'],
}

/** ElevenLabs 音效 output_format 的采样率（Hz）与码率（kbps）枚举。 */
const ELEVENLABS_SFX_SAMPLE_RATES: string[] = ['8000', '16000', '22050', '24000', '32000', '44100', '48000']
const ELEVENLABS_SFX_BITRATES: string[] = ['32', '48', '64', '96', '128', '192']

/** 按（字段 × 渠道 preset × 模式）给出该字段的选项；未知组合返回 undefined（调用方回退全局选项）。
 *  全局字段与「每模型覆盖」矩阵共用同一份枚举，避免两处选项不一致。 */
export function fieldOptionsFor(key: FieldKey, preset: string, mode?: AudioMode): string[] | undefined {
  const p = preset.toLowerCase()
  if (key === 'format') {
    if (mode === 'sfx') return SFX_FORMATS[p] ?? ['mp3', 'wav', 'pcm']
    if (mode === 'music') return MUSIC_FORMATS[p] ?? ['mp3', 'wav', 'pcm']
    return undefined
  }
  if (key === 'sampleRate') {
    return p === PRESET_ELEVENLABS ? ELEVENLABS_SFX_SAMPLE_RATES : p === PRESET_MINIMAX ? SPECS.sampleRate.options : undefined
  }
  if (key === 'bitrate') {
    return p === PRESET_ELEVENLABS ? ELEVENLABS_SFX_BITRATES : p === PRESET_MINIMAX ? SPECS.bitrate.options : undefined
  }
  return undefined
}

/** 当前模式 + 所选模型集合（渠道集合）对应的「全局字段」清单。 */
export function globalFieldSpecs(mode: AudioMode | 'voice_recommend', presets: string[]): FieldSpec[] {
  if (mode === 'voice_recommend') return []
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
    // 格式选项取所有选中渠道支持的交集（无交集则回退 mp3）
    const supported: string[][] = presets.length === 0 ? [['mp3', 'wav', 'pcm']] : presets.map(preset => SFX_FORMATS[preset.toLowerCase()] ?? ['mp3', 'wav'])
    const intersect: string[] = supported.reduce<string[]>((acc, cur) => acc.filter(item => cur.includes(item)), supported[0] ?? ['mp3'])
    list.push({ ...specOf('format'), options: intersect.length > 0 ? intersect : ['mp3'] })
    if (all('loop', SFX_KEYS) && presets.length > 0) list.push(specOf('loop'))
    if (all('promptInfluence', SFX_KEYS) && presets.length > 0) list.push(specOf('promptInfluence'))
    // ElevenLabs 音效：采样率/码率与格式组合为 output_format（codec_sample_rate_bitrate），由引擎统一组合。
    if (all('sampleRate', SFX_KEYS) && presets.length > 0) {
      list.push({
        ...specOf('sampleRate'),
        options: presets.flatMap(preset => fieldOptionsFor('sampleRate', preset, mode) ?? []),
        placeholder: '默认（44100）',
        hint: 'ElevenLabs 音效采样率（Hz）：与格式/码率组合为 output_format（如 mp3_22050_32）；pcm/ulaw/alaw 不带码率',
      })
    }
    if (all('bitrate', SFX_KEYS) && presets.length > 0) {
      list.push({
        ...specOf('bitrate'),
        label: '码率（kbps）',
        options: presets.flatMap(preset => fieldOptionsFor('bitrate', preset, mode) ?? []),
        placeholder: '默认（128）',
        hint: 'ElevenLabs 音效码率（kbps，注意非 bps）：与格式/采样率组合为 output_format；192 需 Creator 及以上订阅',
      })
    }
    if (all('seed', SFX_KEYS) && presets.length > 0) list.push(specOf('seed'), specOf('steps'), specOf('cfgScale'))
  }
  return list
}

/** 「每模型参数覆盖」矩阵的字段全集（含适用渠道标注）。 */
export function overrideRowSpecs(mode: AudioMode | 'voice_recommend'): Array<FieldSpec & { presets: string[] }> {
  if (mode === 'voice_recommend') return []
  const rows: Array<FieldSpec & { presets: string[] }> = []
  const presets: Array<[FieldKey, string[]]> = [
    ['format', [PRESET_MINIMAX, PRESET_ELEVENLABS, PRESET_STABILITY]],
    ['duration', [PRESET_MINIMAX, PRESET_ELEVENLABS, PRESET_STABILITY]],
    ['voice', [PRESET_MINIMAX, PRESET_ELEVENLABS]],
    ['speed', [PRESET_MINIMAX, PRESET_ELEVENLABS]],
    ['lyrics', [PRESET_MINIMAX, PRESET_ELEVENLABS]],
    ['instrumental', [PRESET_MINIMAX, PRESET_ELEVENLABS]],
    // 采样率/码率：MiniMax 独立字段（各模式）；ElevenLabs 仅音效与格式组合为 output_format。
    ['sampleRate', mode === 'sfx' ? [PRESET_ELEVENLABS] : [PRESET_MINIMAX]],
    ['bitrate', mode === 'sfx' ? [PRESET_ELEVENLABS] : [PRESET_MINIMAX]],
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
