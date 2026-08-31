/**
 * Wire contract shared by the host and client halves of dsh-audiogen:
 * settings namespace, route paths, generate payload/result shapes.
 * Pure types and constants — safe for the client bundle to inline.
 */

/** Settings namespace this plugin owns (host settings seam + bridge). */
export const AUDIOGEN_SETTINGS_NAMESPACE = 'dsh-audiogen'

/** Published package version shared by the host updater and the client UI. */
export const PLUGIN_VERSION = '0.4.14'

/** Same-origin route family (loopback-only, mirroring dsh-imagegen). */
export const SETTINGS_API = {
  describe: '/api/dsh-audiogen/settings/describe',
  mutate: '/api/dsh-audiogen/settings/mutate',
} as const

/** The audio-generation proxy route. */
export const GENERATE_API = '/api/dsh-audiogen/generate' as const

/** Loopback-only task cancellation route (aborts the host-side upstream call). */
export const TASK_API = {
  cancel: '/api/dsh-audiogen/task/cancel',
} as const

/** Loopback-only prompt enhancement route (uses the agent's default model). */
export const ENHANCE_API = '/api/dsh-audiogen/prompt/enhance' as const

/** Host-mediated built-in provider catalog (channels the user can instantiate). */
export const PRESETS_API = '/api/dsh-audiogen/presets' as const

/** LLM 模型目录：提示词增强模型的候选（来自「设置 → 模型」各提供方）。 */
export const LLM_MODELS_API = '/api/dsh-audiogen/llm/models' as const

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

/** Host-persisted resource-library routes. */
export const LIBRARY_API = {
  list: '/api/dsh-audiogen/library/list',
  save: '/api/dsh-audiogen/library/save',
  update: '/api/dsh-audiogen/library/update',
  remove: '/api/dsh-audiogen/library/remove',
  audio: '/api/dsh-audiogen/library/audio',
} as const

/** Maximum number of history entries retained host-side (oldest evicted). */
export const HISTORY_MAX = 50

/** Audio generation modes. */
export type AudioMode = 'tts' | 'music' | 'sfx' | 'voice_design'

/** Resource-library entry kinds (map to directories under library/). */
export type LibraryType = 'voice' | 'music' | 'sfx' | 'tts'

/** Voice resources: gender bucket (male / female / custom). */
export type VoiceCategory = 'male' | 'female' | 'custom'

/** All library types, for iteration and validation. */
export const LIBRARY_TYPES: readonly LibraryType[] = ['voice', 'music', 'sfx', 'tts'] as const

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

/** 一个「设置 → 模型」中的 LLM 候选模型（提示词增强模型下拉用）。 */
export interface LlmModelOption {
  /** 提供方路由（如 deepseek-official / google）。 */
  provider: string
  /** 提供方展示名（如 DeepSeek / google）。 */
  providerName: string
  /** 模型 id（上游型号，如 deepseek-v4-flash-vision-exp）。 */
  id: string
  /** 模型展示名。 */
  name: string
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
  /** Stable Audio 随机种子（seed，0.4.134967294，默认 0=随机）。 */
  seed?: number
  /** Stable Audio 采样步数（steps，按模型收敛：stable-audio-2: 30-100；2.5/3: 4-8）。 */
  steps?: number
  /** Stable Audio 提示词遵循度（cfg_scale 1-25；stable-audio-2 默认 7，2.5/3 默认 1）。 */
  cfgScale?: number
  /** Output format, e.g. mp3, wav, pcm. */
  format?: string
  /** Channel this request targets (host falls back to default). */
  channelId?: string
  /** Channel display name snapshot (host-filled). */
  channel?: string
  /** Upstream model id actually sent (host-filled from alias mapping). */
  upstream?: string
  /** 客户端任务 id：宿主按 taskId 聚合 AbortController 支持真取消。 */
  taskId?: string

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
  /** MiniMax 采样率：16000/24000/32000.4.130/48000，默认 32000。 */
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
  /** 生成完成后自动保存到资源库（面板勾选；宿主还会并入 autoSaveToLibrary 设置）。 */
  saveToLibrary?: boolean
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
  /** File name inside the audio/ store dir. */
  file: string
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
  /** Full resolved generation-request snapshot (provenance; no secrets). */
  params?: Record<string, unknown>
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
  /** Full resolved generation-request snapshot (provenance; no secrets). */
  params?: Record<string, unknown>
}

// --------------------------------------------------------------- resource library

/** File name / id pair the client hands the host so it can copy a stored audio file. */
export interface LibraryAudioInput {
  /** Audio id (UUID) as stored in the audio/ dir. */
  id: string
  /** File name inside the audio/ dir (e.g. <uuid>.mp3). */
  file: string
  /** MIME type. */
  mime: string
  /** Optional generated voice id (voice_design outputs). */
  voiceId?: string
  /** Optional duration in seconds. */
  duration?: number
}

/** Full provenance of one library resource. */
export interface LibraryProvenance {
  mode: AudioMode
  prompt: string
  /** Channel display name snapshot. */
  channel?: string
  channelId?: string
  /** Provider API base URL (non-secret). */
  apiUrl?: string
  /** Model/voice alias as configured. */
  model?: string
  /** Upstream model/voice id actually sent to the provider. */
  upstream?: string
  /** Voice alias used for TTS. */
  voice?: string
  /** voiceId returned by the provider (voice_design). */
  voiceId?: string
  /** Full resolved generation-request snapshot (no secrets). */
  params?: Record<string, unknown>
}

/** One audio file inside a library entry. */
export interface LibraryFileRef {
  /** Same-origin URL (LIBRARY_API.audio/<rel>). */
  url: string
  /** Relative path under library/ (e.g. voice/male/<id>.mp3). */
  rel: string
  /** MIME type. */
  mime: string
  /** Exact encoded byte length. */
  bytes: number
  /** Duration in seconds when known. */
  duration?: number
  /** Optional generated voice id (voice_design outputs). */
  voiceId?: string
}

/** One curated resource in the library. */
export interface LibraryEntry {
  id: string
  createdAt: number
  type: LibraryType
  /** voice: male/female/custom; tts: the speaking voice key; others: ''. */
  category?: string
  name: string
  tags: string[]
  note?: string
  files: LibraryFileRef[]
  provenance: LibraryProvenance
}

/** Client → host save request (audioFiles reference files in the audio/ dir). */
export interface LibrarySaveRequest {
  audioFiles: LibraryAudioInput[]
  type: LibraryType
  category?: string
  name?: string
  tags?: string[]
  note?: string
  provenance: LibraryProvenance
}

/** Client → host update request (moving type/category relocates files). */
export interface LibraryUpdateRequest {
  id: string
  name?: string
  tags?: string[]
  note?: string
  category?: string
  type?: LibraryType
}

/** Default name length when no name was given. */
export const LIBRARY_NAME_MAX = 40

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
  /** 生成完成后自动加入资源库（面板与 Agent 生成均生效；单次可取消勾选）。 */
  autoSaveToLibrary?: boolean
  /** 最大并发生成数（同时打到上游的请求数，含对比任务内多模型）。默认 5。 */
  maxConcurrentGenerations?: number
}
