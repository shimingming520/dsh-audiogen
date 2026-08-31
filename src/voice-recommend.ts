/**
 * 按需求描述（prompt）推荐音色：复用 Agent 默认模型（agent-default-model，
 * 与提示词增强同机制）从候选音色池里选出 top-k 并给出理由。
 *
 * 与「提示词增强」一样不新增 API key 配置；推荐结果中的 voice_id 必须真
 * 实存在于候选池（防幻觉），编造的 id 会被丢弃（见 parseVoiceRecommendations）。
 */

import type { VendorVoiceEntry } from './voice-manager.ts'
import { AudioGenError } from './audio-engine.ts'

/** 单条推荐：候选条目字段 + LLM 给出的理由。 */
export type VoiceRecommendation = VendorVoiceEntry & { reason: string }

/** 宿主依赖（与 prompt-enhance 相同的 seam）：
 *  settings 用于读取 agent-default-model；llm 是延迟取用的宿主 LLM 访问器。 */
export interface VoiceRecommendDeps {
  settings: { describe(options?: { redactSecrets?: boolean }): Array<{ ns: unknown; value?: unknown }> }
  llm?: () => unknown
}

/** 写入 LLM 提示的候选上限（超出部分在提示中说明，要求用户先缩小候选集）。 */
export const MAX_CANDIDATES_IN_PROMPT = 80
/** 候选描述的截断长度（超出以 … 结尾）。 */
const MAX_DESCRIPTION_CHARS = 400
/** LLM 调用超时。 */
const RECOMMEND_TIMEOUT_MS = 45_000
/** 输出 token 预算：默认模型多为推理模型，思考 token 计入输出，需留足预算。 */
const RECOMMEND_MAX_TOKENS = 8192

/** 需求描述 + 候选池 → top-k 推荐（每条含 LLM 理由）。 */
export async function recommendVoices(
  deps: VoiceRecommendDeps,
  requirement: string,
  candidates: VendorVoiceEntry[],
  topK: number,
): Promise<VoiceRecommendation[]> {
  const text = requirement.trim()
  if (text === '') {
    throw new AudioGenError('需求描述为空，无法推荐音色', 'recommend-empty-requirement')
  }
  if (candidates.length === 0) {
    throw new AudioGenError('候选音色池为空：请先确认渠道配置了音色库，或放宽筛选条件', 'recommend-no-candidates')
  }

  const descriptor = (deps.settings.describe({ redactSecrets: true }) ?? [])
    .find(candidate => String(candidate.ns) === 'agent-default-model')
  const value = (descriptor?.value ?? {}) as { provider?: unknown; model?: unknown }
  const provider = typeof value.provider === 'string' && value.provider.trim() !== '' ? value.provider.trim() : ''
  const model = typeof value.model === 'string' && value.model.trim() !== '' ? value.model.trim() : ''
  if (provider === '' || model === '') {
    throw new AudioGenError('未找到 Agent 默认模型（agent-default-model）：请先在「设置 → 模型」中配置默认模型', 'no-default-model')
  }

  const runtime = deps.llm?.() as { stream?: (options: unknown) => AsyncIterable<unknown> } | undefined
  if (runtime === undefined || runtime.stream === undefined) {
    throw new AudioGenError('宿主 LLM 服务不可用（ctx.llm 未注册）', 'llm-unavailable')
  }

  const messages = buildRecommendMessages(text, candidates, topK)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new DOMException('The operation timed out.', 'TimeoutError')), RECOMMEND_TIMEOUT_MS)
  timer.unref?.()
  let output = ''
  let terminalFailure = ''
  try {
    for await (const chunk of runtime.stream({
      provider,
      model,
      // dsh-llm 的 Message.content 是 ContentBlock[]（如 [{ type: 'text', text }]），不是纯字符串。
      messages: [{ role: 'user', content: [{ type: 'text', text: messages.user }] }],
      system: messages.system,
      temperature: 0.2,
      maxTokens: RECOMMEND_MAX_TOKENS,
      signal: controller.signal,
    })) {
      const record = chunk as { type?: string; text?: string; block?: { type?: string; text?: string }; reason?: { kind?: string; failure?: { message?: string; code?: string } } }
      if (record.type === 'text-delta' && typeof record.text === 'string') {
        output += record.text
      } else if (record.type === 'block-end' && record.block !== undefined
        && record.block.type === 'text' && typeof record.block.text === 'string') {
        output += record.block.text
      } else if (record.type === 'finish' && record.reason !== undefined
        && record.reason.kind !== 'stop' && record.reason.kind !== undefined && terminalFailure === '') {
        const failure = record.reason.failure
        terminalFailure = typeof failure?.message === 'string' && failure.message.trim() !== ''
          ? `${failure.message}${typeof failure.code === 'string' ? `（${failure.code}）` : ''}`
          : `stream ${record.reason.kind}`
      }
    }
  } finally {
    clearTimeout(timer)
  }

  const content = stripFences(output.trim())
  if (content === '') {
    if (terminalFailure !== '') {
      throw new AudioGenError(`音色推荐失败：LLM 调用出错（${terminalFailure}）。请检查「设置 → 模型」的默认模型是否可用`, 'recommend-llm-error')
    }
    throw new AudioGenError('模型未返回推荐内容：请检查「设置 → 模型」的默认模型是否可用（或稍后重试）', 'recommend-empty-result')
  }

  const recommendations = parseVoiceRecommendations(content, candidates, topK)
  if (recommendations.length === 0) {
    throw new AudioGenError('模型返回的推荐未能匹配候选池：请重试，或先用语言/关键词等条件缩小候选范围', 'recommend-parse-failed')
  }
  return recommendations
}

