/**
 * The /api/dsh-audiogen route family:
 *  - a loopback-only settings bridge for the plugin's own namespace,
 *  - a presets route for the settings card,
 *  - the audio-generation proxy that keeps API keys host-side,
 *  - same-origin audio file serving and history persistence.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { SettingsConflictError, settingsNamespace, type SettingsDescriptor } from '@deepseek-ai/dsh-settings'
import { generateAudio, AudioGenError, type AudioChannel } from './audio-engine.ts'
import { listVendorVoices, listVendorVoicesWithFallback, deleteVendorVoice, type ListVoicesOptions, type VendorVoiceEntry } from './voice-manager.ts'
import { recommendVoices, type VoiceRecommendation } from './voice-recommend.ts'
import { appendVoiceRecommendRecord, listVoiceRecommendRecords, removeVoiceRecommendRecord } from './voice-recommend.ts'
import type { GenerationBudget } from './audio-scheduler.ts'
import { discoverAudioModels } from './audio-models.ts'
import { AUDIO_PRESETS } from './audio-presets.ts'
import { appendHistory, clearHistory, listHistory, readAudioFile, removeHistory, saveAudioFile, listLibrary, saveToLibrary, updateLibraryEntry, removeLibraryEntries, readLibraryFile } from './audio-store.ts'
import {
  AUDIO_API, AUDIOGEN_SETTINGS_NAMESPACE, ENHANCE_API, GENERATE_API, HISTORY_API, LIBRARY_API, LLM_MODELS_API, MODEL_API, PRESETS_API, SETTINGS_API, TASK_API, VOICES_API,
  LIBRARY_TYPES,
  type GenerateAudioRequest, type GeneratedAudio, type HistoryEntryInput, type LibraryAudioInput, type LibraryProvenance, type LibraryType, type LlmModelOption,
} from './protocol.ts'

const MAX_JSON_BODY_BYTES = 16 * 1024 * 1024

/** 宿主侧任务取消注册表：taskId → 该任务当前在途请求的 AbortController 集合。 */
const taskAborts = new Map<string, Set<AbortController>>()

/** Settings seam face the bridge needs. */
export interface SettingsSeam {
  describe(options?: { redactSecrets?: boolean }): SettingsDescriptor[]
  mutate(ns: unknown, ops: unknown, expectedRevision?: number): Promise<void>
  readonly writable?: boolean
}

/** The channels view used by routes and the host plugin. */
export interface ChannelsView {
  channels: AudioChannel[]
  defaultChannelId: string
}

/** Route dependencies. */
export interface AudiogenRoutesDeps {
  settings: SettingsSeam
  resolveChannels: () => ChannelsView
  /** Whether the auto-save-to-library setting is on. */
  autoSave: () => boolean
  /** Global upstream concurrency gate (maxConcurrentGenerations). */
  budget: GenerationBudget
  /** 提示词增强：调用 Agent 默认模型，返回增强后的文本。 */
  enhance: (prompt: string, mode: GenerateAudioRequest['mode']) => Promise<string>
  /** 音色推荐：需求描述 + 候选池 → top-k 推荐（复用 Agent 默认模型）。 */
  recommend: (requirement: string, candidates: VendorVoiceEntry[], topK: number) => Promise<VoiceRecommendation[]>
  /** 「设置 → 模型」提供方列表 + 各自可广播模型（增强模型下拉候选）。 */
  llmModelOptions: () => Promise<LlmModelOption[]>
}

function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

