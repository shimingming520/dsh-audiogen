/**
 * Host-side vendor voice management.
 *
 * Browse/filter the TTS voices a provider exposes and delete account-owned
 * voices. Agent-facing through the `manage_audio_voices` tool; the settings
 * card uses `discoverAudioModels` for its (broader, model-grouped) detection.
 *
 * Vendor endpoints:
 *  - MiniMax    POST /v1/get_voice  (voice_type=all -> system_voice /
 *               voice_cloning / voice_generation)
 *               POST /v1/delete_voice (voice_type=voice_cloning)
 *  - ElevenLabs GET  /v1/voices (owned) + /v1/shared-voices (community)
 *               DELETE /v1/voices/{voice_id} (owned only)
 */

import type { AudioChannel } from './audio-engine.ts'

/** One normalized vendor voice entry (mirrors the Python module contract). */
export interface VendorVoiceEntry {
  provider: string
  voice_id: string
  name: string
  /** system | custom | owned | shared — determines deletability. */
  source: 'system' | 'custom' | 'owned' | 'shared'
  language?: string
  locale?: string
  accent?: string
  gender?: string
  age?: string
  use_case?: string
  category?: string
  description?: string
  preview_url?: string
  /** Whether deleteVendorVoice would accept this voice (custom/owned only). */
  deletable: boolean
}

export interface ListVoicesOptions {
  /** Free-text filter over name/description/accent/use_case (case-insensitive). */
  keyword?: string
  /** Substring filter over language/locale (e.g. "en", "Chinese"); also sent
   *  as the `language` query of /v1/shared-voices. */
  language?: string
  /** Filter by entry source: system/custom/owned/shared. */
  source?: string
  /** Hard cap on returned entries (default 100, max 200). */
  limit?: number
  /** Official /v1/shared-voices server-side filters (ElevenLabs shared library
   *  only; MiniMax has no equivalent and reports them in `note`). Also applied
   *  locally as a fallback so owned voices / other providers honor them too. */
  serverFilters?: SharedVoiceFilters
}

/** Official GET /v1/shared-voices query parameters (ElevenLabs voice library). */
export interface SharedVoiceFilters {
  search?: string
  use_case?: string
  accent?: string
  gender?: string
  age?: string
  locale?: string
  category?: string
  sort?: 'most_used' | 'random' | 'oldest' | 'newest'
  /** Only true is sent (false = no filter, matches "not filtered"). */
  featured?: boolean
  free_users_allowed?: boolean
  descriptive?: boolean
}

const SHARED_VOICE_SORT_OPTIONS = ['most_used', 'random', 'oldest', 'newest'] as const

export interface ListVoicesResult {
  vendor: string
  voices: VendorVoiceEntry[]
  truncated: boolean
  /** Human note when something was skipped (e.g. shared-voice endpoint failed). */
  note?: string
}

const MINIMAX_LANGUAGE_PREFIXES = [
  'Chinese (Mandarin)', 'Chinese (Cantonese)', 'Japanese', 'English', 'Korean',
  'Spanish', 'French', 'German', 'Italian', 'Russian', 'Portuguese', 'Arabic',
  'Hindi',
] as const

export function isMiniMax(channel: AudioChannel): boolean {
  return channel.preset === 'minimax' || /minimax/i.test(channel.apiUrl)
}

export function isElevenLabs(channel: AudioChannel): boolean {
  return channel.preset === 'elevenlabs' || /elevenlabs/i.test(channel.apiUrl)
}

export function supportsVoiceManagement(channel: AudioChannel): boolean {
  return isMiniMax(channel) || isElevenLabs(channel)
}

function baseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/** MiniMax system voice ids carry a language label prefix. */
export function languageFromMiniMaxId(voiceId: string): string | undefined {
  for (const prefix of MINIMAX_LANGUAGE_PREFIXES) {
    if (voiceId.startsWith(`${prefix}_`)) return prefix
  }
  return undefined
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => String(item)).filter(item => item.trim() !== '')
  if (typeof value === 'string' && value.trim() !== '') return [value.trim()]
  return []
}

