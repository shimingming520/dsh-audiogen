/**
 * Upstream audio proxy engine.
 *
 * Normalizes a provider response into base64 audio payloads so the browser
 * never needs to talk to the upstream directly. Supports a small set of
 * built-in vendor presets plus a best-effort OpenAI-compatible / generic path.
 */

import type { AudioMode, GenerateAudioRequest, GeneratedAudio } from './protocol.ts'

/** Resolved channel (key included; never logged). */
export interface AudioChannel {
  id: string
  preset: string
  name: string
  apiUrl: string
  apiKey: string
  models: Array<{ alias: string; id: string }>
}

/** An audio generation failure with a user-presentable message. */
export class AudioGenError extends Error {
  readonly code: string

  constructor(message: string, code = 'audio-generate-failed') {
    super(message)
    this.name = 'AudioGenError'
    this.code = code
  }
}

/** Total budget for one upstream generation call. Audio models can be slow. */
const UPSTREAM_TIMEOUT_MS = 240_000
/** Budget for downloading one result audio URL. */
const AUDIO_FETCH_TIMEOUT_MS = 60_000

function requestSignal(source: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const abortFromSource = () => { controller.abort(source?.reason) }
  if (source?.aborted === true) abortFromSource()
  else source?.addEventListener('abort', abortFromSource, { once: true })
  const timeout = setTimeout(() => { controller.abort(new DOMException('The operation timed out.', 'TimeoutError')) }, timeoutMs)
  timeout.unref?.()
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout)
      source?.removeEventListener('abort', abortFromSource)
    },
  }
}

/** Detect a few common audio container formats from magic bytes. */
export function detectAudioMime(data: Uint8Array): string | undefined {
  if (data.length >= 4 && data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46) return 'audio/wav'
  if (data.length >= 3 && data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) return 'audio/mpeg'
  if (data.length >= 4 && data[0] === 0x66 && data[1] === 0x4c && data[2] === 0x61 && data[3] === 0x43) return 'audio/flac'
  if (data.length >= 4 && data[0] === 0x4f && data[1] === 0x67 && data[2] === 0x67 && data[3] === 0x53) return 'audio/ogg'
  if (data.length >= 4 && data[0] === 0x00 && data[1] === 0x00 && data[2] === 0x00 && data[3] === 0x18) return 'audio/mp4'
  if (data.length >= 4 && data[0] === 0x23 && data[1] === 0x21 && data[2] === 0x41 && data[3] === 0x4d) return 'audio/aiff'
  return undefined
}

function mimeFromContentType(value: string | null): string | undefined {
  if (value === null || value === '') return undefined
  const parts = value.split(';')
  for (const part of parts.slice(1)) {
    // `application/json; type=audio/mpeg` —— Stability 官方用该形式携带音频真实类型。
    const match = /^\s*type=([^;\s]+)/i.exec(part)
    if (match !== null) return match[1]!.trim().toLowerCase()
  }
  return parts[0]!.trim().toLowerCase()
}

function audioMime(data: Uint8Array, contentType: string | null): string {
  return detectAudioMime(data) ?? mimeFromContentType(contentType) ?? 'audio/mpeg'
}

function isPreset(channel: AudioChannel, id: string): boolean {
  return channel.preset === id || channel.apiUrl.toLowerCase().includes(id)
}

function isOpenAICompatible(channel: AudioChannel, mode: AudioMode): boolean {
  return isPreset(channel, 'openai')
    || /(^|\/)(v\d+\/)?audio\/speech$/i.test(channel.apiUrl.trim())
    || (channel.preset === 'custom' && mode === 'tts')
}

function isElevenLabs(channel: AudioChannel): boolean {
  return isPreset(channel, 'elevenlabs') || /elevenlabs/i.test(channel.apiUrl)
}

function isMiniMax(channel: AudioChannel): boolean {
  return isPreset(channel, 'minimax') || /minimax/i.test(channel.apiUrl)
}

function isStability(channel: AudioChannel): boolean {
  return isPreset(channel, 'stability') || /stability\.ai/i.test(channel.apiUrl)
}

function endpointBase(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function bytesToBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64')
}

/** Parse a base64 payload that may carry a data: prefix. */
function bareBase64(value: string): string {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(value.trim())
  if (match !== null && match[3] !== undefined) return match[3]
  return value
}

function asBase64(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') return bareBase64(value)
  return undefined
}

/** Recursively look for the first likely base64 audio string in a JSON payload. */
function findBase64Audio(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 100 && !/^https?:\/\//i.test(value.trim())) return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findBase64Audio(item)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  for (const key of ['audio', 'music', 'b64_json', 'base64', 'data', 'output', 'result', 'value']) {
    const candidate = record[key]
    const found = findBase64Audio(candidate)
    if (found !== undefined) return found
  }
  return undefined
}

/** Find the first provider-returned audio URL in a JSON payload. */
function findAudioUrl(value: unknown): string | undefined {
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findAudioUrl(item)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  for (const key of ['url', 'audio_url', 'href', 'link', 'audio', 'data', 'output', 'result', 'value']) {
    const candidate = record[key]
    const found = findAudioUrl(candidate)
    if (found !== undefined) return found
  }
  return undefined
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const budget = requestSignal(init.signal as AbortSignal | undefined, timeoutMs)
  try {
    return await fetch(url, { ...init, signal: budget.signal })
  } finally {
    budget.dispose()
  }
}