/** 纯函数：解析 LLM 响应并把推荐校验为候选池成员；无效/编造 id 丢弃。
 *
 * 兼容三种返回形态（模型并不总守 JSON）：
 *  1. JSON {"recommendations": [{"voice_id"|"voice_name": "...", "reason": "..."}]}
 *  2. JSON 数组 [{"voice_id": "..."}, ...] 或单对象 {"voice_id": "..."}
 *  3. 纯文本：按行/逗号/空白切分后，在候选池中做完全匹配（id 或 name，忽略大小写）
 */
export function parseVoiceRecommendations(
  content: string,
  candidates: VendorVoiceEntry[],
  topK: number,
): VoiceRecommendation[] {
  const limit = Math.max(1, Math.floor(Number.isFinite(topK) ? topK : 5))
  const results: VoiceRecommendation[] = []
  const seen = new Set<string>()

  const findCandidate = (raw: string): VendorVoiceEntry | undefined => {
    const needle = String(raw).trim()
    if (needle === '') return undefined
    const byId = candidates.find(candidate => candidate.voice_id === needle)
    if (byId !== undefined) return byId
    const byName = candidates.find(candidate => candidate.name.toLowerCase() === needle.toLowerCase())
    if (byName !== undefined) return byName
    // 宽松：候选 id 大小写不同、或名字带空格差异
    const normalized = needle.toLowerCase().replace(/\s+/g, ' ')
    return candidates.find(candidate =>
      candidate.voice_id.toLowerCase() === normalized
      || candidate.name.toLowerCase().replace(/\s+/g, ' ') === normalized)
  }

  const push = (candidate: VendorVoiceEntry | undefined, reason: string): void => {
    if (candidate === undefined || results.length >= limit) return
    if (seen.has(candidate.voice_id)) return
    seen.add(candidate.voice_id)
    results.push({ ...candidate, reason })
  }

  const data = loadJsonLoose(content)
  const rawItems = data === null ? undefined
    : Array.isArray(data) ? data
      : typeof data === 'object' ? (data as Record<string, unknown>).recommendations
        : undefined

  if (Array.isArray(rawItems)) {
    for (const item of rawItems) {
      if (results.length >= limit) break
      if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
      const record = item as Record<string, unknown>
      const raw = record.voice_id ?? record.voice_name ?? record.name ?? record.id
      const reason = typeof record.reason === 'string' ? record.reason.trim() : ''
      push(findCandidate(String(raw)), reason)
    }
  }

  // 纯文本兜底 / JSON 未解析出足够的推荐时：优先子串匹配（按出现顺序），
  // 再按切分 token 完全匹配，两者都做候选池校验。
  if (results.length < limit) {
    const flat = content.replace(/```[a-zA-Z]*/g, ' ')
    const lower = flat.toLowerCase()
    // 1) 候选 id/name 整体出现在输出里（长名称不会被分词拆散）
    const found = candidates
      .filter(candidate => {
        if (candidate.voice_id.length >= 3 && lower.includes(candidate.voice_id.toLowerCase())) return true
        if (candidate.name.length >= 3 && lower.includes(candidate.name.toLowerCase())) return true
        return false
      })
      .sort((a, b) => {
        const ai = lower.indexOf(a.voice_id.toLowerCase())
        const aiAlt = lower.indexOf(a.name.toLowerCase())
        const bi = lower.indexOf(b.voice_id.toLowerCase())
        const biAlt = lower.indexOf(b.name.toLowerCase())
        const posA = ai === -1 ? aiAlt : ai === -1 ? ai : ai
        const posB = bi === -1 ? biAlt : bi === -1 ? bi : bi
        return (posA === -1 ? Number.MAX_SAFE_INTEGER : posA) - (posB === -1 ? Number.MAX_SAFE_INTEGER : posB)
      })
    for (const candidate of found) {
      if (results.length >= limit) break
      push(candidate, '')
    }
    // 2) 切分 token 完全匹配（英文名字被拆成单词时兜底）
    if (results.length < limit) {
      const tokens = flat
        .replace(/[{}[\],:;"'`\n，。！？、；：（）()【】《》]+/g, ' ')
        .split(/\s+/)
        .map(token => token.trim())
        .filter(token => token !== '')
      for (const token of tokens) {
        if (results.length >= limit) break
        push(findCandidate(token), '')
      }
    }
  }
  return results
}