async function readJsonBody(req: IncomingMessage, maxBytes = MAX_JSON_BODY_BYTES): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > maxBytes) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseGenerateRequest(body: Record<string, unknown>): GenerateAudioRequest | undefined {
  const mode = body.mode === 'music' ? 'music' : body.mode === 'sfx' ? 'sfx' : body.mode === 'voice_design' ? 'voice_design' : 'tts'
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (prompt === '') return undefined
  const num = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined
  const str = (value: unknown): string | undefined => typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  const flag = (value: unknown): boolean | undefined => typeof value === 'boolean' ? value : undefined
  const tone = Array.isArray(body.pronunciationTone)
    ? body.pronunciationTone.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map(item => item.trim())
    : undefined
  const voiceModifyRaw = body.voiceModify
  const voiceModify = typeof voiceModifyRaw === 'object' && voiceModifyRaw !== null
    ? {
      ...(num((voiceModifyRaw as Record<string, unknown>).pitch) !== undefined ? { pitch: num((voiceModifyRaw as Record<string, unknown>).pitch)! } : {}),
      ...(num((voiceModifyRaw as Record<string, unknown>).intensity) !== undefined ? { intensity: num((voiceModifyRaw as Record<string, unknown>).intensity)! } : {}),
      ...(num((voiceModifyRaw as Record<string, unknown>).timbre) !== undefined ? { timbre: num((voiceModifyRaw as Record<string, unknown>).timbre)! } : {}),
      ...(str((voiceModifyRaw as Record<string, unknown>).soundEffects) !== undefined ? { soundEffects: str((voiceModifyRaw as Record<string, unknown>).soundEffects)! } : {}),
    }
    : undefined
  const timbreWeights = Array.isArray(body.timbreWeights)
    ? body.timbreWeights
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).voiceId === 'string' && typeof (item as Record<string, unknown>).weight === 'number')
      .map(item => ({ voiceId: (item.voiceId as string).trim(), weight: item.weight as number }))
      .filter(item => item.voiceId !== '')
    : undefined
  return {
    mode,
    model: typeof body.model === 'string' ? body.model.trim() : '',
    prompt,
    ...(typeof body.voice === 'string' && body.voice.trim() !== '' ? { voice: body.voice.trim() } : {}),
    ...(typeof body.previewText === 'string' && body.previewText.trim() !== '' ? { previewText: body.previewText.trim() } : {}),
    ...(num(body.speed) !== undefined ? { speed: num(body.speed)! } : {}),
    ...(num(body.duration) !== undefined ? { duration: num(body.duration)! } : {}),
    ...(typeof body.lyrics === 'string' && body.lyrics.trim() !== '' ? { lyrics: body.lyrics.trim() } : {}),
    ...(typeof body.isInstrumental === 'boolean' ? { isInstrumental: body.isInstrumental } : {}),
    ...(typeof body.loop === 'boolean' ? { loop: body.loop } : {}),
    ...(num(body.promptInfluence) !== undefined ? { promptInfluence: num(body.promptInfluence)! } : {}),
    ...(num(body.seed) !== undefined ? { seed: num(body.seed)! } : {}),
    ...(num(body.steps) !== undefined ? { steps: num(body.steps)! } : {}),
    ...(num(body.cfgScale) !== undefined ? { cfgScale: num(body.cfgScale)! } : {}),
    ...(typeof body.format === 'string' && body.format.trim() !== '' ? { format: body.format.trim() } : {}),
    ...(typeof body.channelId === 'string' && body.channelId !== '' ? { channelId: body.channelId } : {}),
    // 对比任务的任务 id：随 params 一起入历史，供客户端按 taskId 聚合出对比卡片。
    ...(typeof body.taskId === 'string' && body.taskId.trim() !== '' ? { taskId: body.taskId.trim() } : {}),
    // ---- MiniMax TTS 专属字段（其他厂商忽略） ----
    ...(str(body.emotion) !== undefined ? { emotion: str(body.emotion)! } : {}),
    ...(num(body.vol) !== undefined ? { vol: num(body.vol)! } : {}),
    ...(num(body.pitch) !== undefined ? { pitch: num(body.pitch)! } : {}),
    ...(flag(body.textNormalization) !== undefined ? { textNormalization: flag(body.textNormalization)! } : {}),
    ...(flag(body.latexRead) !== undefined ? { latexRead: flag(body.latexRead)! } : {}),
    ...(tone !== undefined && tone.length > 0 ? { pronunciationTone: tone } : {}),
    ...(num(body.sampleRate) !== undefined ? { sampleRate: num(body.sampleRate)! } : {}),
    ...(num(body.bitrate) !== undefined ? { bitrate: num(body.bitrate)! } : {}),
    ...(num(body.audioChannel) !== undefined ? { audioChannel: num(body.audioChannel)! } : {}),
    ...(flag(body.forceCbr) !== undefined ? { forceCbr: flag(body.forceCbr)! } : {}),
    ...(flag(body.subtitleEnable) !== undefined ? { subtitleEnable: flag(body.subtitleEnable)! } : {}),
    ...(flag(body.aigcWatermark) !== undefined ? { aigcWatermark: flag(body.aigcWatermark)! } : {}),
    ...(str(body.languageBoost) !== undefined ? { languageBoost: str(body.languageBoost)! } : {}),
    ...(voiceModify !== undefined ? { voiceModify } : {}),
    ...(timbreWeights !== undefined && timbreWeights.length > 0 ? { timbreWeights } : {}),
    ...(flag(body.saveToLibrary) !== undefined ? { saveToLibrary: flag(body.saveToLibrary)! } : {}),
  }
}

function toView(descriptor: SettingsDescriptor): Record<string, unknown> {
  return {
    ns: String(descriptor.ns),
    schema: descriptor.schema,
    value: descriptor.value,
    ...(descriptor.base === undefined ? {} : { base: descriptor.base }),
    ...(descriptor.user === undefined ? {} : { user: descriptor.user }),
    ...(descriptor.secrets === undefined ? {} : {
      secrets: descriptor.secrets.map(secret => ({ path: [...secret.path], set: secret.set })),
    }),
    revision: descriptor.revision,
  }
}

function failureOf(error: unknown): { ok: false; code: string; message: string } {
  if (error instanceof SettingsConflictError) {
    return { ok: false, code: 'settings-conflict', message: error.message }
  }
  return { ok: false, code: 'settings-rejected', message: error instanceof Error ? error.message : String(error) }
}

/**
 * Resolve a requested model alias onto a concrete channel/upstream id.
 */