async function normalizeAudioResponse(
  response: Response,
  options: { apiKey: string; fallbackMime?: string },
): Promise<Array<{ data: Uint8Array; mime: string; voiceId?: string }>> {
  if (!response.ok) {
    let detail = ''
    try {
      const text = await response.text()
      detail = text.slice(0, 500)
    } catch {
      // keep empty
    }
    throw new AudioGenError(`audio API error (HTTP ${response.status})${detail === '' ? '' : `: ${detail}`}`, 'audio-api-error')
  }

  const contentType = mimeFromContentType(response.headers.get('content-type')) ?? options.fallbackMime
  const buffer = new Uint8Array(await response.arrayBuffer())
  // Some providers return binary audio directly, others JSON with base64/url.
  const text = new TextDecoder().decode(buffer).trim()
  if (text.startsWith('{') || text.startsWith('[')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new AudioGenError('audio endpoint returned an unprocessable response body', 'audio-bad-response')
    }
    const encoded = findBase64Audio(parsed)
    if (encoded !== undefined && encoded.length > 0) {
      let data: Uint8Array
      try {
        const isHex = /^[0-9a-fA-F]+$/.test(encoded) && encoded.length % 2 === 0
        data = new Uint8Array(Buffer.from(encoded, isHex ? 'hex' : 'base64'))
      } catch {
        throw new AudioGenError('audio endpoint returned invalid audio encoding', 'audio-bad-response')
      }
      return [{ data, mime: detectAudioMime(data) ?? contentType ?? 'audio/mpeg' }]
    }
    const url = findAudioUrl(parsed)
    if (url !== undefined) {
      const fetched = await fetchWithTimeout(url, {
        headers: options.apiKey === '' ? {} : { authorization: `Bearer ${options.apiKey}` },
        redirect: 'follow',
      }, AUDIO_FETCH_TIMEOUT_MS)
      if (!fetched.ok) throw new AudioGenError(`failed to fetch generated audio url: HTTP ${fetched.status}`, 'audio-url-fetch-failed')
      const data = new Uint8Array(await fetched.arrayBuffer())
      return [{ data, mime: audioMime(data, fetched.headers.get('content-type')) }]
    }
    throw new AudioGenError('audio endpoint returned neither binary nor base64/url audio', 'audio-empty-result')
  }
  return [{ data: buffer, mime: audioMime(buffer, response.headers.get('content-type') ?? contentType ?? null) }]
}

async function openAITTS(channel: AudioChannel, request: GenerateAudioRequest, signal?: AbortSignal): Promise<Array<{ data: Uint8Array; mime: string; voiceId?: string }>> {
  const base = endpointBase(channel.apiUrl)
  const endpoint = /\/audio\/speech(\?|$)/i.test(base) ? base : `${base}/audio/speech`
  const model = (request.upstream ?? request.model) || 'tts-1'
  const voice = request.voice ?? 'alloy'
  const body: Record<string, unknown> = {
    model,
    input: request.prompt,
    voice,
    response_format: request.format ?? 'mp3',
    ...(request.speed !== undefined ? { speed: request.speed } : {}),
  }
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    redirect: 'error',
    headers: {
      authorization: `Bearer ${channel.apiKey.trim()}`,
      'content-type': 'application/json',
      accept: 'audio/mpeg, application/json',
    },
    body: JSON.stringify(body),
    signal,
  }, UPSTREAM_TIMEOUT_MS)
  return normalizeAudioResponse(response, { apiKey: channel.apiKey, fallbackMime: 'audio/mpeg' })
}