/** 构造推荐提示：系统（选角专家）+ 用户（需求 + 压缩候选 JSON）。 */
export function buildRecommendMessages(
  requirement: string,
  candidates: VendorVoiceEntry[],
  topK: number,
): { system: string; user: string } {
  // 稳定优先：把带语义线索（语言/性别/年龄/口音/描述）的候选放前面，
  // 让模型在前 80 条里能看到可判断的信息，而不是一堆无描述的自建音色。
  const semantic = (entry: VendorVoiceEntry): boolean =>
    (entry.language !== undefined && entry.language !== '')
    || (entry.gender !== undefined && entry.gender !== '')
    || (entry.age !== undefined && entry.age !== '')
    || (entry.accent !== undefined && entry.accent !== '')
    || (entry.description !== undefined && entry.description !== '')
  const ordered = [...candidates].sort((a, b) => (semantic(a) === semantic(b) ? 0 : semantic(a) ? -1 : 1))
  const shown = ordered.slice(0, MAX_CANDIDATES_IN_PROMPT)
  const note = candidates.length > shown.length
    ? `（注意：共 ${candidates.length} 条候选，仅展示前 ${shown.length} 条，其余候选未展示，请只从展示列表中挑选，或先用筛选条件缩小候选集。）`
    : ''
  const system = [
    '你是资深配音选角专家。根据用户描述的需求，从候选音色列表中挑选最合适的音色。',
    '要求：',
    '1. 只从候选列表中选，voice_id 必须与候选完全一致，不得编造。如果候选只有音色名没有语义字段，请结合名字里的语言/性别/年龄线索判断（如 Male_Young_、Chinese (Mandarin)_ 前缀）。',
    '2. 综合考虑语言、性别、年龄感、音色气质与需求的匹配度，以及配音用途（旁白/角色/广告/游戏等）。',
    `3. 只输出一个 JSON 对象：{"recommendations": [{"voice_id": "候选中的精确 voice_id", "reason": "简短中文理由"}]}，最多 ${Math.max(1, Math.floor(topK))} 条，按推荐优先级排序；候选的 voice_id 与 voice_name 可能相同或不同，一律用 voice_id 字段。`,
    '4. 同需求下避免推荐多个明显同质的音色；不要输出 JSON 以外的任何文字。',
  ].join('\n')
  const compact = shown.map(entry => ({
    voice_id: entry.voice_id,
    voice_name: entry.name,
    provider: entry.provider,
    source: entry.source,
    language: entry.language ?? null,
    locale: entry.locale ?? null,
    accent: entry.accent ?? null,
    gender: entry.gender ?? null,
    age: entry.age ?? null,
    category: entry.category ?? null,
    use_case: entry.use_case ?? null,
    description: truncate(entry.description, MAX_DESCRIPTION_CHARS),
    has_preview: entry.preview_url !== undefined && entry.preview_url !== '',
  }))
  const user = `需求：${requirement}\n\n候选音色（共 ${shown.length} 条）：\n${JSON.stringify(compact, null, 1)}\n${note}`
  return { system, user }
}

function truncate(value: string | undefined, limit: number): string | null {
  if (value === undefined) return null
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
}

/** 去掉模型可能包裹的 ``` 代码围栏。 */
export function stripFences(value: string): string {
  if (value === '') return value
  const withoutFence = value.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '')
  return withoutFence.trim()
}

/** 宽松 JSON 解析：整体失败时尝试提取第一个 { 到最后一个 }。 */
function loadJsonLoose(content: string): unknown {
  const text = stripFences(content)
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end <= start) return null
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch {
      return null
    }
  }
}
