/**
 * Wire contract shared by the host and client halves of dsh-audiogen:
 * settings namespace, route paths, generate payload/result shapes.
 * Pure types and constants — safe for the client bundle to inline.
 */

/** Settings namespace this plugin owns (host settings seam + bridge). */
export const AUDIOGEN_SETTINGS_NAMESPACE = 'dsh-audiogen'

/** Published package version shared by the host updater and the client UI. */
export const PLUGIN_VERSION = '0.3.5'

/** Same-origin route family (loopback-only, mirroring dsh-imagegen). */
export const SETTINGS_API = {
  describe: '/api/dsh-audiogen/settings/describe',
  mutate: '/api/dsh-audiogen/settings/mutate',
} as const

/** The audio-generation proxy route. */
export const GENERATE_API = '/api/dsh-audiogen/generate' as const

/** Host-mediated built-in provider catalog (channels the user can instantiate). */
export const PRESETS_API = '/api/dsh-audiogen/presets' as const

/** Host-mediated model/voice discovery endpoint. */
export const MODEL_API = {
  discover: '/api/dsh-audiogen/models/discover',
} as const

/** Loopback-only audio file reader for panel/tool-result previews. */
export const AUDIO_API = {
  file: '/api/dsh-audiogen/audio',
} as const

/** Host-persisted generation history routes. */
export const HISTORY_API = {
  list: '/api/dsh-audiogen/history/list',
  append: '/api/dsh-audiogen/history/append',
  remove: '/api/dsh-audiogen/history/remove',
  clear: '/api/dsh-audiogen/history/clear',
  audio: '/api/dsh-audiogen/history/audio',
} as const

/** Maximum number of history entries retained host-side (oldest evicted). */
export const HISTORY_MAX = 50

/** Audio generation modes. */
export type AudioMode = 'tts' | 'music' | 'sfx' | 'voice_design'

/** The capability category of an audio model/voice. */
export type AudioModelCategory =
  | 'tts'
  | 'music'
  | 'sfx'
  | 'voice_design'
  | 'voice_clone'

/** One model mapping in a channel's catalog: display alias → upstream id. */
export interface ModelMapping {
  /** User-facing model/voice name (defaults to the upstream id). */
  alias: string
  /** Upstream model or voice id sent to the provider. */
  id: string
  /** Optional capability category, used by the UI to group model lists. */
  category?: AudioModelCategory
}

/** A model/voice discovered from a vendor endpoint (not yet persisted). */
export interface DiscoveredAudioModel extends ModelMapping {
  /** Optional human-readable description from the vendor. */
  description?: string
}

/**
 * One configured audio channel (provider). Secrets never live here — the API
 * key is stored at `channelSecrets.<channelId>`.
 */
export interface ChannelConfig {
  /** Stable channel id (the channelSecrets dict is keyed by it). */
  id: string
  /** Preset provider id this channel was created from ('' = custom). */
  preset: string
  /** Display name shown in the list, panel, and Agent guidance. */
  name: string
  /** Provider base URL. */
  apiUrl: string
  /** The channel's model/voice catalog (alias → upstream id). */
  models: ModelMapping[]
}

/** One built-in provider as the settings card consumes it. */
export interface PresetProviderView {
  id: string
  name: string
  apiUrl: string
  hint: string
  /** Official vendor website, shown as a link in the channel editor. */
  site?: string
  models: ModelMapping[]
}

/** A client → host generate request. */
export interface GenerateAudioRequest {
  mode: AudioMode
  /** User-facing model/voice alias; host maps to upstream id. */
  model: string
  /** TTS text or music/sfx prompt. */
  prompt: string
  /** Optional voice alias for TTS. */
  voice?: string
  /** Optional preview text for voice-design APIs. */
  previewText?: string
  /** Optional speaking rate / speed multiplier. */
  speed?: number
  /** Requested duration in seconds (music/sfx). */
  duration?: number
  /** MiniMax 音乐生成歌词；music-3.0 / music-cover 在非纯音乐模式下必填。 */
  lyrics?: string
  /** MiniMax 是否生成纯音乐（无歌词/人声）；true 时 lyrics 可为空。 */
  isInstrumental?: boolean
  /** ElevenLabs 音效：生成无缝循环音效（loop，仅 eleven_text_to_sound_v2）。 */
  loop?: boolean
  /** ElevenLabs 音效：提示词影响度 0-1（prompt_influence，默认 0.3）。 */
  promptInfluence?: number
  /** Output format, e.g. mp3, wav, pcm. */
  format?: string
  /** Channel this request targets (host falls back to default). */
  channelId?: string
  /** Channel display name snapshot (host-filled). */
  channel?: string
  /** Upstream model id actually sent (host-filled from alias mapping). */
  upstream?: string