function resolveChannelRequest(
  request: GenerateAudioRequest,
  view: ChannelsView,
): { ok: true; request: GenerateAudioRequest } | { ok: false; code: string; message: string } {
  if (view.channels.length === 0) {
    return { ok: false, code: 'no-channels', message: '尚未配置任何渠道：请先在「设置 → 插件 → AI 音频」添加渠道并填写 API 地址与密钥' }
  }
  const explicit = view.channels.find(candidate => candidate.id === request.channelId)
  const defaults = view.channels.find(candidate => candidate.id === view.defaultChannelId) ?? view.channels[0]
  const target = explicit ?? defaults
  const asked = request.model.trim()

  // 音色设计不按模型解析渠道：总是走 channelId（面板选择器）或默认渠道，
  // 并丢弃可能残留的模型值，避免上一个模式的模型把渠道带偏。
  if (request.mode === 'voice_design') {
    if (target === undefined) return { ok: false, code: 'no-channels', message: '尚未配置任何渠道' }
    return { ok: true, request: { ...request, model: '', upstream: undefined, channelId: target.id, channel: target.name } }
  }

  if (asked === '') {
    const alias = target?.models[0]?.alias ?? ''
    if (alias === '') {
      return { ok: false, code: 'no-models', message: `渠道「${target?.name ?? ''}」尚未配置模型/音色，请先在设置中添加` }
    }
    const mapping = target!.models.find(model => model.alias === alias)!
    return { ok: true, request: { ...request, model: alias, upstream: mapping.id, channelId: target!.id, channel: target!.name } }
  }
  const hosting = view.channels.filter(channel => channel.models.some(model => model.alias === asked))
  if (hosting.length === 0) {
    const available = [...new Set(view.channels.flatMap(channel => channel.models.map(model => model.alias)))]
    return { ok: false, code: 'audio-model-not-configured', message: `模型/音色「${asked}」未在任一渠道配置；可用：${available.join('、') || '（无）'}` }
  }
  const picked = target !== undefined && target.models.some(model => model.alias === asked) ? target : hosting[0]!
  const mapping = picked.models.find(model => model.alias === asked)!
  return { ok: true, request: { ...request, model: asked, upstream: mapping.id, channelId: picked.id, channel: picked.name } }
}

/** Build the library type from a generation mode (voice_design → voice). */
function libraryTypeOf(mode: GenerateAudioRequest['mode']): LibraryType {
  if (mode === 'voice_design') return 'voice'
  return mode
}

/** Provenance snapshot straight from a resolved generate request. */
function provenanceOf(request: GenerateAudioRequest, apiUrl: string, voiceId?: string): LibraryProvenance {
  return {
    mode: request.mode,
    prompt: request.prompt,
    ...(request.channel === undefined ? {} : { channel: request.channel }),
    ...(request.channelId === undefined ? {} : { channelId: request.channelId }),
    ...(apiUrl === '' ? {} : { apiUrl }),
    ...(request.model === undefined || request.model === '' ? {} : { model: request.model }),
    ...(request.upstream === undefined || request.upstream === '' ? {} : { upstream: request.upstream }),
    ...(request.voice === undefined ? {} : { voice: request.voice }),
    ...(request.previewText === undefined ? {} : { previewText: request.previewText }),
    ...(voiceId === undefined || voiceId === '' ? {} : { voiceId }),
    params: { ...request },
  }
}

const strOf = (value: unknown): string | undefined => typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
const strListOf = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map(item => item.trim()) : undefined
const parseModeOf = (value: unknown): GenerateAudioRequest['mode'] =>
  value === 'music' ? 'music' : value === 'sfx' ? 'sfx' : value === 'voice_design' ? 'voice_design' : 'tts'
const parseLibraryTypeOf = (value: unknown): LibraryType | undefined =>
  (LIBRARY_TYPES as readonly unknown[]).includes(value) ? value as LibraryType : undefined

/** File name (audio/ id.ext) from a same-origin audio url. */
function historyFileIdOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url, 'http://localhost').pathname.split('/').pop() ?? '')
  } catch {
    return ''
  }
}

/**
 * Fill missing provenance fields from host-persisted history (which carries
 * the resolved request snapshot) and the channel catalog. Client-supplied
 * values win when present.
 */
async function mergeLibraryProvenance(
  given: LibraryProvenance,
  files: LibraryAudioInput[],
  channels: AudioChannel[],
): Promise<LibraryProvenance> {
  const wanted = new Set(files.map(file => file.file))
  const history = await listHistory()
  const entry = history.find(candidate => candidate.audio.some(audio => wanted.has(historyFileIdOf(audio.url))))
  const params = entry?.params !== undefined && typeof entry.params === 'object' ? entry.params : undefined
  // 旧记录的 voiceId 只存在于 history audio 引用上（音频文件名匹配），也作兜底。
  const audioRef = entry?.audio.find(audio => wanted.has(historyFileIdOf(audio.url)))
  const channel = channels.find(candidate => candidate.id === (entry?.channelId ?? ''))
  return {
    mode: entry?.mode ?? given.mode,
    prompt: given.prompt !== '' ? given.prompt : (entry?.prompt ?? ''),
    ...(given.channel !== undefined || entry?.channel !== undefined ? { channel: given.channel ?? entry?.channel } : {}),
    ...(given.channelId !== undefined || entry?.channelId !== undefined ? { channelId: given.channelId ?? entry?.channelId } : {}),
    ...((given.apiUrl ?? channel?.apiUrl ?? '') === '' ? {} : { apiUrl: given.apiUrl ?? channel?.apiUrl }),
    ...(given.model !== undefined || entry?.model !== undefined ? { model: given.model ?? entry?.model } : {}),
    ...((given.upstream ?? (typeof params?.upstream === 'string' ? params.upstream : undefined)) !== undefined
      ? { upstream: given.upstream ?? (typeof params?.upstream === 'string' ? params.upstream : undefined) } : {}),
    ...(given.voice !== undefined || entry?.voice !== undefined ? { voice: given.voice ?? entry?.voice } : {}),
    ...(given.previewText !== undefined || entry?.previewText !== undefined ? { previewText: given.previewText ?? entry?.previewText } : {}),
    ...(given.voiceId !== undefined || entry?.voiceId !== undefined || audioRef?.voiceId !== undefined
      ? { voiceId: given.voiceId ?? entry?.voiceId ?? audioRef?.voiceId } : {}),
    ...(given.params !== undefined || params !== undefined ? { params: given.params ?? params } : {}),
  }
}

