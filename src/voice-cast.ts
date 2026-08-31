/**
 * 角色音色选角（voice casting）：把「角色画像 → 候选音色 → 主音色 + 备用音色」
 * 流水线落到插件里，等价于 standalone 音频工作室里 MiniMax/ElevenLabs 的选角逻辑。
 *
 * 分工（重要）：
 *  - 本模块只做确定性的事：角色画像归一化、硬过滤（gender/age/use_case 严格，
 *    accent 可放松）、投票校验（voice_id 必须属于该角色候选池、备份补齐、
 *    lead/major 主音色不重复）、选定记录持久化。
 *  - 「选谁」的推理/全局权衡由 Agent（DeepSeek Harness 当前模型）完成：
 *    action=cast 拿到每个角色的候选列表后，Agent 在上下文中统一选角，
 *    再把结果交给 action=save_cast 校验落盘。这样既防幻觉（工具校验），
 *    又保留整组阵容的全局视野（Agent 推理）。
 *
 * 与 audio_studio_standalone 的对应关系：
 *  - 输入结构  = tts/tools/build_character_adapter_input.py 的角色画像（主字段一致）
 *  - 硬过滤    = elevenlabs/voice-selection/tools/elevenlabs_voice_selection.py
 *                _map_gender / _map_age_filter / _filter_candidates_with_fallback
 *  - 校验      = _validate_voice_selection_plan（成员校验 + 备份补齐 + 复用检查）
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type { AudioChannel } from './audio-engine.ts'
import { AudioGenError } from './audio-engine.ts'
import { listVendorVoices, type VendorVoiceEntry } from './voice-manager.ts'

// ---------------------------------------------------------------- types

/** 输入的角色画像（宽松：中英文都接受，字段可缺省）。 */
export interface CharacterProfile {
  character_id: string
  character_name: string
  /** 原始性别文本（男/女/male/female），由 mapGender 归一化。 */
  gender?: string
  /** 原始年龄段文本（少年/青年/中年/老年…），由 mapAgeFilter 归一化。 */
  age_stage?: string[]
  /** explicit | appearance_inferred | unknown —— 决定年龄字段的可信度优先级。 */
  age_stage_source?: string
  voice_traits?: string[]
  personality_traits?: string[]
  appearance?: string[]
  /** 样例台词（voice_design 的 preview_text 来源），最多保留 3 句。 */
  sample_lines?: Array<{ text: string; emotion_hint?: string }>
  dialogue_count?: number
  /** lead | major | supporting；缺省由 dialogue_count 推导（≥200 lead，≥50 major）。 */
  importance_tier?: string
  language?: string
  use_case?: string
}

/** 给 Agent 的角色视图（slim：仅保留选角需要的字段，类型与工具输出 schema 对齐）。 */
export interface CastCharacterSlim {
  character_id: string
  character_name: string
  gender?: string
  age_stage?: string[]
  age_stage_source?: string
  voice_traits?: string[]
  personality_traits?: string[]
  appearance?: string[]
  sample_lines?: Array<{ text: string; emotion_hint?: string }>
  dialogue_count: number
  importance_tier: string
  language?: string
  use_case?: string
}

/** 给 Agent 用的角色候选视图（slim，含映射后的过滤条件）。 */
export interface CastCharacterView {
  character: CastCharacterSlim
  mapped_filters: {
    gender?: string
    age?: string[]
    fallback_age?: string[]
    accent?: string
    use_case?: string
    language?: string
    notes: string
  }
  candidate_count: number
  candidate_voices: SlimVoice[]
  note?: string
}

/** 候选音色的 slim 视图（图片/长描述压缩，保证模型上下文可读）。 */
export interface SlimVoice {
  voice_id: string
  name: string
  source: string
  deletable: boolean
  language?: string
  locale?: string
  accent?: string
  gender?: string
  age?: string
  use_case?: string
  category?: string
  description?: string
  preview_url?: string
}

/** action=save_cast 的输入：Agent 选角结果（voice_id / backup_voice_ids / reason）。 */
export interface CastSelectionInput {
  character_id: string
  character_name?: string
  voice_id: string
  backup_voice_ids?: string[]
  reason?: string
}