async function elevenLabsOfficial(channel: AudioChannel, request: GenerateAudioRequest, signal?: AbortSignal): Promise<Array<{ data: Uint8Array; mime: string; voiceId?: string }>> {
  const base = endpointBase(channel.apiUrl)
  const model = (request.upstream ?? request.model) || 'eleven_multilingual_v2'
  // 官方使用 xi-api-key；额外携带 Authorization Bearer 以兼容 New API 类网关。
  const headers = {
    'xi-api-key': channel.apiKey.trim(),
    authorization: `Bearer ${channel.apiKey.trim()}`,
    'content-type': 'application/json',
    accept: 'audio/mpeg, application/json',
  }

  // ------------- ElevenLabs Voice Design（POST /v1/text-to-voice/design） -------------
  // voice_description 必填；text 100-1000 字符，过短时用 auto_generate_text；
  // 返回 previews[].audio_base_64 与 previews[].generated_voice_id。
  if (request.mode === 'voice_design') {
    const endpoint = `${base}/text-to-voice/design`
    const previewText = request.previewText?.trim() ?? ''
    const body: Record<string, unknown> = {
      voice_description: request.prompt,
      ...(previewText.length >= 100 ? { text: previewText } : { auto_generate_text: true }),
    }
    const response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers,
      body: JSON.stringify(body),
      signal,
    }, UPSTREAM_TIMEOUT_MS)
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new AudioGenError(`ElevenLabs voice design API error (HTTP ${response.status})${detail === '' ? '' : `: ${detail.slice(0, 300)}`}`, 'audio-api-error')
    }
    const payload = await response.json() as {
      previews?: Array<{ audio_base_64?: string; generated_voice_id?: string; media_type?: string }>
    }
    const previews = payload.previews ?? []
    if (previews.length === 0) throw new AudioGenError('ElevenLabs voice design returned no previews', 'audio-empty-result')
    const outputs: Array<{ data: Uint8Array; mime: string; voiceId?: string }> = []
    for (const preview of previews) {
      const encoded = preview.audio_base_64?.trim() ?? ''
      if (encoded === '') continue
      const data = new Uint8Array(Buffer.from(encoded, 'base64'))
      outputs.push({
        data,
        mime: preview.media_type ?? 'audio/mpeg',
        ...(preview.generated_voice_id === undefined || preview.generated_voice_id === '' ? {} : { voiceId: preview.generated_voice_id }),
      })
    }
    if (outputs.length === 0) throw new AudioGenError('ElevenLabs voice design returned no audio', 'audio-empty-result')
    return outputs
  }

  // ------------- ElevenLabs Music（POST /v1/music） -------------
  // 模型：music_v1 / music_v2；prompt 与 composition_plan 二选一（引擎用 prompt）。
  // 未提供歌词时按纯音乐处理（force_instrumental=true），不再要求必须有歌词。
  if (request.mode === 'music') {
    const endpoint = `${base}/music`
    const musicModel = (request.upstream ?? request.model) || 'music_v1'
    const lyrics = request.lyrics?.trim() ?? ''
    const instrumental = request.isInstrumental === true || lyrics === ''
    const body: Record<string, unknown> = {
      model_id: musicModel,
      prompt: request.prompt,
      ...(request.duration !== undefined && Number.isFinite(request.duration)
        ? { music_length_ms: Math.round(Math.min(600_000, Math.max(3_000, request.duration * 1000))) }
        : {}),
      ...(lyrics === '' ? {} : { lyrics_text: lyrics }),
      ...(instrumental ? { force_instrumental: true } : {}),
    }
    const response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      redirect: 'follow',
      headers,
      body: JSON.stringify(body),
      signal,
    }, UPSTREAM_TIMEOUT_MS)
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new AudioGenError(`ElevenLabs music API error (HTTP ${response.status})${detail === '' ? '' : `: ${detail.slice(0, 300)}`}`, 'audio-api-error')
    }
    return normalizeAudioResponse(response, { apiKey: channel.apiKey, fallbackMime: 'audio/mpeg' })
  }

  // ------------- ElevenLabs Sound Effects（POST /v1/sound-generation） -------------
  // 官方模型：eleven_text_to_sound_v2；text 必填；duration_seconds 0.5-30；
  // loop 仅该模型可用；prompt_influence 0-1（默认 0.3）。
  if (request.mode === 'sfx') {
    const endpoint = `${base}/sound-generation`
    const sfxModel = (request.upstream ?? request.model) || 'eleven_text_to_sound_v2'
    const body: Record<string, unknown> = {
      text: request.prompt,
      model_id: sfxModel,
      ...(request.duration !== undefined && Number.isFinite(request.duration)
        ? { duration_seconds: Math.min(30, Math.max(0.5, request.duration)) }
        : {}),
      ...(request.loop !== undefined ? { loop: request.loop } : {}),
      ...(request.promptInfluence !== undefined && Number.isFinite(request.promptInfluence)
        ? { prompt_influence: Math.min(1, Math.max(0, request.promptInfluence)) }
        : {}),
    }
    const response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      redirect: 'follow',
      headers,
      body: JSON.stringify(body),
      signal,
    }, UPSTREAM_TIMEOUT_MS)
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new AudioGenError(`ElevenLabs sound effects API error (HTTP ${response.status})${detail === '' ? '' : `: ${detail.slice(0, 300)}`}`, 'audio-api-error')
    }
    return normalizeAudioResponse(response, { apiKey: channel.apiKey, fallbackMime: 'audio/mpeg' })
  }

  const voiceId = (request.voice ?? request.model ?? model).trim()
  const endpoint = `${base}/text-to-speech/${encodeURIComponent(voiceId)}`
  const body: Record<string, unknown> = {
    text: request.prompt,
    model_id: model,
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.0,
      use_speaker_boost: true,
      ...(request.speed !== undefined ? { speed: request.speed } : {}),
    },
  }
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    redirect: 'error',
    headers,
    body: JSON.stringify(body),
    signal,
  }, UPSTREAM_TIMEOUT_MS)
  return normalizeAudioResponse(response, { apiKey: channel.apiKey, fallbackMime: 'audio/mpeg' })
}

/**
 * 官方 ElevenLabs 请求被网关拒绝的信号:官方路径未映射(404 Invalid URL)或
 * 网关要求 Bearer 认证而非 xi-api-key(401/403 Invalid token / Invalid API key)。
 * New API 类中转(如 ai.farmmx.com)对 ElevenLabs 官方协议通常返回这类错误。
 */
function isGatewayRouteMiss(error: unknown): boolean {
  return error instanceof AudioGenError
    && error.code === 'audio-api-error'
    && /\bHTTP (404|401|403)\b/.test(error.message)
    && /\bInvalid URL\b|\bInvalid token\b|\bInvalid API key\b/i.test(error.message)
}

/** 网关兼容形态的请求头:仅 Bearer(携带 xi-api-key 会被网关按官方协议校验而 401)。 */
function gatewayHeaders(apiKey: string): Record<string, string> {
  return {
    authorization: `Bearer ${apiKey.trim()}`,
    'content-type': 'application/json',
    accept: 'audio/mpeg, application/json',
  }
}

/** /audio/speech 兼容端点:base 已以此结尾时直接复用,否则拼接。 */
function speechGatewayEndpoint(base: string): string {
  return /\/audio\/speech(\?|$)/i.test(base) ? base : `${base}/audio/speech`
}

/**
 * ElevenLabs 渠道的网关兼容形态(OpenAI 风格):路径用 /audio/speech(音效/TTS)
 * 或 /music(音乐),认证用 Bearer、模型用 `model` 字段。
 *
 * 适配未映射 ElevenLabs 官方端点(404 Invalid URL)或要求 Bearer 认证
 * (401 Invalid token)的 New API 类中转,如 ai.farmmx.com。
 */