/** 从请求体解析音色列表/推荐共用的筛选选项。 */
function voiceListOptionsOf(body: Record<string, unknown> | undefined): ListVoicesOptions {
  const str = (key: string): string | undefined => {
    const value = body?.[key]
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  }
  const filters = {
    ...(str('search') === undefined ? {} : { search: str('search')! }),
    ...(str('use_case') === undefined ? {} : { use_case: str('use_case')! }),
    ...(str('accent') === undefined ? {} : { accent: str('accent')! }),
    ...(str('gender') === undefined ? {} : { gender: str('gender')! }),
    ...(str('age') === undefined ? {} : { age: str('age')! }),
    ...(str('locale') === undefined ? {} : { locale: str('locale')! }),
    ...(str('category') === undefined ? {} : { category: str('category')! }),
    ...(str('sort') === undefined ? {} : { sort: str('sort')! }),
    ...(body?.featured === true ? { featured: true } : {}),
    ...(body?.free_users_allowed === true ? { free_users_allowed: true } : {}),
    ...(body?.descriptive === true ? { descriptive: true } : {}),
  }
  return {
    ...(str('language') === undefined ? {} : { language: str('language')! }),
    ...(str('keyword') === undefined ? {} : { keyword: str('keyword')! }),
    ...(str('source') === undefined ? {} : { source: str('source')! }),
    ...(typeof body?.limit === 'number' && Number.isFinite(body.limit) ? { limit: Math.floor(body.limit) } : {}),
    ...(Object.keys(filters).length === 0 ? {} : { serverFilters: filters }),
  }
}

/** 推荐记录的筛选条件快照（面板展示用，不含密钥）。 */
function recommendFiltersOf(body: Record<string, unknown> | undefined): Record<string, string | boolean> {
  const str = (key: string): string | undefined => {
    const value = body?.[key]
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
  }
  const out: Record<string, string | boolean> = {}
  for (const key of ['language', 'keyword', 'source', 'search', 'use_case', 'accent', 'gender', 'age', 'locale', 'category', 'sort'] as const) {
    const value = str(key)
    if (value !== undefined) out[key] = value
  }
  if (body?.featured === true) out.featured = true
  if (body?.free_users_allowed === true) out.free_users_allowed = true
  return out
}