/** 校验 + 落盘后的选定记录。 */
export interface CastSelectionRecord {
  character_id: string
  character_name: string
  voice_id: string
  voice_name: string
  backup_voice_ids: string[]
  reason: string
  dialogue_count: number
  importance_tier: string
  /** ok | fixed（备份自动补齐/修正） | tool_fallback（主音色不合法，工具兜底）。 */
  selection_status: string
  issues: string[]
  selected_at: string
}

export interface CastIssue {
  character_id: string
  character_name: string
  issue: string
  detail: string
}

// ------------------------------------------------------------- constants

const MAX_CANDIDATES_PER_CHARACTER = 60
const MAX_SAMPLE_LINES = 3
const MAX_DESCRIPTION_CHARS = 400
const BACKUP_LIMIT = 2

const LEAD_DIALOGUE_COUNT = 200
const MAJOR_DIALOGUE_COUNT = 50

/** 性状拆分：与 standalone 的 TRAIT_SPLIT_RE 一致。 */
const TRAIT_SPLIT_RE = /[；;、,，/|]+/

// ------------------------------------------------------------- primitive

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  return ''
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(item => asString(item)).filter(item => item !== '')
  }
  const text = asString(value)
  return text === '' ? [] : [text]
}

function splitTraits(value: unknown): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of asStringList(value)) {
    for (const part of raw.split(TRAIT_SPLIT_RE)) {
      const item = part.trim()
      if (item !== '' && !seen.has(item)) {
        seen.add(item)
        out.push(item)
      }
    }
  }
  return out
}