async function elevenLabsGatewayCompat(
  channel: AudioChannel,
  request: GenerateAudioRequest,
  signal?: AbortSignal,
): Promise<Array<{ data: Uint8Array; mime: string; voiceId?: string }>> {
  const base = endpointBase(channel.apiUrl)
  const headers = gatewayHeaders(channel.apiKey)

  // music → POST /music(Bearer + model;官方形态在此类网关上是 401 Invalid token)。
  if (request.mode === 'music') {
    const endpoint = /\/music(\?|$)/i.test(base) ? base : `${base}/music`
    const musicModel = (request.upstream ?? request.model) || 'music_v1'
    const lyrics = request.lyrics?.trim() ?? ''
    const instrumental = request.isInstrumental === true || lyrics === ''
    const body: Record<string, unknown> = {
      model: musicModel,
      prompt: request.prompt,
      ...(request.duration !== undefined && Number.isFinite(request.duration)
        ? { music_length_ms: Math.round(Math.min(600_000, Math.max(3_000, request.duration * 1000))) }
        : {}),
      ...(lyrics === '' ? {} : { lyrics_text: lyrics }),
      ...(instrumental ? { force_instrumental: true } : {}),
    }
    const response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      redirect: 'follow',
      headers,
      body: JSON.stringify(body),
      signal,
    }, UPSTREAM_TIMEOUT_MS)
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new AudioGenError(`ElevenLabs music gateway-compatible API error (HTTP ${response.status})${detail === '' ? '' : `: ${detail.slice(0, 300)}`}`, 'audio-api-error')
    }
    return normalizeAudioResponse(response, { apiKey: channel.apiKey, fallbackMime: 'audio/mpeg' })
  }

  // 音色设计在网关兼容层没有对应端点,直接给出可操作的错误说明。
  if (request.mode === 'voice_design') {
    throw new AudioGenError(
      '当前网关不支持 ElevenLabs 音色设计端点(POST /v1/text-to-voice/design);该模式请改用 MiniMax 渠道或 ElevenLabs 官方 API。',
      'voice-design-unsupported',
    )
  }

  // sfx / tts → POST /audio/speech(OpenAI 兼容形态;网关把 model=eleven_text_to_sound_v2 映射到音效生成)。
  const endpoint = speechGatewayEndpoint(base)
  const isSfx = request.mode === 'sfx'
  const model = (request.upstream ?? request.model)
    || (isSfx ? 'eleven_text_to_sound_v2' : 'eleven_multilingual_v2')
  const body: Record<string, unknown> = isSfx
    ? {
        model,
        text: request.prompt,
        ...(request.duration !== undefined && Number.isFinite(request.duration)
          ? { duration_seconds: Math.min(30, Math.max(0.5, request.duration)) }
          : {}),
        ...(request.loop !== undefined ? { loop: request.loop } : {}),
        ...(request.promptInfluence !== undefined && Number.isFinite(request.promptInfluence)
          ? { prompt_influence: Math.min(1, Math.max(0, request.promptInfluence)) }
          : {}),
      }
    : {
        model,
        input: request.prompt,
        ...(request.voice !== undefined && request.voice.trim() !== '' ? { voice: request.voice.trim() } : {}),
        response_format: request.format ?? 'mp3',
        ...(request.speed !== undefined ? { speed: request.speed } : {}),
      }
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    redirect: 'follow',
    headers,
    body: JSON.stringify(body),
    signal,
  }, UPSTREAM_TIMEOUT_MS)
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new AudioGenError(
      `ElevenLabs ${isSfx ? 'sound effects' : 'TTS'} gateway-compatible API error (HTTP ${response.status})${detail === '' ? '' : `: ${detail.slice(0, 300)}`}`,
      'audio-api-error',
    )
  }
  return normalizeAudioResponse(response, { apiKey: channel.apiKey, fallbackMime: 'audio/mpeg' })
}

/**
 * ElevenLabs 渠道入口:官方端点优先;官方协议被网关(New API 类中转)拒绝时,
 * 自动改用 OpenAI 兼容形态重试,使同一渠道同时兼容 ElevenLabs 官方 API 与
 * ai.farmmx.com 类中转。官方地址(api.elevenlabs.io)直连不触发回退。
 */
async function elevenLabs(
  channel: AudioChannel,
  request: GenerateAudioRequest,
  signal?: AbortSignal,
): Promise<Array<{ data: Uint8Array; mime: string; voiceId?: string }>> {
  if (/elevenlabs\.io/i.test(channel.apiUrl)) {
    return elevenLabsOfficial(channel, request, signal)
  }
  try {
    return await elevenLabsOfficial(channel, request, signal)
  } catch (error) {
    if (!isGatewayRouteMiss(error)) throw error
  }
  return elevenLabsGatewayCompat(channel, request, signal)
}