  // ---- MiniMax TTS 专属字段（其他厂商渠道忽略）——————
  /** MiniMax 音色情绪，如 happy/sad/angry/nervous/fearful/bored；默认按音色自身。 */
  emotion?: string
  /** MiniMax 音量，范围 0-10，默认 1。 */
  vol?: number
  /** MiniMax 音调偏移（半音），范围 -12~12，默认 0。 */
  pitch?: number
  /** MiniMax 文本归一化处理开关（默认 true）。 */
  textNormalization?: boolean
  /** MiniMax 数学公式朗读开关（默认 false）。 */
  latexRead?: boolean
  /** MiniMax 发音词典 tone 条目，元素形如 "处理/(chu3)(li3)" 或 "危险/dangerous"。 */
  pronunciationTone?: string[]
  /** MiniMax 采样率：16000/24000/32000/44100/48000，默认 32000。 */
  sampleRate?: number
  /** MiniMax 码率（bps）：64000-320000，默认 128000。 */
  bitrate?: number
  /** MiniMax 声道数：1 或 2，默认 1。 */
  audioChannel?: number
  /** MiniMax 强制 CBR 编码（avoid VBR），默认 false。 */
  forceCbr?: boolean
  /** MiniMax 字幕开关：true 时响应携带字幕内容/文件。 */
  subtitleEnable?: boolean
  /** MiniMax AIGC 水印开关。 */
  aigcWatermark?: boolean
  /** MiniMax 语言增强（language_boost），如"中英混读"，按模型支持情况。 */
  languageBoost?: string
  /** MiniMax 变声参数（voice_modify，speech-2.8 等支持）。 */
  voiceModify?: { pitch?: number; intensity?: number; timbre?: number; soundEffects?: string }
  /** MiniMax 双音色混合权重（timbre_weights）。 */
  timbreWeights?: Array<{ voiceId: string; weight: number }>
}

/** One generated audio, normalized host-side to base64. */
export interface GeneratedAudio {
  /** Raw base64 payload (no data: prefix). */
  b64: string
  /** MIME type, e.g. audio/mpeg. */
  mime: string
  /** Exact encoded byte length. */
  bytes: number
  /** Optional duration in seconds when the API reports one. */
  duration?: number
  /** Same-origin URL served by the host ('' when unavailable). */
  url: string
  /** Stable audio id / file name. */
  id: string
  /** Optional voice id returned by a voice-design API. */
  voiceId?: string
}

/** Successful generate outcome. */
export interface GenerateAudioResult {
  outputs: GeneratedAudio[]
  /** Updated host-persisted history, when returned. */
  history?: HistoryEntry[]
  /** Persistence failure after audio was generated. */
  historyError?: string
}

/** One audio reference as the browser consumes it. */
export interface HistoryAudioRef {
  /** Same-origin URL. */
  url: string
  /** MIME type, e.g. audio/mpeg. */
  mime: string
  /** Duration in seconds when known. */
  duration?: number
  /** Optional generated voice id. */
  voiceId?: string
}

/** A saved generation as the browser consumes it. */
export interface HistoryEntry {
  id: string
  createdAt: number
  mode: AudioMode
  model: string
  prompt: string
  voice?: string
  voiceId?: string
  speed?: number
  duration?: number
  format?: string
  audio: HistoryAudioRef[]
  channelId?: string
  channel?: string
}

/** A history entry the client submits for persistence (audio still carries base64). */
export interface HistoryEntryInput {
  id: string
  createdAt: number
  mode: AudioMode
  model: string
  prompt: string
  voice?: string
  voiceId?: string
  speed?: number
  duration?: number
  format?: string
  audio: GeneratedAudio[]
  channelId?: string
  channel?: string
}

/** The plugin settings fields edited by the settings card and panel. */
export interface AudiogenConfig {
  enabled?: boolean
  announceToAgent?: boolean
  allowAgentAudioGeneration?: boolean
  channels?: ChannelConfig[]
  channelSecrets?: Record<string, string>
  defaultChannelId?: string
  /** Optional default voice/model alias for quick generation. */
  defaultModel?: string
}