function asNumber(value: unknown): number | undefined {
  const text = asString(value)
  if (text === '') return undefined
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** 从角色名生成稳定的 character_id（缺省时自动补，与上游 char_u<hex> 风格一致）。 */
function slugifyCharacterId(characterName: string, fallback: string): string {
  let slug = ''
  for (const char of characterName.toLowerCase()) {
    if (/[a-z0-9]/.test(char)) slug += char
    else if (char === '-' || char === '_') slug += '_'
    else if (char.trim() !== '') slug += `${slug.endsWith('_') || slug === '' ? '' : '_'}u${char.codePointAt(0)!.toString(16)}`
  }
  const parts = slug.split('_').filter(part => part !== '')
  slug = parts.join('_') || fallback
  return `char_${slug}`
}

function importanceTier(dialogueCount: number, explicit?: string): string {
  if (explicit === 'lead' || explicit === 'major' || explicit === 'supporting') return explicit
  if (dialogueCount >= LEAD_DIALOGUE_COUNT) return 'lead'
  if (dialogueCount >= MAJOR_DIALOGUE_COUNT) return 'major'
  return 'supporting'
}

// ---------------------------------------------------------------- profile

/** 接受 JSON 数组 / 单个对象 / {characters: [...]} / JSON 字符串 → 角色剖面。 */
export function parseCharacterProfiles(input: unknown): CharacterProfile[] {
  let value = input
  if (typeof value === 'string') {
    const text = value.trim()
    if (text === '') {
      throw new AudioGenError(
        'characters 不能为空：请传入角色画像 JSON（数组或单个对象）或 JSON 字符串',
        'cast-characters-empty',
      )
    }
    try {
      value = JSON.parse(text)
    } catch {
      throw new AudioGenError(
        'characters 无法解析为 JSON：请先把角色信息整理成类似 '
        + '[{"character_id": "char_xxx", "character_name": "名字", "gender": "女性", '
        + '"age_stage": "少女", "voice_traits": ["清亮"], "personality_traits": ["活泼"], '
        + '"appearance": ["…"], "dialogue_count": 12}] 的结构再调用',
        'cast-characters-parse-failed',
      )
    }
  }

  let list: unknown[]
  if (Array.isArray(value)) {
    list = value
  } else if (isRecord(value)) {
    const inner = value.characters ?? value.classified_characters
    if (Array.isArray(inner)) list = inner
    else list = [value]
  } else {
    throw new AudioGenError(
      'characters 必须是 JSON 数组、单个对象或 JSON 字符串',
      'cast-characters-invalid',
    )
  }

  const profiles: CharacterProfile[] = []
  const missingNames: string[] = []
  list.forEach((item, index) => {
    if (!isRecord(item)) {
      missingNames.push(`characters[${index}] 不是对象`)
      return
    }
    const characterName = asString(item.character_name) || asString(item.name)
    if (characterName === '') {
      missingNames.push(`characters[${index}] 缺少 character_name`)
      return
    }
    const characterId = asString(item.character_id) || slugifyCharacterId(characterName, `r${index}`)
    const rawLines = Array.isArray(item.sample_lines)
      ? item.sample_lines
      : typeof item.sample_lines === 'string'
        ? (item.sample_lines as string).split(/\n+/).map(line => ({ text: line.trim(), emotion_hint: '' }))
        : []
    const sampleLines = rawLines
      .filter(entry => typeof entry === 'string' || isRecord(entry))
      .filter(entry => {
        const text = typeof entry === 'string' ? entry.trim() : (asString(entry.text) || asString(entry.dialogue))
        return text !== ''
      })
      .slice(0, MAX_SAMPLE_LINES)
      .map(entry => {
        const text = typeof entry === 'string' ? entry.trim() : (asString(entry.text) || asString(entry.dialogue))
        const emotion = typeof entry === 'string' ? '' : (asString(entry.emotion_hint) || asString(entry.emotion))
        return { text, ...(emotion === '' ? {} : { emotion_hint: emotion }) }
      })
    profiles.push({
      character_id: characterId,
      character_name: characterName,
      gender: asString(item.gender) || undefined,
      age_stage: asStringList(item.age_stage ?? item.age),
      ...(asString(item.age_stage_source) === '' ? {} : { age_stage_source: asString(item.age_stage_source) }),
      voice_traits: splitTraits(item.voice_traits),
      personality_traits: splitTraits(item.personality_traits),
      appearance: asStringList(item.appearance),
      sample_lines: sampleLines,
      dialogue_count: asNumber(item.dialogue_count),
      importance_tier: asString(item.importance_tier) || asString(item.tier) || undefined,
      ...(asString(item.language) === '' ? {} : { language: asString(item.language) }),
      ...(asString(item.use_case) === '' ? {} : { use_case: asString(item.use_case) }),
    })
  })

  if (missingNames.length > 0) {
    throw new AudioGenError(
      `characters 数据不完整：${missingNames.slice(0, 5).join('；')}（请为每个角色提供 character_name）`,
      'cast-character-missing-name',
    )
  }
  if (profiles.length === 0) {
    throw new AudioGenError('characters 为空：请传入至少一个角色画像', 'cast-characters-empty')
  }
  return profiles
}

// ------------------------------------------------------------- mapping

/** 性别归一：女/female → female；男/male → male；其余 undefined（不过滤）。 */
export function mapGender(text: string | undefined): string | undefined {
  const value = (text ?? '').toLowerCase()
  if (value === '') return undefined
  // 注意顺序：'female' 含 'male' 子串，先判女。
  if (value.includes('女') || value.includes('female')) return 'female'
  if (value.includes('男') || value.includes('male')) return 'male'
  return undefined
}

/** 年龄段归一：老/老年→old；中年→middle_aged；少年/少女/青年/成年→young。 */
export function mapAgeFilter(ageStages: string[] | undefined): string[] {
  const text = (ageStages ?? []).join(' ')
  if (text.trim() === '') return []
  if (text.includes('老') || text.includes('老年')) return ['old']
  if (text.includes('中年') || text.includes('middle')) return ['middle_aged']
  if (text.includes('少年') || text.includes('少女') || text.includes('少男')
    || text.includes('儿童') || text.includes('幼年') || text.includes('teen')
    || text.includes('child') || text.includes('young')) return ['young']
  if (text.includes('青年') || text.includes('年轻') || text.includes('成年')
    || text.includes('youth') || text.includes('adult')) return ['young']
  return []
}

// ------------------------------------------------------------- filter

/** 一个角色对候选池的硬过滤（gender/age/use_case 严格，accent 可放松）。 */
export function filterCandidatesWithFallback(
  pool: VendorVoiceEntry[],
  options: {
    gender?: string
    ages?: string[]
    accent?: string
    use_case?: string
    language?: string
  },
): { candidates: VendorVoiceEntry[]; relaxedAccent: boolean; notes: string } {
  const gender = options.gender
  const ages = options.ages ?? []
  const accent = options.accent
  const useCase = options.use_case
  const language = options.language

  const matches = (voice: VendorVoiceEntry, checkAccent: boolean): boolean => {
    if (gender !== undefined && (voice.gender ?? '').toLowerCase() !== gender.toLowerCase()) return false
    if (ages.length > 0 && !ages.includes((voice.age ?? '').toLowerCase())) return false
    if (language !== undefined && !languageMatchesEntry(voice, language)) return false
    if (useCase !== undefined && useCase !== '' && (voice.use_case ?? '').toLowerCase() !== useCase.toLowerCase()) return false
    if (checkAccent && accent !== undefined && accent !== '' && (voice.accent ?? '').toLowerCase() !== accent.toLowerCase()) return false
    return true
  }

  const strict = pool.filter(voice => matches(voice, true))
  const applied: string[] = []
  if (gender !== undefined) applied.push(`gender=${gender}`)
  if (ages.length > 0) applied.push(`age=${ages.join('/')}`)
  if (useCase !== undefined && useCase !== '') applied.push(`use_case=${useCase}`)
  if (accent !== undefined && accent !== '') applied.push('accent')
  if (language !== undefined && language !== '') applied.push(`language=${language}`)
  const appliedText = applied.join('+') === '' ? 'none' : applied.join('+')
  if (strict.length > 0) {
    return { candidates: strict, relaxedAccent: false, notes: `candidate_filter=${appliedText}` }
  }
  const relaxed = pool.filter(voice => matches(voice, false))
  if (relaxed.length > 0) {
    return { candidates: relaxed, relaxedAccent: true, notes: `candidate_filter=${appliedText}；accent 已放松` }
  }
  return { candidates: [], relaxedAccent: false, notes: 'candidate_filter=empty；严格过滤后无候选（可放宽 use_case 或换渠道）' }
}

function languageMatchesEntry(voice: VendorVoiceEntry, needle: string): boolean {
  const haystack = [voice.language ?? '', voice.locale ?? '', voice.name ?? ''].join(' ').toLowerCase()
  const value = needle.trim().toLowerCase()
  if (value === '') return true
  if (haystack.includes(value)) return true
  const aliases: Record<string, string[]> = {
    zh: ['zh', 'chinese', 'mandarin', 'cantonese'],
    en: ['en', 'english'],
    ja: ['ja', 'japanese'],
    ko: ['ko', 'korean'],
    es: ['es', 'spanish'],
    fr: ['fr', 'french'],
    de: ['de', 'german'],
    ru: ['ru', 'russian'],
    it: ['it', 'italian'],
    pt: ['pt', 'portuguese'],
    ar: ['ar', 'arabic'],
    hi: ['hi', 'hindi'],
  }
  for (const alias of aliases[value] ?? []) {
    if (haystack.includes(alias)) return true
  }
  return false
}

function toSlimVoice(voice: VendorVoiceEntry): SlimVoice {
  const trimmed = voice.description !== undefined && voice.description.length > MAX_DESCRIPTION_CHARS
    ? `${voice.description.slice(0, MAX_DESCRIPTION_CHARS - 1)}…`
    : voice.description
  return {
    voice_id: voice.voice_id,
    name: voice.name,
    source: voice.source,
    deletable: voice.deletable,
    ...(voice.language === undefined ? {} : { language: voice.language }),
    ...(voice.locale === undefined ? {} : { locale: voice.locale }),
    ...(voice.accent === undefined ? {} : { accent: voice.accent }),
    ...(voice.gender === undefined ? {} : { gender: voice.gender }),
    ...(voice.age === undefined ? {} : { age: voice.age }),
    ...(voice.use_case === undefined ? {} : { use_case: voice.use_case }),
    ...(voice.category === undefined ? {} : { category: voice.category }),
    ...(trimmed === undefined ? {} : { description: trimmed }),
    ...(voice.preview_url === undefined ? {} : { preview_url: voice.preview_url }),
  }
}

// ------------------------------------------------------------ fetch pool

export interface VoiceCastOptions {
  /** 角色语言（ISO 或 MiniMax 前缀）；ElevenLabs 候选池按此本地过滤。 */
  language?: string
  /** 硬过滤用途（ElevenLabs characters_animation 等）；传 '' 表示不限制。 */
  use_case?: string
  /** accent 为偏好：严格候选为空时自动放松，不参与硬过滤。 */
  accent?: string
}

async function fetchPool(channel: AudioChannel, options: VoiceCastOptions): Promise<{
  vendor: string
  pool: VendorVoiceEntry[]
  note?: string
}> {
  if (channel.apiUrl.trim() === '') throw new AudioGenError('渠道未配置 API 地址', 'audio-api-not-configured')
  if (channel.apiKey.trim() === '') throw new AudioGenError('渠道未配置 API 密钥', 'audio-api-not-configured')
  const useCase = options.use_case !== undefined && options.use_case !== '' ? options.use_case : undefined
  const result = await listVendorVoices(channel, {
    limit: 500,
    ...(options.language !== undefined && options.language !== '' ? { language: options.language } : {}),
    // accent 不预筛：本地按角色分别「严格 → 放松」处理，才能保留可放松的池子。
    ...(useCase === undefined ? {} : { serverFilters: { use_case: useCase } }),
  })
  return { vendor: result.vendor, pool: result.voices, ...(result.note === undefined ? {} : { note: result.note }) }
}

// ---------------------------------------------------------------- prepare

/** action=cast：角色画像 → 每个角色的硬过滤候选列表（不选角色，不调 LLM）。 */
export async function prepareVoiceCast(
  channel: AudioChannel,
  profiles: CharacterProfile[],
  options: VoiceCastOptions = {},
): Promise<{
  vendor: string
  channel: string
  pool_size: number
  use_case_filter: string
  accent_preference: string
  character_count: number
  characters: CastCharacterView[]
  note?: string
}> {
  const { vendor, pool, note } = await fetchPool(channel, options)
  // MiniMax 音色没有性别/年龄/用途元数据（system voice_id 只有语言前缀），
  // 不能按元数据硬过滤；ElevenLabs 则严格按元数据排除（与 standalone 行为一致）。
  const hasMetadata = vendor !== 'minimax'
  const views: CastCharacterView[] = []
  for (const profile of profiles) {
    const gender = hasMetadata ? mapGender(profile.gender) : undefined
    const ages = hasMetadata ? mapAgeFilter(profile.age_stage) : []
    const language = profile.language ?? options.language
    const useCase = hasMetadata ? (profile.use_case ?? options.use_case) : undefined
    const accent = hasMetadata ? options.accent : undefined
    const dialogueCount = profile.dialogue_count ?? 0
    const tier = importanceTier(dialogueCount, profile.importance_tier)

    const filtered = filterCandidatesWithFallback(pool, {
      ...(gender === undefined ? {} : { gender }),
      ...(ages.length > 0 ? { ages } : {}),
      ...(accent === undefined || accent === '' ? {} : { accent }),
      ...(useCase === undefined || useCase === '' ? {} : { use_case: useCase }),
      ...(language === undefined || language === '' ? {} : { language }),
    })
    const candidates = filtered.candidates.slice(0, MAX_CANDIDATES_PER_CHARACTER)

    const mapped: CastCharacterView['mapped_filters'] = {
      ...(gender === undefined ? {} : { gender }),
      ...(ages.length > 0 ? { age: ages } : {}),
      ...(accent === undefined || accent === '' ? {} : { accent }),
      ...(useCase === undefined || useCase === '' ? {} : { use_case: useCase }),
      ...(language === undefined || language === '' ? {} : { language }),
      notes: `age_stage=${(profile.age_stage ?? []).join('/') || 'unknown'}; ${filtered.notes}${vendor === 'minimax' ? '；MiniMax 音色无性别/年龄/用途元数据，实际仅按语言与名称/描述筛选' : ''}`,
    }

    const slim: CastCharacterSlim = {
      character_id: profile.character_id,
      character_name: profile.character_name,
      dialogue_count: dialogueCount,
      importance_tier: tier,
    }
    if (profile.gender !== undefined) slim.gender = profile.gender
    if ((profile.age_stage ?? []).length > 0) slim.age_stage = profile.age_stage
    if (profile.age_stage_source !== undefined) slim.age_stage_source = profile.age_stage_source
    if ((profile.voice_traits ?? []).length > 0) slim.voice_traits = profile.voice_traits
    if ((profile.personality_traits ?? []).length > 0) slim.personality_traits = profile.personality_traits
    if ((profile.appearance ?? []).length > 0) slim.appearance = profile.appearance
    if ((profile.sample_lines ?? []).length > 0) slim.sample_lines = profile.sample_lines
    if (profile.language !== undefined) slim.language = profile.language
    if (profile.use_case !== undefined) slim.use_case = profile.use_case

    views.push({
      character: slim,
      mapped_filters: mapped,
      candidate_count: candidates.length,
      candidate_voices: candidates.map(toSlimVoice),
      ...(filtered.candidates.length > candidates.length
        ? { note: `candidates truncated: ${filtered.candidates.length} → ${candidates.length}` }
        : {}),
    })
  }
  return {
    vendor,
    channel: channel.name,
    pool_size: pool.length,
    use_case_filter: options.use_case ?? '',
    accent_preference: options.accent ?? '',
    character_count: profiles.length,
    characters: views,
    ...(note === undefined ? {} : { note }),
  }
}

// ---------------------------------------------------------------- save

/** action=save_cast：Agent 选角结果 → 校验 + 补齐 + 落盘（选定记录）。 */
export async function saveVoiceCast(
  channel: AudioChannel,
  profiles: CharacterProfile[],
  selectionInputs: CastSelectionInput[],
  options: VoiceCastOptions = {},
): Promise<{
  vendor: string
  channel: string
  store_path: string
  count: number
  entries: CastSelectionRecord[]
  issues: CastIssue[]
}> {
  const prepared = await prepareVoiceCast(channel, profiles, options)
  const viewsByCharacter = new Map(prepared.characters.map(view => [String(view.character.character_id), view]))
  const inputByCharacter = new Map<string, CastSelectionInput>()
  for (const input of selectionInputs) {
    if (input === null || typeof input !== 'object') continue
    const characterId = asString(input.character_id)
    if (characterId !== '') inputByCharacter.set(characterId, input)
  }

  const entries: CastSelectionRecord[] = []
  const issues: CastIssue[] = []
  const sawReuse = new Map<string, Array<{ character_id: string; character_name: string; tier: string }>>()

  for (const view of prepared.characters) {
    const characterId = String(view.character.character_id ?? '')
    const characterName = String(view.character.character_name ?? characterId)
    const candidates = view.candidate_voices
    const input = inputByCharacter.get(characterId)
    const dialogueCount = asNumber(view.character.dialogue_count) ?? 0
    const tier = String(view.character.importance_tier ?? importanceTier(dialogueCount))

    let primary = asString(input?.voice_id ?? '')
    let status = 'ok'
    const recordIssues: string[] = []
    if (primary === '' || !candidates.some(voice => voice.voice_id === primary)) {
      const fallback = candidates[0]?.voice_id ?? ''
      if (fallback !== '') {
        recordIssues.push('voice_id_not_in_candidates; fallback=first_candidate')
        primary = fallback
        status = 'tool_fallback'
      }
    }

    const requiredBackupCount = Math.min(BACKUP_LIMIT, Math.max(candidates.length - 1, 0))
    const backups: string[] = []
    const rawBackups = Array.isArray(input?.backup_voice_ids) ? input.backup_voice_ids : []
    for (const raw of rawBackups) {
      const id = asString(raw)
      if (id === '' || id === primary || backups.includes(id)) continue
      if (!candidates.some(voice => voice.voice_id === id)) continue
      backups.push(id)
      if (backups.length >= requiredBackupCount) break
    }
    if (backups.length < requiredBackupCount) {
      for (const voice of candidates) {
        if (backups.length >= requiredBackupCount) break
        if (voice.voice_id === primary || backups.includes(voice.voice_id)) continue
        backups.push(voice.voice_id)
      }
      if (status === 'ok') status = 'fixed'
      recordIssues.push('backup_voice_ids_auto_filled')
    }

    const primaryVoice = candidates.find(voice => voice.voice_id === primary)
    const reason = asString(input?.reason ?? '')
    const record: CastSelectionRecord = {
      character_id: characterId,
      character_name: asString(input?.character_name) || characterName,
      voice_id: primary,
      voice_name: primaryVoice?.name ?? '',
      backup_voice_ids: backups,
      reason: reason === ''
        ? (status === 'tool_fallback' ? 'tool fallback: selected from filtered candidates' : '')
        : reason,
      dialogue_count: dialogueCount,
      importance_tier: tier,
      selection_status: status,
      issues: recordIssues,
      selected_at: new Date().toISOString(),
    }
    entries.push(record)
    sawReuse.set(primary, [...(sawReuse.get(primary) ?? []), { character_id: characterId, character_name: characterName, tier }])
  }

  // lead/major 主音色复用检查：仅记录警告，由 Agent 在下一轮修正。
  for (const [voiceId, users] of sawReuse) {
    const important = users.filter(user => user.tier === 'lead' || user.tier === 'major')
    if (important.length > 1) {
      for (const user of important) {
        issues.push({
          character_id: user.character_id,
          character_name: user.character_name,
          issue: 'primary_voice_reused',
          detail: `主音色 ${voiceId} 被 ${important.map(item => item.character_name).join('、')} 复用；lead/major 角色应尽量使用不同主音色`,
        })
      }
    }
  }

  const storePath = await writeCastSelections(channel, entries)
  return { vendor: prepared.vendor, channel: channel.name, store_path: storePath, count: entries.length, entries, issues }
}

// ------------------------------------------------------------ store

export function castSelectionsPath(): string {
  return path.join(process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'), 'dsh-audiogen', 'cast-selections.json')
}

interface CastSelectionsStore {
  version: number
  updatedAt: string
  channels: Record<string, {
    provider: string
    name: string
    updatedAt: string
    entries: Record<string, CastSelectionRecord>
  }>
}

async function loadCastSelections(): Promise<CastSelectionsStore> {
  try {
    const text = await readFile(castSelectionsPath(), 'utf-8')
    const payload = JSON.parse(text)
    if (typeof payload === 'object' && payload !== null && typeof (payload as Record<string, unknown>).channels === 'object') {
      return payload as CastSelectionsStore
    }
  } catch {
    // 文件不存在或损坏时重建。
  }
  return { version: 1, updatedAt: new Date().toISOString(), channels: {} }
}

/** 按渠道合并选定记录（同 character_id 覆盖），写回本地 JSON。 */
export async function writeCastSelections(
  channel: AudioChannel,
  records: CastSelectionRecord[],
): Promise<string> {
  const store = await loadCastSelections()
  const bucket = store.channels[channel.id] ?? { provider: channel.preset || 'custom', name: channel.name, updatedAt: '', entries: {} }
  for (const record of records) {
    bucket.entries[record.character_id] = record
  }
  bucket.updatedAt = new Date().toISOString()
  store.channels[channel.id] = bucket
  store.updatedAt = new Date().toISOString()
  const file = castSelectionsPath()
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(store, null, 2) + '\n', 'utf-8')
  return file
}

/** 读取某渠道已保存的选定记录（character_id → 记录）。 */
export async function readStoredCastSelections(channelId: string): Promise<Record<string, CastSelectionRecord>> {
  const store = await loadCastSelections()
  return store.channels[channelId]?.entries ?? {}
}