function minimaxApiBase(base: string): string {
  const trimmed = endpointBase(base)
  return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`
}

/**
 * Resolve the MiniMax voice_id for a TTS request.
 * Priority: explicit voice param → upstream id (if it is not a model name) →
 * model alias (if it is not a model name). MiniMax speech/music model ids
 * (speech-2.8-hd, music-3.0, …) are never treated as voice ids.
 */
function resolveMiniMaxVoice(request: GenerateAudioRequest): string | undefined {
  const explicit = request.voice?.trim()
  if (explicit !== undefined && explicit !== '') return explicit
  for (const candidate of [request.upstream, request.model]) {
    const value = typeof candidate === 'string' ? candidate.trim() : ''
    if (value === '') continue
    if (/^(speech|music|t2a|tts)[-_]/i.test(value)) continue
    return value
  }
  return undefined
}

/**
 * Build the full MiniMax t2a_v2 body. Every official field is carried
 * through — voice_setting (voice_id/speed/vol/pitch/emotion/text_normalization/
 * latex_read), pronunciation_dict.tone, audio_setting (format/sample_rate/
 * bitrate/channel/force_cbr), subtitle_enable, aigc_watermark, language_boost,
 * voice_modify and timbre_weights — so callers and skills can reference them.
 */
function buildMiniMaxTTSBody(request: GenerateAudioRequest, model: string, voiceId: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    text: request.prompt,
    stream: false,
    voice_setting: {
      voice_id: voiceId,
      speed: request.speed ?? 1,
      vol: request.vol ?? 1,
      pitch: request.pitch ?? 0,
      ...(request.emotion !== undefined && request.emotion.trim() !== '' ? { emotion: request.emotion.trim() } : {}),
      ...(request.textNormalization !== undefined ? { text_normalization: request.textNormalization } : {}),
      ...(request.latexRead !== undefined ? { latex_read: request.latexRead } : {}),
    },
    audio_setting: {
      format: request.format ?? 'mp3',
      sample_rate: request.sampleRate ?? 32000,
      bitrate: request.bitrate ?? 128000,
      channel: request.audioChannel ?? 1,
      ...(request.forceCbr !== undefined ? { force_cbr: request.forceCbr } : {}),
    },
  }
  if (request.pronunciationTone !== undefined && request.pronunciationTone.length > 0) {
    body.pronunciation_dict = { tone: request.pronunciationTone }
  }
  if (request.subtitleEnable !== undefined) body.subtitle_enable = request.subtitleEnable
  if (request.aigcWatermark !== undefined) body.aigc_watermark = request.aigcWatermark
  if (request.languageBoost !== undefined && request.languageBoost.trim() !== '') {
    body.language_boost = request.languageBoost.trim()
  }
  if (request.voiceModify !== undefined) {
    const modify: Record<string, unknown> = {}
    if (request.voiceModify.pitch !== undefined) modify.pitch = request.voiceModify.pitch
    if (request.voiceModify.intensity !== undefined) modify.intensity = request.voiceModify.intensity
    if (request.voiceModify.timbre !== undefined) modify.timbre = request.voiceModify.timbre
    if (request.voiceModify.soundEffects !== undefined && request.voiceModify.soundEffects.trim() !== '') {
      modify.sound_effects = request.voiceModify.soundEffects.trim()
    }
    if (Object.keys(modify).length > 0) body.voice_modify = modify
  }
  if (request.timbreWeights !== undefined && request.timbreWeights.length > 0) {
    body.timbre_weights = request.timbreWeights
      .filter(item => typeof item?.voiceId === 'string' && item.voiceId.trim() !== '' && typeof item.weight === 'number')
      .map(item => ({ voice_id: item.voiceId.trim(), weight: item.weight }))
  }
  return body
}

/** The MiniMax-specific fields only (model/text/stream excluded) — used as the
 *  new-api `metadata` payload when a gateway serves MiniMax TTS at /v1/audio/speech.
 *  The merge keeps the gateway-sent model/input, and voice_setting.voice_id is
 *  carried explicitly so relays that overwrite it still get the right voice. */
function buildMiniMaxTTSUpload(request: GenerateAudioRequest, voiceId: string): Record<string, unknown> {
  const upload = buildMiniMaxTTSBody(request, '', voiceId)
  delete upload.model
  delete upload.text
  delete upload.stream
  return upload
}

/**
 * OpenAI-compatible MiniMax TTS path for New API style gateways that do not
 * route the native /v1/t2a_v2. The full native field set is carried inside
 * `metadata`, which new-api's MiniMax TTS relay merges into t2a_v2 upstream.
 */
async function minimaxTTSGateway(channel: AudioChannel, request: GenerateAudioRequest, signal: AbortSignal | undefined, voiceId: string): Promise<Array<{ data: Uint8Array; mime: string; voiceId?: string }>> {
  const base = minimaxApiBase(channel.apiUrl)
  const endpoint = `${base}/audio/speech`
  const model = (request.upstream ?? request.model) || 'speech-2.8-hd'
  const metadata = buildMiniMaxTTSUpload(request, voiceId)
  const body: Record<string, unknown> = {
    model,
    input: request.prompt,
    voice: voiceId,
    response_format: request.format ?? 'mp3',
    ...(request.speed !== undefined ? { speed: request.speed } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  }
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    // Gateways may answer with a redirect to the real audio URL — follow it.
    redirect: 'follow',
    headers: {
      authorization: `Bearer ${channel.apiKey.trim()}`,
      'content-type': 'application/json',
      accept: 'application/json, audio/mpeg',
    },
    body: JSON.stringify(body),
    signal,
  }, UPSTREAM_TIMEOUT_MS)
  return normalizeAudioResponse(response, { apiKey: channel.apiKey, fallbackMime: 'audio/mpeg' })
}

async function minimax(channel: AudioChannel, request: GenerateAudioRequest, signal?: AbortSignal): Promise<Array<{ data: Uint8Array; mime: string; voiceId?: string }>> {
  const base = minimaxApiBase(channel.apiUrl)
  const model = (request.upstream ?? request.model) || (request.mode === 'music' ? 'music-3.0' : 'speech-2.8-hd')

  if (request.mode === 'voice_design') {
    const endpoint = `${base}/voice_design`
    const body: Record<string, unknown> = {
      prompt: request.prompt,
      preview_text: request.previewText ?? request.voice ?? '你好，这是新设计的音色试听。',
    }
    const response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${channel.apiKey.trim()}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    }, UPSTREAM_TIMEOUT_MS)
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new AudioGenError(`MiniMax voice design API error (HTTP ${response.status})${detail === '' ? '' : `: ${detail.slice(0, 300)}`}`, 'audio-api-error')
    }
    const payload = await response.json() as {
      voice_id?: string
      trial_audio?: string
      base_resp?: { status_code?: number; status_msg?: string }
    }
    if (payload.base_resp?.status_code !== undefined && payload.base_resp.status_code !== 0) {
      throw new AudioGenError(payload.base_resp.status_msg ?? `MiniMax returned status ${payload.base_resp.status_code}`, 'audio-api-error')
    }
    const encoded = payload.trial_audio ?? ''
    if (encoded === '') throw new AudioGenError('MiniMax voice design returned no trial audio', 'audio-empty-result')
    const isHex = /^[0-9a-fA-F]+$/.test(encoded) && encoded.length % 2 === 0
    const data = new Uint8Array(Buffer.from(encoded, isHex ? 'hex' : 'base64'))
    return [{
      data,
      mime: 'audio/mpeg',
      ...(payload.voice_id === undefined ? {} : { voiceId: payload.voice_id }),
    }]
  }

  if (request.mode === 'music') {
    // MiniMax 音乐生成官方字段：model/lyrics/prompt/is_instrumental/duration/
    // audio_setting{format, sample_rate, bitrate}。音频输出配置为固定枚举：
    // format mp3|wav|pcm；sample_rate 16000|24000|32000|44100；
    // bitrate 32000|64000|128000|256000，超出枚举的值回退默认。
    // 歌词为空时一律按纯音乐生成（is_instrumental=true）：面板/Agent 无论是否
    // 显式勾选「纯音乐」都能出结果，不再因缺歌词报错。
    const MUSIC_FORMATS = new Set(['mp3', 'wav', 'pcm'])
    const MUSIC_SAMPLE_RATES = new Set([16000, 24000, 32000, 44100])
    const MUSIC_BITRATES = new Set([32000, 64000, 128000, 256000])
    const lyrics = request.lyrics?.trim() ?? ''
    const instrumental = request.isInstrumental === true || lyrics === ''
    const endpoint = `${base}/music_generation`
    const body: Record<string, unknown> = {
      model,
      prompt: request.prompt,
      ...(lyrics === '' ? {} : { lyrics }),
      ...(instrumental ? { is_instrumental: true } : {}),
      ...(request.duration !== undefined ? { duration: request.duration } : {}),
      audio_setting: {
        format: MUSIC_FORMATS.has(request.format ?? 'mp3') ? (request.format ?? 'mp3') : 'mp3',
        sample_rate: MUSIC_SAMPLE_RATES.has(request.sampleRate ?? 44100) ? (request.sampleRate ?? 44100) : 44100,
        bitrate: MUSIC_BITRATES.has(request.bitrate ?? 256000) ? (request.bitrate ?? 256000) : 256000,
      },
    }
    const response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${channel.apiKey.trim()}`,
        'content-type': 'application/json',
        accept: 'application/json, audio/mpeg',
      },
      body: JSON.stringify(body),
      signal,
    }, UPSTREAM_TIMEOUT_MS)
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new AudioGenError(`MiniMax music API error (HTTP ${response.status})${detail === '' ? '' : `: ${detail.slice(0, 300)}`}`, 'audio-api-error')
    }
    return normalizeAudioResponse(response, { apiKey: channel.apiKey, fallbackMime: 'audio/mpeg' })
  }

  // ------------------------------------------------------------- TTS
  const voiceId = resolveMiniMaxVoice(request)
  if (voiceId === undefined) {
    throw new AudioGenError(
      'MiniMax TTS 需要指定音色 voice_id（如 male-qn-qingse、female-shaonv）：请在「音色」字段填写，或把音色加入渠道模型目录（alias 可任意、upstream 填 voice_id），也可点「获取可用模型」拉取账号音色列表。',
      'voice-required',
    )
  }
  const endpoint = `${base}/t2a_v2`
  const body = buildMiniMaxTTSBody(request, model, voiceId)
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    redirect: 'error',
    headers: {
      authorization: `Bearer ${channel.apiKey.trim()}`,
      'content-type': 'application/json',
      accept: 'application/json, audio/mpeg',
    },
    body: JSON.stringify(body),
    signal,
  }, UPSTREAM_TIMEOUT_MS)
  if (response.ok) {
    return normalizeAudioResponse(response, { apiKey: channel.apiKey, fallbackMime: 'audio/mpeg' })
  }
  const detail = await response.text().catch(() => '')
  const routeMiss = response.status === 404 && /invalid url|invalid_request_error/i.test(detail)
  if (!routeMiss) {
    throw new AudioGenError(`MiniMax TTS API error (HTTP ${response.status})${detail === '' ? '' : `: ${detail.slice(0, 300)}`}`, 'audio-api-error')
  }
  // Gateway does not route the native MiniMax path — retry over its
  // OpenAI-compatible /v1/audio/speech (new-api MiniMax relays merge
  // `metadata` back into a full t2a_v2 request).
  try {
    return await minimaxTTSGateway(channel, request, signal, voiceId)
  } catch (gatewayError) {
    const detailText = gatewayError instanceof AudioGenError ? gatewayError.message : String(gatewayError)
    throw new AudioGenError(
      `MiniMax 渠道「${channel.name}」网关未提供原生 TTS 接口：POST ${endpoint} 返回 HTTP 404（Invalid URL，网关未路由 /v1/t2a_v2）；已回退 OpenAI 兼容 ${minimaxApiBase(channel.apiUrl)}/audio/speech 仍失败：${detailText.slice(0, 300)}。`
      + '请把渠道 API 地址配置为官方 https://api.minimaxi.com（配合 MiniMax 官方密钥），或确认网关已将 /v1/audio/speech 映射到 MiniMax 音色渠道。',
      'audio-api-error',
    )
  }
}

