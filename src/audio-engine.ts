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
  return value.split(';')[0]!.trim().toLowerCase()
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

async function elevenLabs(channel: AudioChannel, request: GenerateAudioRequest, signal?: AbortSignal): Promise<Array<{ data: Uint8Array; mime: string; voiceId?: string }>> {
  const base = endpointBase(channel.apiUrl)
  const model = (request.upstream ?? request.model) || 'eleven_multilingual_v2'
  // 官方使用 xi-api-key；额外携带 Authorization Bearer 以兼容 New API 类网关。
  const headers = {
    'xi-api-key': channel.apiKey.trim(),
    authorization: `Bearer ${channel.apiKey.trim()}`,
    'content-type': 'application/json',
    accept: 'audio/mpeg, application/json',
  }

  // ------------- ElevenLabs Music（POST /v1/music） -------------
  // 模型：music_v1 / music_v2；prompt 与 composition_plan 二选一（引擎用 prompt）。
  if (request.mode === 'music') {
    const endpoint = `${base}/music`
    const musicModel = (request.upstream ?? request.model) || 'music_v1'
    const body: Record<string, unknown> = {
      model_id: musicModel,
      prompt: request.prompt,
      ...(request.duration !== undefined && Number.isFinite(request.duration)
        ? { music_length_ms: Math.round(Math.min(600_000, Math.max(3_000, request.duration * 1000))) }
        : {}),
      ...(request.lyrics !== undefined && request.lyrics.trim() !== '' ? { lyrics_text: request.lyrics.trim() } : {}),
      ...(request.isInstrumental !== undefined ? { force_instrumental: request.isInstrumental } : {}),
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
    const MUSIC_FORMATS = new Set(['mp3', 'wav', 'pcm'])
    const MUSIC_SAMPLE_RATES = new Set([16000, 24000, 32000, 44100])
    const MUSIC_BITRATES = new Set([32000, 64000, 128000, 256000])
    const lyrics = request.lyrics?.trim() ?? ''
    if (lyrics === '' && request.isInstrumental !== true) {
      throw new AudioGenError(
        'MiniMax 音乐生成需要歌词（lyrics 参数），或在「纯音乐」模式（is_instrumental=true）下生成；也可让面板/Agent 先为提示词创作一段歌词。',
        'lyrics-required',
      )
    }
    const endpoint = `${base}/music_generation`
    const body: Record<string, unknown> = {
      model,
      prompt: request.prompt,
      ...(lyrics === '' ? {} : { lyrics }),
      ...(request.isInstrumental !== undefined ? { is_instrumental: request.isInstrumental } : {}),
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

async function stabilityAudio(channel: AudioChannel, request: GenerateAudioRequest, signal?: AbortSignal): Promise<Array<{ data: Uint8Array; mime: string; voiceId?: string }>> {
  const base = endpointBase(channel.apiUrl)
  const endpoint = /\/generation(\?|$)/i.test(base) ? base : `${base}/generation`
  const model = (request.upstream ?? request.model) || 'stable-audio-2.0'
  const body: Record<string, unknown> = {
    model,
    prompt: request.prompt,
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
  if (request.mode === 'voice_design' && !isMiniMax(channel)) {
    throw new AudioGenError('音色设计当前仅支持 MiniMax 渠道', 'voice-design-unsupported')
  }

  if (isElevenLabs(channel)) return elevenLabs(channel, request, signal)
  if (isMiniMax(channel)) return minimax(channel, request, signal)
  if (isStability(channel)) return stabilityAudio(channel, request, signal)
  if (isOpenAICompatible(channel, request.mode)) return openAITTS(channel, request, signal)
  return genericAudio(channel, request, signal)
}