/** Build every /api/dsh-audiogen route. */
export function makeRoutes(deps: AudiogenRoutesDeps): WebRoute[] {  const guard = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { error: 'forbidden: loopback-only' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { error: `method not allowed: ${req.method}` })
      return false
    }
    return true
  }

  /** Resolve the target channel by name/id, falling back to the default one. */
  const channelOf = (view: ChannelsView, wanted: unknown): AudioChannel | undefined => {
    const usable = view.channels.filter(channel => channel.apiUrl.trim() !== '' && channel.apiKey.trim() !== '')
    if (usable.length === 0) return undefined
    const name = typeof wanted === 'string' ? wanted.trim() : ''
    if (name !== '') {
      const direct = usable.find(channel => channel.name === name || channel.id === name)
      if (direct !== undefined) return direct
    }
    return usable.find(channel => channel.id === view.defaultChannelId) ?? usable[0]
  }

  const audioFileFrom = (rawUrl: string | undefined, basePath: string): string | undefined => {
    if (rawUrl === undefined) return undefined
    let pathname: string
    try {
      pathname = new URL(rawUrl, 'http://localhost').pathname
    } catch {
      return undefined
    }
    if (!pathname.startsWith(`${basePath}/`)) return undefined
    return decodeURIComponent(pathname.slice(basePath.length + 1))
  }

  return [
    // ---------------------------------------------------------- presets
    {
      kind: 'exact',
      path: PRESETS_API,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        writeJson(res, 200, { ok: true, presets: AUDIO_PRESETS })
      },
    },
    // --------------------------------------------- LLM models (enhance)
    {
      kind: 'exact',
      path: LLM_MODELS_API,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        try {
          const providers = await deps.llmModelOptions()
          writeJson(res, 200, { ok: true, providers })
        } catch (error) {
          writeJson(res, 200, { ok: false, code: 'llm-models-failed', message: messageOf(error) })
        }
      },
    },
    // ---------------------------------------------- model/voice discovery
    {
      kind: 'exact',
      path: MODEL_API.discover,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const view = deps.resolveChannels()
        const stored = view.channels.find(candidate => candidate.id === (typeof body?.channelId === 'string' ? body.channelId : undefined))
          ?? view.channels.find(candidate => candidate.id === view.defaultChannelId)
          ?? view.channels[0]
        const channel: AudioChannel = {
          id: stored?.id ?? 'preview',
          // The draft's own preset wins (even when empty = custom): discovery
          // must follow the vendor being configured, not the default channel.
          preset: typeof body?.preset === 'string' ? body.preset.trim() : (stored?.preset ?? ''),
          name: stored?.name ?? '',
          apiUrl: typeof body?.apiUrl === 'string' && body.apiUrl.trim() !== '' ? body.apiUrl.trim() : (stored?.apiUrl ?? ''),
          apiKey: typeof body?.apiKey === 'string' && body.apiKey.trim() !== '' ? body.apiKey.trim() : (stored?.apiKey ?? ''),
          models: stored?.models ?? [],
        }
        try {
          writeJson(res, 200, { ok: true, ...await discoverAudioModels(channel) })
        } catch (error) {
          writeJson(res, 200, { ok: false, code: 'model-discovery-failed', message: messageOf(error) })
        }
      },
    },
    // ------------------------------------------------- vendor voice browse
    {
      kind: 'exact',
      path: VOICES_API.list,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req) as Record<string, unknown> | undefined
        const channel = channelOf(deps.resolveChannels(), body?.channel)
        if (channel === undefined) {
          writeJson(res, 200, { ok: false, code: 'channel-not-configured', message: '没有可用的音频渠道（需要已配置 API 地址与密钥），请先在设置中添加。' })
          return
        }
        try {
          const result = await listVendorVoicesWithFallback(channel, voiceListOptionsOf(body))
          writeJson(res, 200, {
            ok: true,
            vendor: result.vendor,
            channel: channel.name,
            voices: result.voices,
            truncated: result.truncated,
            ...(result.note === undefined ? {} : { note: result.note }),
          })
        } catch (error) {
          writeJson(res, 200, { ok: false, code: 'voice-list-failed', message: messageOf(error) })
        }
      },
    },
    // ------------------------------------------------- vendor voice delete
    {
      kind: 'exact',
      path: VOICES_API.delete,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req) as Record<string, unknown> | undefined
        const channel = channelOf(deps.resolveChannels(), body?.channel)
        if (channel === undefined) {
          writeJson(res, 200, { ok: false, code: 'channel-not-configured', message: '没有可用的音频渠道（需要已配置 API 地址与密钥），请先在设置中添加。' })
          return
        }
        const voiceId = typeof body?.voice_id === 'string' ? body.voice_id.trim() : ''
        if (voiceId === '') {
          writeJson(res, 200, { ok: false, code: 'voice-id-required', message: 'voice_id 不能为空。' })
          return
        }
        if (body?.confirm !== true) {
          writeJson(res, 200, { ok: false, code: 'voice-delete-requires-confirm', message: '删除不可逆：请确认勾选后再执行。' })
          return
        }
        try {
          const result = await deleteVendorVoice(channel, voiceId)
          writeJson(res, 200, { ok: true, ...result })
        } catch (error) {
          writeJson(res, 200, { ok: false, code: 'voice-delete-failed', message: messageOf(error) })
        }
      },
    },
    // ------------------------------------------ vendor voice recommend (LLM)
    {
      kind: 'exact',
      path: VOICES_API.recommend,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req) as Record<string, unknown> | undefined
        const requirement = typeof body?.requirement === 'string' ? body.requirement.trim() : ''
        if (requirement === '') {
          writeJson(res, 200, { ok: false, code: 'recommend-requirement-required', message: '需求描述（requirement）不能为空。' })
          return
        }
        const channel = channelOf(deps.resolveChannels(), body?.channel)
        if (channel === undefined) {
          writeJson(res, 200, { ok: false, code: 'channel-not-configured', message: '没有可用的音频渠道（需要已配置 API 地址与密钥），请先在设置中添加。' })
          return
        }
        const rawTopK = body?.top_k
        const topK = typeof rawTopK === 'number' && Number.isFinite(rawTopK)
          ? Math.max(1, Math.min(10, Math.floor(rawTopK)))
          : 5
        try {
          // 推荐面向足够宽的候选池：不传 limit 用默认上限，避免默认 100 太窄。
          const result = await listVendorVoicesWithFallback(channel, {
            ...voiceListOptionsOf(body),
            limit: 500,
          })
          const recommendations = await deps.recommend(requirement, result.voices, topK)
          // 记录本次推荐（最近 50 条，先记录后返回；失败不影响结果）。
          void appendVoiceRecommendRecord({
            channel: channel.name,
            vendor: result.vendor,
            requirement,
            candidate_count: result.voices.length,
            top_k: topK,
            channel_id: channel.id,
            filters: recommendFiltersOf(body),
            recommendations: recommendations.map(item => ({
              voice_id: item.voice_id,
              name: item.name,
              source: item.source,
              deletable: item.deletable,
              ...(item.language === undefined ? {} : { language: item.language }),
              ...(item.accent === undefined ? {} : { accent: item.accent }),
              ...(item.gender === undefined ? {} : { gender: item.gender }),
              ...(item.age === undefined ? {} : { age: item.age }),
              ...(item.use_case === undefined ? {} : { use_case: item.use_case }),
              ...(item.description === undefined ? {} : { description: item.description }),
              ...(item.preview_url === undefined ? {} : { preview_url: item.preview_url }),
              reason: item.reason,
            })),
          }).catch(() => { /* best-effort */ })
          writeJson(res, 200, {
            ok: true,
            vendor: result.vendor,
            channel: channel.name,
            requirement,
            candidate_count: result.voices.length,
            top_k: topK,
            recommendations,
            recorded: true,
            ...(result.note === undefined ? {} : { note: result.note }),
          })
        } catch (error) {
          writeJson(res, 200, { ok: false, code: 'voice-recommend-failed', message: messageOf(error) })
        }
      },
    },
    // ------------------------------------------ voice recommend history (records)
    {
      kind: 'exact',
      path: VOICES_API.recommendHistory.list,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req) as Record<string, unknown> | undefined
        const rawLimit = body?.limit
        const limit = typeof rawLimit === 'number' && Number.isFinite(rawLimit)
          ? Math.max(1, Math.min(50, Math.floor(rawLimit)))
          : 20
        const entries = await listVoiceRecommendRecords(limit)
        writeJson(res, 200, { ok: true, count: entries.length, entries })
      },
    },
    {
      kind: 'exact',
      path: VOICES_API.recommendHistory.remove,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req) as Record<string, unknown> | undefined
        const id = typeof body?.id === 'string' ? body.id.trim() : ''
        if (id === '') {
          writeJson(res, 200, { ok: false, code: 'record-id-required', message: 'record id 不能为空。' })
          return
        }
        try {
          await removeVoiceRecommendRecord(id)
          writeJson(res, 200, { ok: true, removed: id })
        } catch (error) {
          writeJson(res, 200, { ok: false, code: 'record-remove-failed', message: messageOf(error) })
        }
      },
    },
    // -------------------------------------------------- settings describe
    {
      kind: 'exact',
      path: SETTINGS_API.describe,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const descriptor = deps.settings.describe({ redactSecrets: true })
          .find(candidate => String(candidate.ns) === AUDIOGEN_SETTINGS_NAMESPACE)
        writeJson(res, 200, {
          ok: true,
          value: {
            namespaces: descriptor === undefined ? [] : [toView(descriptor)],
            writable: deps.settings.writable !== false,
          },
        })
      },
    },
    // ----------------------------------------------------- settings mutate
    {
      kind: 'exact',
      path: SETTINGS_API.mutate,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        if (body === undefined) {
          writeJson(res, 200, { ok: false, code: 'settings-rejected', message: 'unreadable JSON body' })
          return
        }
        const ns = typeof body.ns === 'string' ? body.ns : ''
        if (ns !== AUDIOGEN_SETTINGS_NAMESPACE || !Array.isArray(body.ops)) {
          writeJson(res, 200, { ok: false, code: 'settings-rejected', message: 'malformed bridge settings request' })
          return
        }
        const expectedRevision = typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined
        try {
          await deps.settings.mutate(settingsNamespace(ns), body.ops, expectedRevision)
        } catch (error) {
          writeJson(res, 200, failureOf(error))
          return
        }
        const descriptor = deps.settings.describe({ redactSecrets: true })
          .find(candidate => String(candidate.ns) === ns)
        if (descriptor === undefined) {
          writeJson(res, 200, { ok: false, code: 'internal', message: `settings namespace "${ns}" was disposed after the mutate` })
          return
        }
        writeJson(res, 200, { ok: true, value: toView(descriptor) })
      },
    },
    // ----------------------------------------------------------- generate
    {
      kind: 'exact',
      path: GENERATE_API,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const parsed = body === undefined ? undefined : parseGenerateRequest(body)
        if (parsed === undefined) {
          writeJson(res, 200, { ok: false, code: 'bad-request', message: 'prompt/text is required' })
          return
        }
        const view = deps.resolveChannels()
        const resolved = resolveChannelRequest(parsed, view)
        if (!resolved.ok) {
          writeJson(res, 200, { ok: false, code: resolved.code, message: resolved.message })
          return
        }
        const request = resolved.request
        const channel = view.channels.find(candidate => candidate.id === request.channelId)!
        // 任务取消支持：同一 taskId 可能对应多个并行子请求（对比任务），
        // 宿主侧各自持有 AbortController，取消端点统一 abort。
        const taskId = typeof body?.taskId === 'string' && body.taskId.trim() !== '' ? body.taskId.trim() : ''
        const controller = new AbortController()
        if (taskId !== '') {
          const set = taskAborts.get(taskId) ?? new Set<AbortController>()
          set.add(controller)
          taskAborts.set(taskId, set)
        }
        try {
          // 全局并发闸门：与 Agent 工具共享「最大并发生成数」上限。
          const release = await deps.budget.acquire(controller.signal)
          let outputs
          try {
            outputs = await generateAudio(channel, request, controller.signal)
          } finally {
            release()
          }
          const generated: GeneratedAudio[] = []
          for (const [index, output] of outputs.entries()) {
            const saved = await saveAudioFile(output.data, output.mime, `generated-${index + 1}`)
            generated.push({
              id: saved.id,
              file: saved.file,
              b64: Buffer.from(output.data).toString('base64'),
              mime: saved.mime,
              bytes: saved.bytes,
              url: `${AUDIO_API.file}/${encodeURIComponent(saved.file)}`,
              ...(output.voiceId === undefined ? {} : { voiceId: output.voiceId }),
            })
          }
          const paramsSnapshot: Record<string, unknown> = { ...request }
          let history
          try {
            history = await appendHistory({
              id: randomUUID(),
              createdAt: Date.now(),
              mode: request.mode,
              model: request.model,
              prompt: request.prompt,
              ...(request.voice === undefined ? {} : { voice: request.voice }),
              ...(request.previewText === undefined ? {} : { previewText: request.previewText }),
              ...(request.speed === undefined ? {} : { speed: request.speed }),
              ...(request.duration === undefined ? {} : { duration: request.duration }),
              ...(request.format === undefined ? {} : { format: request.format }),
              audio: generated,
              ...(request.channelId === undefined ? {} : { channelId: request.channelId }),
              ...(request.channel === undefined ? {} : { channel: request.channel }),
              params: paramsSnapshot,
            })
          } catch (error) {
            writeJson(res, 200, { ok: true, outputs: generated, historyError: messageOf(error) })
            return
          }
          // ---- 资源库：单次勾选或设置自动入库（saveToLibrary === false 显式跳过） ----
          const wantSave = request.saveToLibrary === true || (deps.autoSave() && request.saveToLibrary !== false)
          let resources: Array<{ id: string; name: string; type: LibraryType }> | undefined
          if (wantSave) {
            try {
              const entry = await saveToLibrary({
                audioFiles: generated.map(audio => ({
                  id: audio.id,
                  file: audio.file,
                  mime: audio.mime,
                  ...(audio.voiceId === undefined ? {} : { voiceId: audio.voiceId }),
                })),
                type: libraryTypeOf(request.mode),
                provenance: provenanceOf(request, channel.apiUrl, generated[0]?.voiceId),
              })
              resources = [{ id: entry.id, name: entry.name, type: entry.type }]
            } catch {
              // library-save is best-effort: generation and history already succeeded
            }
          }
          // ---- 音乐兜底提示：未提供歌词时引擎按纯音乐生成，告知前端一声 ----
          const instrumentalFallback = request.mode === 'music'
            && request.isInstrumental !== true
            && (request.lyrics === undefined || request.lyrics.trim() === '')
          const note = instrumentalFallback ? '未提供歌词，已按纯音乐生成' : undefined
          writeJson(res, 200, { ok: true, outputs: generated, history, ...(resources === undefined ? {} : { resources }), ...(note === undefined ? {} : { note }) })
        } catch (error) {
          const code = error instanceof AudioGenError ? error.code : 'generate-failed'
          writeJson(res, 200, { ok: false, code, message: messageOf(error) })
        } finally {
          if (taskId !== '') {
            const set = taskAborts.get(taskId)
            set?.delete(controller)
            if (set !== undefined && set.size === 0) taskAborts.delete(taskId)
          }
        }
      },
    },
    // ---------------------------------------------------------- task cancel
    {
      kind: 'exact',
      path: TASK_API.cancel,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const taskId = typeof body?.taskId === 'string' ? body.taskId.trim() : ''
        if (taskId === '') {
          writeJson(res, 200, { ok: false, code: 'bad-request', message: 'taskId is required' })
          return
        }
        const controllers = taskAborts.get(taskId)
        if (controllers !== undefined) {
          for (const controller of controllers) controller.abort()
          taskAborts.delete(taskId)
        }
        writeJson(res, 200, { ok: true, aborted: controllers !== undefined ? controllers.size : 0 })
      },
    },
    // ------------------------------------------------------- prompt enhance
    {
      kind: 'exact',
      path: ENHANCE_API,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : ''
        if (prompt === '') {
          writeJson(res, 200, { ok: false, code: 'bad-request', message: 'prompt is required' })
          return
        }
        const mode = body?.mode === 'music' ? 'music' : body?.mode === 'sfx' ? 'sfx' : body?.mode === 'voice_design' ? 'voice_design' : 'tts'
        try {
          const enhanced = await deps.enhance(prompt, mode)
          writeJson(res, 200, { ok: true, enhanced })
        } catch (error) {
          writeJson(res, 200, { ok: false, code: 'enhance-failed', message: messageOf(error) })
        }
      },
    },
    // ----------------------------------------------------------- audio file
    {
      kind: 'prefix',
      path: AUDIO_API.file,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) {
          writeJson(res, 403, { error: 'forbidden: loopback-only' })
          return
        }
        if (req.method !== 'GET') {
          writeJson(res, 405, { error: `method not allowed: ${req.method}` })
          return
        }
        const file = audioFileFrom(req.url, AUDIO_API.file)
        if (file === undefined) {
          writeJson(res, 400, { error: 'invalid audio file' })
          return
        }
        const stored = await readAudioFile(file)
        if (stored === undefined) {
          writeJson(res, 404, { error: 'audio not found' })
          return
        }
        res.writeHead(200, {
          'content-type': stored.mime,
          'content-length': stored.bytes,
          'cache-control': 'private, max-age=3600',
        })
        res.end(stored.data)
      },
    },
    // ------------------------------------------------------- resource library
    {
      kind: 'exact', path: LIBRARY_API.list,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        writeJson(res, 200, { ok: true, entries: await listLibrary() })
      },
    },
    {
      kind: 'exact', path: LIBRARY_API.save,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const audioFiles: LibraryAudioInput[] = Array.isArray(body?.audioFiles)
          ? body.audioFiles
            .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
            .map(item => ({
              id: strOf(item.id) ?? '',
              file: strOf(item.file) ?? '',
              mime: strOf(item.mime) ?? 'audio/mpeg',
              ...(strOf(item.voiceId) !== undefined ? { voiceId: strOf(item.voiceId)! } : {}),
              ...(typeof item.duration === 'number' && Number.isFinite(item.duration) ? { duration: item.duration } : {}),
            }))
            .filter(item => item.id !== '' && item.file !== '')
          : []
        if (audioFiles.length === 0) {
          writeJson(res, 200, { ok: false, code: 'bad-request', message: '没有可入库的音频文件' })
          return
        }
        const type = parseLibraryTypeOf(body?.type)
        if (type === undefined) {
          writeJson(res, 200, { ok: false, code: 'bad-request', message: '资源类型无效（voice/music/sfx/tts）' })
          return
        }
        const rawProvenance = typeof body?.provenance === 'object' && body.provenance !== null ? body.provenance as Record<string, unknown> : {}
        const provenance = await mergeLibraryProvenance({
          mode: parseModeOf(rawProvenance.mode),
          prompt: typeof rawProvenance.prompt === 'string' ? rawProvenance.prompt.trim() : '',
          ...(strOf(rawProvenance.channel) !== undefined ? { channel: strOf(rawProvenance.channel)! } : {}),
          ...(strOf(rawProvenance.channelId) !== undefined ? { channelId: strOf(rawProvenance.channelId)! } : {}),
          ...(strOf(rawProvenance.apiUrl) !== undefined ? { apiUrl: strOf(rawProvenance.apiUrl)! } : {}),
          ...(strOf(rawProvenance.model) !== undefined ? { model: strOf(rawProvenance.model)! } : {}),
          ...(strOf(rawProvenance.upstream) !== undefined ? { upstream: strOf(rawProvenance.upstream)! } : {}),
          ...(strOf(rawProvenance.voice) !== undefined ? { voice: strOf(rawProvenance.voice)! } : {}),
          ...(strOf(rawProvenance.previewText) !== undefined ? { previewText: strOf(rawProvenance.previewText)! } : {}),
          ...(strOf(rawProvenance.voiceId) !== undefined ? { voiceId: strOf(rawProvenance.voiceId)! } : {}),
          ...(typeof rawProvenance.params === 'object' && rawProvenance.params !== null
            ? { params: rawProvenance.params as Record<string, unknown> } : {}),
        }, audioFiles, deps.resolveChannels().channels)
        try {
          const entry = await saveToLibrary({
            audioFiles,
            type,
            ...(strOf(body?.category) !== undefined ? { category: strOf(body?.category)! } : {}),
            ...(strOf(body?.name) !== undefined ? { name: strOf(body?.name)! } : {}),
            ...(strListOf(body?.tags) !== undefined ? { tags: strListOf(body?.tags)! } : {}),
            ...(strOf(body?.note) !== undefined ? { note: strOf(body?.note)! } : {}),
            provenance,
          })
          writeJson(res, 200, { ok: true, entry })
        } catch (error) {
          writeJson(res, 200, { ok: false, code: 'library-save-failed', message: messageOf(error) })
        }
      },
    },
    {
      kind: 'exact', path: LIBRARY_API.update,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const id = strOf(body?.id)
        if (id === undefined) {
          writeJson(res, 200, { ok: false, code: 'bad-request', message: '缺少资源 id' })
          return
        }
        try {
          const entry = await updateLibraryEntry(id, {
            ...(strOf(body?.name) !== undefined ? { name: strOf(body?.name)! } : {}),
            ...(strListOf(body?.tags) !== undefined ? { tags: strListOf(body?.tags)! } : {}),
            ...(typeof body?.note === 'string' ? { note: body.note } : {}),
            ...(strOf(body?.category) !== undefined ? { category: strOf(body?.category)! } : {}),
            ...(parseLibraryTypeOf(body?.type) !== undefined ? { type: parseLibraryTypeOf(body?.type)! } : {}),
          })
          if (entry === undefined) {
            writeJson(res, 200, { ok: false, code: 'not-found', message: '资源不存在' })
            return
          }
          writeJson(res, 200, { ok: true, entry })
        } catch (error) {
          writeJson(res, 200, { ok: false, code: 'library-update-failed', message: messageOf(error) })
        }
      },
    },
    {
      kind: 'exact', path: LIBRARY_API.remove,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const ids = strListOf(body?.ids) ?? []
        if (ids.length === 0) {
          writeJson(res, 200, { ok: false, code: 'bad-request', message: '缺少资源 id' })
          return
        }
        try {
          const entries = await removeLibraryEntries(ids)
          writeJson(res, 200, { ok: true, entries })
        } catch (error) {
          writeJson(res, 200, { ok: false, code: 'library-remove-failed', message: messageOf(error) })
        }
      },
    },
    {
      kind: 'prefix', path: LIBRARY_API.audio,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) {
          writeJson(res, 403, { error: 'forbidden: loopback-only' })
          return
        }
        if (req.method !== 'GET') {
          writeJson(res, 405, { error: `method not allowed: ${req.method}` })
          return
        }
        const rel = audioFileFrom(req.url, LIBRARY_API.audio)
        if (rel === undefined) {
          writeJson(res, 400, { error: 'invalid library audio' })
          return
        }
        const stored = await readLibraryFile(rel)
        if (stored === undefined) {
          writeJson(res, 404, { error: 'library audio not found' })
          return
        }
        res.writeHead(200, { 'content-type': stored.mime, 'content-length': stored.bytes, 'cache-control': 'private, max-age=3600' })
        res.end(stored.data)
      },
    },
    // ------------------------------------------------------- history
    {
      kind: 'exact', path: HISTORY_API.list,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        writeJson(res, 200, { ok: true, history: await listHistory() })
      },
    },
    {
      kind: 'exact', path: HISTORY_API.clear,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        writeJson(res, 200, { ok: true, history: await clearHistory() })
      },
    },
    {
      kind: 'exact', path: HISTORY_API.remove,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const id = typeof body?.id === 'string' ? body.id : ''
        writeJson(res, 200, { ok: true, history: await removeHistory(id) })
      },
    },
    {
      kind: 'prefix', path: HISTORY_API.audio,
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) {
          writeJson(res, 403, { error: 'forbidden: loopback-only' })
          return
        }
        if (req.method !== 'GET') {
          writeJson(res, 405, { error: `method not allowed: ${req.method}` })
          return
        }
        const file = audioFileFrom(req.url, HISTORY_API.audio)
        if (file === undefined) {
          writeJson(res, 400, { error: 'invalid audio file' })
          return
        }
        const stored = await readAudioFile(file)
        if (stored === undefined) {
          writeJson(res, 404, { error: 'audio not found' })
          return
        }
        res.writeHead(200, { 'content-type': stored.mime, 'content-length': stored.bytes, 'cache-control': 'private, max-age=3600' })
        res.end(stored.data)
      },
    },
  ]
}