/** Stability 内部信号：路由缺失（网关 404 Invalid URL），可切换另一协议重试。 */
class StabilityRouteMissError extends Error {}

/** 网关风格：apiUrl 形如 .../v1、.../v1/audio/speech 时优先 OpenAI 兼容 speech。 */
function stabilityGatewayStyle(channel: AudioChannel): boolean {
  const url = channel.apiUrl.trim().toLowerCase()
  return /\/v1(\/|$|\?)/.test(url) || /\/audio\/speech(\?|$)/.test(url)
}

function isStabilityRouteMiss(status: number, detail: string): boolean {
  return status === 404 && /invalid url|invalid_request_error/i.test(detail)
}

/**
 * Stable Audio 官方 v2beta（multipart/form-data）。
 * - stable-audio-3        → POST {base}/stable-audio/text-to-audio    （202 异步 → GET /v2beta/audio/results/{id} 轮询）
 * - stable-audio-2 / 2.5  → POST {base}/stable-audio-2/text-to-audio  （200 同步返回音频/JSON base64）
 * - 不同模型参数不同：stable-audio-3 steps 4-8、duration ≤380；2 steps 30-100、cfg_scale 默认 7；
 *   2.5 steps 4-8、cfg_scale 默认 1；均支持 seed、output_format(hp3|wav)。
 */