// ----------------------------------------------------------------- fetch

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}${text === '' ? '' : `: ${text.slice(0, 300)}`}`)
  }
  return response.json()
}

async function postJson(url: string, apiKey: string, body: unknown): Promise<unknown> {
  return fetchJson(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey.trim()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

// ------------------------------------------------------------- MiniMax

function normalizeMiniMax(voice: Record<string, unknown>, source: 'system' | 'custom'): VendorVoiceEntry {
  const voiceId = String(voice.voice_id ?? '').trim()
  const description = asStringList(voice.description).join('；') || undefined
  const language = languageFromMiniMaxId(voiceId)
  return {
    provider: 'minimax',
    voice_id: voiceId,
    name: String(voice.voice_name ?? voiceId).trim() || voiceId,
    source,
    ...(language === undefined ? {} : { language }),
    ...(description === undefined ? {} : { description }),
    deletable: source === 'custom',
  }
}

async function listMiniMax(channel: AudioChannel): Promise<ListVoicesResult> {
  const base = baseUrl(channel.apiUrl).replace(/\/v1$/i, '')
  const payload = await postJson(`${base}/v1/get_voice`, channel.apiKey, { voice_type: 'all' }) as {
    system_voice?: unknown[]
    voice_cloning?: unknown[]
    voice_generation?: unknown[]
    base_resp?: { status_code?: number; status_msg?: string }
  }
  if (payload.base_resp?.status_code !== undefined && payload.base_resp.status_code !== 0) {
    throw new Error(
      `MiniMax get_voice 失败：${payload.base_resp.status_msg ?? `status ${payload.base_resp.status_code}`}`,
    )
  }
  const entries: VendorVoiceEntry[] = []
  for (const voice of Array.isArray(payload.system_voice) ? payload.system_voice : []) {
    if (typeof voice !== 'object' || voice === null) continue
    const entry = normalizeMiniMax(voice as Record<string, unknown>, 'system')
    if (entry.voice_id !== '') entries.push(entry)
  }
  for (const bucket of ['voice_cloning', 'voice_generation'] as const) {
    for (const voice of Array.isArray(payload[bucket]) ? payload[bucket] : []) {
      if (typeof voice !== 'object' || voice === null) continue
      const entry = normalizeMiniMax(voice as Record<string, unknown>, 'custom')
      if (entry.voice_id !== '') entries.push(entry)
    }
  }
  return { vendor: 'minimax', voices: entries, truncated: false }
}

// ---------------------------------------------------------- ElevenLabs

function normalizeElevenLabs(
  voice: Record<string, unknown>,
  source: 'owned' | 'shared',
): VendorVoiceEntry {
  const voiceId = String(voice.voice_id ?? '').trim()
  const labels = typeof voice.labels === 'object' && voice.labels !== null
    ? (voice.labels as Record<string, unknown>)
    : undefined
  const pick = (key: string): string | undefined => {
    const owned = labels?.[key]
    const direct = voice[key]
    const value = typeof owned === 'string' && owned.trim() !== '' ? owned : typeof direct === 'string' && direct.trim() !== '' ? direct : undefined
    return value?.trim() || undefined
  }
  const description = pick('description')
  const name = String(voice.name ?? voiceId).trim() || voiceId
  return {
    provider: 'elevenlabs',
    voice_id: voiceId,
    name,
    source,
    ...(pick('language') === undefined ? {} : { language: pick('language')! }),
    ...(pick('locale') === undefined ? {} : { locale: pick('locale')! }),
    ...(pick('accent') === undefined ? {} : { accent: pick('accent')! }),
    ...(pick('gender') === undefined ? {} : { gender: pick('gender')! }),
    ...(pick('age') === undefined ? {} : { age: pick('age')! }),
    ...(pick('use_case') === undefined ? {} : { use_case: pick('use_case')! }),
    ...(pick('category') === undefined ? {} : { category: pick('category')! }),
    ...(description === undefined ? {} : { description }),
    ...(typeof voice.preview_url === 'string' && voice.preview_url.trim() !== '' ? { preview_url: voice.preview_url.trim() } : {}),
    deletable: source === 'owned',
  }
}

async function listElevenLabs(channel: AudioChannel, options: ListVoicesOptions): Promise<ListVoicesResult> {
  const base = baseUrl(channel.apiUrl)
  const headers = { 'xi-api-key': channel.apiKey.trim(), accept: 'application/json' }
  const entries: VendorVoiceEntry[] = []
  const failures: string[] = []
  const filters = options.serverFilters ?? {}

  // 1. Account-owned voices (/v1/voices) — deletable.
  try {
    const payload = await fetchJson(`${base}/voices`, { headers }) as { voices?: unknown[] }
    for (const voice of Array.isArray(payload.voices) ? payload.voices : []) {
      if (typeof voice !== 'object' || voice === null) continue
      const entry = normalizeElevenLabs(voice as Record<string, unknown>, 'owned')
      if (entry.voice_id !== '') entries.push(entry)
    }
  } catch (error) {
    failures.push(`自有音色：${error instanceof Error ? error.message : String(error)}`)
  }

  // 2. Community library (/v1/shared-voices, up to 3 pages) — read-only.
  //    Official server-side filters are forwarded for the shared library.
  const pageSize = 100
  try {
    for (let page = 0; page < 3; page += 1) {
      const query = new URLSearchParams({ page_size: String(pageSize), page: String(page) })
      if (options.language !== undefined && options.language.trim() !== '') query.set('language', options.language.trim())
      if (filters.search !== undefined && filters.search.trim() !== '') query.set('search', filters.search.trim())
      if (filters.use_case !== undefined && filters.use_case.trim() !== '') query.set('use_case', filters.use_case.trim())
      if (filters.accent !== undefined && filters.accent.trim() !== '') query.set('accent', filters.accent.trim())
      if (filters.gender !== undefined && filters.gender.trim() !== '') query.set('gender', filters.gender.trim())
      if (filters.age !== undefined && filters.age.trim() !== '') query.set('age', filters.age.trim())
      if (filters.locale !== undefined && filters.locale.trim() !== '') query.set('locale', filters.locale.trim())
      if (filters.category !== undefined && filters.category.trim() !== '') query.set('category', filters.category.trim())
      if (filters.sort !== undefined && (SHARED_VOICE_SORT_OPTIONS as readonly string[]).includes(filters.sort)) query.set('sort', filters.sort)
      if (filters.featured === true) query.set('featured', 'true')
      if (filters.free_users_allowed === true) query.set('free_users_allowed', 'true')
      if (filters.descriptive === true) query.set('descriptive', 'true')
      const payload = await fetchJson(`${base}/shared-voices?${query.toString()}`, { headers }) as {
        voices?: unknown[]
        has_more?: boolean
      }
      const voices = Array.isArray(payload.voices) ? payload.voices : []
      for (const voice of voices) {
        if (typeof voice !== 'object' || voice === null) continue
        const entry = normalizeElevenLabs(voice as Record<string, unknown>, 'shared')
        if (entry.voice_id !== '') entries.push(entry)
      }
      if (payload.has_more !== true || voices.length === 0) break
    }
  } catch (error) {
    failures.push(`共享音色库：${error instanceof Error ? error.message : String(error)}`)
  }

  if (entries.length === 0 && failures.length > 0) {
    throw new Error(`ElevenLabs 音色列表拉取失败：${failures.join('；').slice(0, 300)}`)
  }
  // Owned voices come first and shadow shared ones with the same id.
  const seen = new Set<string>()
  const deduped: VendorVoiceEntry[] = []
  for (const entry of entries) {
    if (seen.has(entry.voice_id)) continue
    seen.add(entry.voice_id)
    deduped.push(entry)
  }
  return {
    vendor: 'elevenlabs',
    voices: deduped,
    truncated: false,
    ...(failures.length === 0 ? {} : { note: `部分端点失败（已忽略）：${failures.join('；').slice(0, 300)}` }),
  }
}

// ------------------------------------------------------ public surface

export async function listVendorVoices(
  channel: AudioChannel,
  options: ListVoicesOptions = {},
): Promise<ListVoicesResult> {
  if (channel.apiUrl.trim() === '') throw new Error('渠道未配置 API 地址')
  if (channel.apiKey.trim() === '') throw new Error('渠道未配置 API 密钥')
  if (!supportsVoiceManagement(channel)) {
    throw new Error(
      `当前渠道「${channel.name}」不提供厂商音色管理接口：仅 MiniMax 与 ElevenLabs 支持音色浏览/删除`,
    )
  }
  if (isMiniMax(channel)) {
    const result = await listMiniMax(channel)
    return {
      vendor: result.vendor,
      ...applyFilter(result.voices, options),
      ...(serverFilterNote(options.serverFilters) === undefined
        ? {}
        : { note: serverFilterNote(options.serverFilters)! }),
    }
  }
  const result = await listElevenLabs(channel, options)
  return {
    vendor: result.vendor,
    ...applyFilter(result.voices, options),
    ...(result.note === undefined ? {} : { note: result.note }),
  }
}

export async function deleteVendorVoice(channel: AudioChannel, voiceId: string): Promise<{
  vendor: string
  voice_id: string
  deleted: true
}> {
  if (channel.apiUrl.trim() === '') throw new Error('渠道未配置 API 地址')
  if (channel.apiKey.trim() === '') throw new Error('渠道未配置 API 密钥')
  const id = voiceId.trim()
  if (id === '') throw new Error('voice_id 不能为空')

  if (isMiniMax(channel)) {
    // Guard: only custom voices (voice_cloning/voice_generation) are deletable.
    const listed = await listMiniMax(channel)
    const known = listed.voices.find(entry => entry.voice_id === id)
    if (known !== undefined && known.source === 'system') {
      throw new Error(`MiniMax 系统预置音色「${id}」为只读，不能删除（仅自定义音色可删）`)
    }
    const base = baseUrl(channel.apiUrl).replace(/\/v1$/i, '')
    const payload = await postJson(`${base}/v1/delete_voice`, channel.apiKey, {
      voice_id: id,
      voice_type: 'voice_cloning',
    }) as { base_resp?: { status_code?: number; status_msg?: string } }
    if (payload.base_resp?.status_code !== undefined && payload.base_resp.status_code !== 0) {
      throw new Error(
        `MiniMax delete_voice 失败：${payload.base_resp.status_msg ?? `status ${payload.base_resp.status_code}`}`,
      )
    }
    return { vendor: 'minimax', voice_id: id, deleted: true }
  }

  if (isElevenLabs(channel)) {
    const base = baseUrl(channel.apiUrl)
    const headers = { 'xi-api-key': channel.apiKey.trim(), accept: 'application/json' }
    // Guard: only account-owned voices are deletable; community voices cannot.
    let owned = false
    let checkFailed = false
    try {
      const payload = await fetchJson(`${base}/voices`, { headers }) as { voices?: Array<{ voice_id?: string }> }
      if (Array.isArray(payload.voices)) {
        owned = payload.voices.some(voice => String(voice.voice_id ?? '') === id)
      }
    } catch {
      checkFailed = true
    }
    if (!checkFailed && !owned) {
      throw new Error(`ElevenLabs 音色「${id}」不是账户自有音色（共享库/官方音色只读），不能删除`)
    }
    const response = await fetch(`${base}/voices/${encodeURIComponent(id)}`, { method: 'DELETE', headers })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`ElevenLabs 删除失败（HTTP ${response.status}）${text === '' ? '' : `：${text.slice(0, 300)}`}`)
    }
    return { vendor: 'elevenlabs', voice_id: id, deleted: true }
  }

  throw new Error(
    `当前渠道「${channel.name}」不提供厂商音色管理接口：仅 MiniMax 与 ElevenLabs 支持音色浏览/删除`,
  )
}

// ---------------------------------------------------------------- pure

function cap(options: ListVoicesOptions): number {
  const limit = typeof options.limit === 'number' && Number.isFinite(options.limit)
    ? Math.floor(options.limit)
    : 100
  return Math.max(1, Math.min(200, limit))
}

/** Which official shared-voice filters are set (for the MiniMax "not supported" note). */
export function serverFilterNote(filters?: SharedVoiceFilters): string | undefined {
  if (filters === undefined) return undefined
  const set = Object.entries(filters)
    .filter(([, value]) => value !== undefined && value !== false)
    .map(([key]) => key)
  return set.length === 0 ? undefined
    : `MiniMax 无服务端筛选端点：${set.join(', ')} 仅在本地按已有字段兜底过滤`
}

function applyFilter(
  entries: VendorVoiceEntry[],
  options: ListVoicesOptions,
): { voices: VendorVoiceEntry[]; truncated: boolean } {
  const keyword = options.keyword?.trim().toLowerCase() ?? ''
  const language = options.language?.trim().toLowerCase() ?? ''
  const source = options.source?.trim().toLowerCase() ?? ''
  const filters = options.serverFilters ?? {}
  const field = (value?: string): string => value?.trim().toLowerCase() ?? ''
  const count = cap(options)
  const matched = entries.filter(entry => {
    if (source !== '' && entry.source !== source) return false
    if (language !== '') {
      const haystack = [entry.language ?? '', entry.locale ?? ''].join(' ').toLowerCase()
      if (!haystack.includes(language)) return false
    }
    // Official shared-voice filters double as local fallback filters so they
    // also apply to owned voices and providers without server-side support.
    if (field(filters.accent) !== '' && field(entry.accent) !== field(filters.accent)) return false
    if (field(filters.gender) !== '' && field(entry.gender) !== field(filters.gender)) return false
    if (field(filters.age) !== '' && field(entry.age) !== field(filters.age)) return false
    if (field(filters.use_case) !== '' && field(entry.use_case) !== field(filters.use_case)) return false
    if (field(filters.category) !== '' && field(entry.category) !== field(filters.category)) return false
    if (field(filters.locale) !== '' && field(entry.locale) !== field(filters.locale)) return false
    const search = field(filters.search)
    if (search !== '') {
      const haystack = [entry.name, entry.description ?? ''].join(' ').toLowerCase()
      if (!haystack.includes(search)) return false
    }
    if (keyword !== '') {
      const haystack = [entry.name, entry.description ?? '', entry.accent ?? '',
        entry.use_case ?? '', entry.gender ?? '', entry.age ?? ''].join(' ').toLowerCase()
      for (const token of keyword.split(/\s+/)) {
        if (token !== '' && !haystack.includes(token)) return false
      }
    }
    return true
  })
  return { voices: matched.slice(0, count), truncated: matched.length > count }
}