async function stabilityNativeAudio(channel: AudioChannel, request: GenerateAudioRequest, signal?: AbortSignal): Promise<Array<{ data: Uint8Array; mime: string; voiceId?: string }>> {
  const rawBase = endpointBase(channel.apiUrl)
  const model = (request.upstream ?? request.model) || 'stable-audio-2.5'
  const isV3 = /^stable-audio-3/i.test(model)
  const isV2 = /^stable-audio-2(\.[05])?$/i.test(model) || /^stable-audio-2-/i.test(model)
  const group = isV2 ? 'stable-audio-2' : 'stable-audio'

  // 规范化 base：允许 apiUrl 为 `https://api.stability.ai` / `.../v2beta` / `.../v2beta/audio`
  const base = /\/v2beta\/audio$/i.test(rawBase)
    ? rawBase
    : /\/v2beta$/i.test(rawBase)
      ? `${rawBase}/audio`
      : `${rawBase}/v2beta/audio`
  const endpoint = `${base}/${group}/text-to-audio`

  const form = new FormData()
  form.set('prompt', request.prompt)
  form.set('model', model)
  if (request.duration !== undefined && Number.isFinite(request.duration)) {
    const maxDuration = isV3 ? 380 : 190
    form.set('duration', String(Math.min(maxDuration, Math.max(1, request.duration))))
  }
  if (request.seed !== undefined && Number.isFinite(request.seed)) {
    form.set('seed', String(Math.floor(Math.min(4294967294, Math.max(0, request.seed)))))
  }
  const format = request.format === 'wav' ? 'wav' : 'mp3'
  form.set('output_format', format)
  if (request.steps !== undefined && Number.isInteger(request.steps)) {
    const minSteps = isV2 && !/2\.5/i.test(model) ? 30 : 4
    const maxSteps = isV2 && !/2\.5/i.test(model) ? 100 : 8
    form.set('steps', String(Math.min(maxSteps, Math.max(minSteps, request.steps))))
  }
  if (request.cfgScale !== undefined && Number.isFinite(request.cfgScale)) {
    form.set('cfg_scale', String(Math.min(25, Math.max(1, request.cfgScale))))
  }

  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    redirect: 'error',
    headers: {
      authorization: `Bearer ${channel.apiKey.trim()}`,
      accept: 'application/json',
    },
    body: form,
    signal,
  }, isV3 ? 60_000 : UPSTREAM_TIMEOUT_MS)

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    if (isStabilityRouteMiss(response.status, detail)) throw new StabilityRouteMissError()
    throw new AudioGenError(`Stable Audio API error (HTTP ${response.status})${detail === '' ? '' : `: ${detail.slice(0, 300)}`}`, 'audio-api-error')
  }

  // stable-audio-3 异步：202 → 轮询结果
  if (response.status === 202) {
    const payload = await response.json().catch(() => ({})) as { id?: string }
    if (payload.id === undefined || payload.id === '') {
      throw new AudioGenError('Stable Audio accepted the job but returned no result id', 'audio-empty-result')
    }
    const apiOrigin = base.replace(/\/v2beta\/audio$/i, '')
    const resultUrl = `${apiOrigin}/v2beta/audio/results/${encodeURIComponent(payload.id)}`
    const deadline = Date.now() + UPSTREAM_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (signal?.aborted === true) throw new AudioGenError('Stable Audio generation was aborted', 'audio-aborted')
      const polled = await fetchWithTimeout(resultUrl, {
        method: 'GET',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${channel.apiKey.trim()}`,
          accept: 'application/json',
        },
        signal,
      }, 60_000)
      if (polled.ok) {
        return normalizeAudioResponse(polled, { apiKey: channel.apiKey, fallbackMime: 'audio/mpeg' })
      }
      if (polled.status === 404 || polled.status === 202) {
        await new Promise(resolve => setTimeout(resolve, 5000))
        continue
      }
      const detail = await polled.text().catch(() => '')
      throw new AudioGenError(`Stable Audio result API error (HTTP ${polled.status})${detail === '' ? '' : `: ${detail.slice(0, 300)}`}`, 'audio-api-error')
    }
    throw new AudioGenError('Stable Audio generation timed out waiting for the result', 'audio-timeout')
  }

  return normalizeAudioResponse(response, { apiKey: channel.apiKey, fallbackMime: 'audio/mpeg' })
}

/**
 * Stable Audio 经 OpenAI 兼容网关（如 New API 的 /v1/audio/speech）：
 * 模型名映射到 Stable 上游，JSON 体为 {model, input, output_format, duration,
 * seed, steps, cfg_scale} —— 与官方 v2beta 字段一一对应，网关负责转发。
 */
async function stabilityGatewayAudio(channel: AudioChannel, request: GenerateAudioRequest, signal?: AbortSignal): Promise<Array<{ data: Uint8Array; mime: string; voiceId?: string }>> {
  const rawBase = endpointBase(channel.apiUrl)
  const model = (request.upstream ?? request.model) || 'stable-audio-2.5'
  const isV3 = /^stable-audio-3/i.test(model)
  const isV2 = /^stable-audio-2(\.[05])?$/i.test(model) || /^stable-audio-2-/i.test(model)
  const endpoint = /\/audio\/speech(\?|$)/i.test(rawBase) ? rawBase : `${rawBase}/audio/speech`
  const format = request.format === 'wav' ? 'wav' : 'mp3'
  const body: Record<string, unknown> = {
    model,
    input: request.prompt,
    output_format: format,
    ...(request.duration !== undefined && Number.isFinite(request.duration)
      ? { duration: Math.min(isV3 ? 380 : 190, Math.max(1, request.duration)) }
      : {}),
    ...(request.seed !== undefined && Number.isFinite(request.seed)
      ? { seed: Math.floor(Math.min(4294967294, Math.max(0, request.seed))) }
      : {}),
    ...(request.steps !== undefined && Number.isInteger(request.steps)
      ? { steps: Math.min(isV2 && !/2\.5/i.test(model) ? 100 : 8, Math.max(isV2 && !/2\.5/i.test(model) ? 30 : 4, request.steps)) }
      : {}),
    ...(request.cfgScale !== undefined && Number.isFinite(request.cfgScale)
      ? { cfg_scale: Math.min(25, Math.max(1, request.cfgScale)) }
      : {}),
  }
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    redirect: 'follow',
    headers: {
      authorization: `Bearer ${channel.apiKey.trim()}`,
      accept: 'audio/*',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  }, UPSTREAM_TIMEOUT_MS)
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    if (isStabilityRouteMiss(response.status, detail)) throw new StabilityRouteMissError()
    throw new AudioGenError(`Stable Audio gateway API error (HTTP ${response.status})${detail === '' ? '' : `: ${detail.slice(0, 300)}`}`, 'audio-api-error')
  }
  return normalizeAudioResponse(response, { apiKey: channel.apiKey, fallbackMime: 'audio/mpeg' })
}

/**
 * 稳定性入口：优先官方 v2beta（api.stability.ai / v2beta 形态），
 * 网关形态（apiUrl 以 /v1 结尾或已含 /audio/speech）优先 OpenAI 兼容；
 * 一方返回 404 Invalid URL（未路由）时自动换另一方重试。
 */
async function stabilityAudio(channel: AudioChannel, request: GenerateAudioRequest, signal?: AbortSignal): Promise<Array<{ data: Uint8Array; mime: string; voiceId?: string }>> {
  const styles: Array<'native' | 'gateway'> = stabilityGatewayStyle(channel) ? ['gateway', 'native'] : ['native', 'gateway']
  let lastError: Error | undefined
  for (const style of styles) {
    try {
      if (style === 'gateway') return await stabilityGatewayAudio(channel, request, signal)
      return await stabilityNativeAudio(channel, request, signal)
    } catch (error) {
      if (!(error instanceof StabilityRouteMissError)) throw error
      lastError = error
    }
  }
  throw lastError ?? new AudioGenError('Stable Audio 渠道未配置或不可达', 'audio-api-error')
}

async function genericAudio(channel: AudioChannel, request: GenerateAudioRequest, signal?: AbortSignal): Promise<Array<{ data: Uint8Array; mime: string; voiceId?: string }>> {
  const base = endpointBase(channel.apiUrl)
  if (request.mode === 'tts' && !/\/generate(\?|$)/i.test(base)) {
    return openAITTS(channel, request, signal)
  }
  const endpoint = /\/generate(\?|$)/i.test(base) ? base : `${base}/generate`
  const model = (request.upstream ?? request.model) || 'default'
  const body: Record<string, unknown> = {
    model,
    prompt: request.prompt,
    mode: request.mode,
    ...(request.voice !== undefined ? { voice: request.voice } : {}),
    ...(request.duration !== undefined ? { duration: request.duration } : {}),
    ...(request.format !== undefined ? { output_format: request.format } : {}),
  }
  const response = await fetchWithTimeout(endpoint, {
    method: 'POST',
    redirect: 'error',
    headers: {
      authorization: `Bearer ${channel.apiKey.trim()}`,
      'content-type': 'application/json',
      accept: 'application/json, audio/mpeg, audio/wav',
    },
    body: JSON.stringify(body),
    signal,
  }, UPSTREAM_TIMEOUT_MS)
  return normalizeAudioResponse(response, { apiKey: channel.apiKey, fallbackMime: 'audio/mpeg' })
}

/**
 * Generate one or more audio outputs from a configured channel.
 * @returns normalized generated audio (base64, mime, bytes).
 */
export async function generateAudio(
  channel: AudioChannel,
  request: GenerateAudioRequest,
  signal?: AbortSignal,
): Promise<Array<{ data: Uint8Array; mime: string; voiceId?: string }>> {
  if (channel.apiUrl.trim() === '') throw new AudioGenError('channel API URL is not configured', 'audio-no-endpoint')
  if (channel.apiKey.trim() === '') throw new AudioGenError('channel API key is not configured', 'audio-no-key')
  if (request.prompt.trim() === '') throw new AudioGenError('audio prompt/text is required', 'audio-empty-prompt')
  if (request.mode === 'voice_design' && !isMiniMax(channel) && !isElevenLabs(channel)) {
    throw new AudioGenError('音色设计当前仅支持 MiniMax（/v1/voice_design）与 ElevenLabs（/v1/text-to-voice/design）渠道', 'voice-design-unsupported')
  }

  if (isElevenLabs(channel)) return elevenLabs(channel, request, signal)
  if (isMiniMax(channel)) return minimax(channel, request, signal)
  // 稳定性渠道或模型名明确为 stable-audio-*（含自定义渠道）→ 走官方 Stable Audio 协议
  if (isStability(channel) || /^stable-audio-/i.test(((request.upstream ?? request.model) || '').trim())) {
    return stabilityAudio(channel, request, signal)
  }
  if (isOpenAICompatible(channel, request.mode)) return openAITTS(channel, request, signal)
  return genericAudio(channel, request, signal)
}
