/**
 * dsh-audiogen — host half.
 *
 * Mounts the plugin settings section (multi-provider audio channels), the
 * /api/dsh-audiogen route family (settings bridge, presets, generation proxy,
 * audio/history serving), and the Agent audio tool. The browser half
 * (./client) renders the sidebar entry and the audio generation panel.
 */

import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { existsSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import z from 'schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { AUDIOGEN_SETTINGS_NAMESPACE, type AudioMode, type ChannelConfig, type LlmModelOption, type ModelMapping } from './protocol.ts'
import { createGenerationBudget } from './audio-scheduler.ts'
import { enhancePromptText } from './prompt-enhance.ts'
import { AudioGenError } from './audio-engine.ts'
import { makeRoutes, type ChannelsView, type SettingsSeam } from './routes.ts'
import type { AudioChannel } from './audio-engine.ts'
import { recommendVoices, type VoiceRecommendation } from './voice-recommend.ts'
import type { VendorVoiceEntry } from './voice-manager.ts'
import { registerAgentAudioTools, type AgentAudioToolConfig } from './agent-audio-tools.ts'
import { audioPresetById } from './audio-presets.ts'

/** Stable cordis plugin name. */
export const name = 'audiogen'

/** Services required before the surfaces can mount. */
export const inject = ['webServer', 'systemPrompt']

/** The branded settings namespace of this plugin. */
export const AudioGenSettingsNamespace = settingsNamespace(AUDIOGEN_SETTINGS_NAMESPACE)

export interface Config {
  enabled?: boolean
  announceToAgent?: boolean
  allowAgentAudioGeneration?: boolean
  channels?: ChannelConfig[]
  channelSecrets?: Record<string, string>
  defaultChannelId?: string
  defaultModel?: string
  autoSaveToLibrary?: boolean
  /** 设置卡按文本编辑，保存值可能是数字或数字字符串。 */
  maxConcurrentGenerations?: number | string
  /**
   * 提示词增强模型，格式 "provider|model"（如 "deepseek-official|deepseek-v4-flash-vision-exp"）；
   * 空串表示跟随 Agent 默认模型（「设置 → 模型」）。
   */
  enhanceModel?: string
}

const DEFAULT_MAX_CONCURRENT = 5

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  announceToAgent: z.boolean().default(true),
  allowAgentAudioGeneration: z.boolean().default(true),
  channels: z.array(z.object({
    id: z.string(),
    preset: z.string().default(''),
    name: z.string().default(''),
    apiUrl: z.string().default(''),
    models: z.array(z.object({
      alias: z.string(),
      id: z.string(),
    })).default([]),
  })).default([]),
  channelSecrets: z.dict(z.string().role('secret')).default({}),
  defaultChannelId: z.string().default(''),
  defaultModel: z.string().default(''),
  autoSaveToLibrary: z.boolean().default(false),
  maxConcurrentGenerations: z.union([z.number(), z.string()]).default(DEFAULT_MAX_CONCURRENT),
  enhanceModel: z.string().default(''),
})

const DEFAULT_ENABLED = true
const DEFAULT_ANNOUNCE = true
const DEFAULT_ALLOW_AGENT_AUDIO = true

const SECTION_ORDER = 160

export const AUDIOGEN_GUIDANCE = '本机已安装 dsh-audiogen 插件（DSH AI 音频）：侧边栏「AI 音频」入口。能力：通过「渠道」对接多个音频生成厂商（OpenAI TTS、ElevenLabs、MiniMax、Stability Audio、自定义 OpenAI 兼容接口），支持 TTS 文本转语音、音乐生成和音效生成。API 地址与密钥在 GUI 设置中按渠道配置，密钥仅存于本机设置文档；生成请求由本地宿主代理转发。Agent 可直接调用 `generate_audio` 提交 TTS/音乐/音效任务，默认等待完成并返回同源音频 URL；可用 `manage_audio_voices` 浏览/筛选/删除厂商音色（MiniMax、ElevenLabs），也能用该工具的 action=recommend 按自然语言需求描述（如「清亮甜美的少女音」）让默认模型推荐 top-k 音色，再用选定音色的 voice_id 调用 `generate_audio` 生成。限制：生成消耗上游 API 额度；音频内容由上游模型生成；模型只能使用用户在各渠道配置目录中的模型。用户提到「音频 / 语音 / TTS / 配乐 / 音效 / AI 音频」时即指本插件，请据此协作。'

function guidanceFor(channels: AudioChannel[], defaultChannelId: string): string {
  if (channels.length === 0) {
    return `${AUDIOGEN_GUIDANCE} 尚未配置任何渠道：请先在「设置 → 插件 → AI 音频」添加渠道并填写 API 地址与密钥。`
  }
  const table = channels.map(channel => {
    const aliases = channel.models.map(model => model.alias).join('、')
    const mark = channel.id === defaultChannelId ? '（默认渠道）' : ''
    const key = channel.apiKey === '' ? '（未填密钥）' : ''
    const models = channel.models.length === 0 ? '未配置模型/音色' : `可用模型/音色：${aliases}`
    return `渠道「${channel.name}」${mark}[${channel.apiUrl}] ${models}${key}`
  }).join('；')
  return `${AUDIOGEN_GUIDANCE} 当前渠道与模型：${table}。`
}

/**
 * 把随包分发的技能（skills/<id>/SKILL.md，含 frontmatter）同步到 DSH 用户技能根
 * `~/.dsh/skills/<id>/SKILL.md` —— DSH web 会话的 skill-filesystem（standard 等
 * preset 行）会扫描用户根，使会话可直接触发这些技能。仅创建缺失文件，绝不覆盖
 * 用户已有内容；任何失败仅告警，不影响插件本身。
 */
function syncBundledSkills(): void {
  try {
    const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
    const sourceRoot = join(packageRoot, 'skills')
    if (existsSync(sourceRoot) !== true) return
    const dshHome = process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh')
    const targetRoot = join(dshHome, 'skills')
    for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
      if (entry.isDirectory() !== true) continue
      const sourceFile = join(sourceRoot, entry.name, 'SKILL.md')
      if (existsSync(sourceFile) !== true) continue
      const targetDir = join(targetRoot, entry.name)
      const targetFile = join(targetDir, 'SKILL.md')
      if (existsSync(targetFile)) continue
      mkdirSync(targetDir, { recursive: true })
      copyFileSync(sourceFile, targetFile)
    }
  } catch {
    // 技能同步为最佳努力：失败不阻断插件启动。
  }
}

function normalizeChannels(value: unknown): ChannelConfig[] {
  if (!Array.isArray(value)) return []
  const out: ChannelConfig[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue
    const raw = item as Record<string, unknown>
    const id = typeof raw.id === 'string' ? raw.id.trim() : ''
    if (id === '') continue
    const models: ModelMapping[] = []
    if (Array.isArray(raw.models)) {
      for (const entry of raw.models) {
        if (entry === null || typeof entry !== 'object') continue
        const record = entry as Record<string, unknown>
        const alias = typeof record.alias === 'string' ? record.alias.trim() : ''
        const upstream = typeof record.id === 'string' ? record.id.trim() : ''
        if (alias === '') continue
        models.push({ alias, id: upstream === '' ? alias : upstream })
      }
    }
    out.push({
      id,
      preset: typeof raw.preset === 'string' ? raw.preset : '',
      name: typeof raw.name === 'string' ? raw.name.trim() : '',
      apiUrl: typeof raw.apiUrl === 'string' ? raw.apiUrl.trim() : '',
      models,
    })
  }
  return out
}

export interface EffectiveConfig {
  enabled: boolean
  announceToAgent: boolean
  allowAgentAudioGeneration: boolean
  channels: AudioChannel[]
  defaultChannelId: string
  defaultModel: string
  autoSaveToLibrary: boolean
  /** 提示词增强模型（"provider|model"；空串 = 跟随 Agent 默认模型）。 */
  enhanceModel: string
  maxConcurrentGenerations: number
}

export function apply(ctx: Context, config?: Config): void {
  syncBundledSkills()
  let current: () => Config = () => config ?? {}

  const resolve = (): EffectiveConfig => {
    const value = current() ?? {}
    const channels = normalizeChannels(value.channels)
    const secrets: Record<string, string> = { ...(value.channelSecrets ?? {}) }
    const named = channels.map(channel => ({
      ...channel,
      name: channel.name === '' ? (audioPresetById(channel.preset)?.name ?? '未命名渠道') : channel.name,
    }))
    const defaultChannelId = typeof value.defaultChannelId === 'string' && named.some(channel => channel.id === value.defaultChannelId)
      ? value.defaultChannelId
      : named[0]?.id ?? ''
    return {
      enabled: value.enabled ?? DEFAULT_ENABLED,
      announceToAgent: value.announceToAgent ?? DEFAULT_ANNOUNCE,
      allowAgentAudioGeneration: value.allowAgentAudioGeneration ?? DEFAULT_ALLOW_AGENT_AUDIO,
      channels: named.map(channel => ({
        ...channel,
        apiKey: typeof secrets[channel.id] === 'string' ? secrets[channel.id] : '',
      })),
      defaultChannelId,
      defaultModel: typeof value.defaultModel === 'string' ? value.defaultModel.trim() : '',
      enhanceModel: typeof value.enhanceModel === 'string' ? value.enhanceModel.trim() : '',
      autoSaveToLibrary: value.autoSaveToLibrary === true,
      maxConcurrentGenerations: (() => {
        const rawMax = value.maxConcurrentGenerations
        const parsedMax = typeof rawMax === 'number' ? rawMax : typeof rawMax === 'string' && rawMax.trim() !== '' ? Number(rawMax.trim()) : NaN
        return Number.isFinite(parsedMax) ? Math.max(1, Math.min(20, Math.floor(parsedMax))) : DEFAULT_MAX_CONCURRENT
      })(),
    }
  }

  // 全局并发闸门：所有上游调用（面板路由 + Agent 工具）共享「最大并发生成数」。
  const budget = createGenerationBudget(() => resolve().maxConcurrentGenerations)

  // 提示词增强：优先用设置的增强模型（enhanceModel），否则复用 Agent 默认模型
  // （agent-default-model 设置）；面板与 Agent 工具共用。
  const enhance = async (prompt: string, mode: AudioMode): Promise<string> => {
    const seam = ctx.get('settings') as unknown as SettingsSeam
    if (seam?.describe === undefined) throw new AudioGenError('设置服务不可用，无法增强提示词', 'settings-unavailable')
    return enhancePromptText({ settings: seam, llm: () => ctx.get('llm') }, prompt, mode, enhanceSelectionOf(resolve()))
  }

  /** 解析设置的增强模型（"provider|model"）；空/非法值返回 undefined = 跟随默认。 */
  const enhanceSelectionOf = (config: EffectiveConfig): { provider: string; model: string } | undefined => {
    const raw = config.enhanceModel ?? ''
    const sep = raw.indexOf('|')
    if (sep <= 0 || sep >= raw.length - 1) return undefined
    const provider = raw.slice(0, sep).trim()
    const model = raw.slice(sep + 1).trim()
    return provider !== '' && model !== '' ? { provider, model } : undefined
  }

  // 音色推荐：与提示词增强同机制，复用 Agent 默认模型（agent-default-model）。
  const recommend = async (
    requirement: string,
    candidates: VendorVoiceEntry[],
    topK: number,
  ): Promise<VoiceRecommendation[]> => {
    const seam = ctx.get('settings') as unknown as SettingsSeam
    if (seam?.describe === undefined) throw new AudioGenError('设置服务不可用，无法推荐音色', 'settings-unavailable')
    return recommendVoices({ settings: seam, llm: () => ctx.get('llm') }, requirement, candidates, topK)
  }

  /** 读取「设置 → 模型」目录：各提供方 + 可广播的模型列表（增强模型下拉候选）。 */
  const llmModelOptions = async (): Promise<LlmModelOption[]> => {
    const llm = ctx.get('llm') as {
      listProviders?: () => Array<{ id?: string; name?: string }>
      listConfigurableProviders?: () => Array<{ provider?: string; displayName?: string }>
      listModels?: (provider: string) => Promise<Array<{ id?: string; name?: string }>>
    } | undefined
    if (llm === undefined || llm.listProviders === undefined || llm.listModels === undefined) return []
    const options: LlmModelOption[] = []
    const directory = new Map<string, string>()
    if (llm.listConfigurableProviders !== undefined) {
      for (const entry of llm.listConfigurableProviders() ?? []) {
        if (typeof entry.provider === 'string' && entry.provider !== '' && typeof entry.displayName === 'string') {
          directory.set(entry.provider, entry.displayName)
        }
      }
    }
    for (const info of llm.listProviders() ?? []) {
      const provider = typeof info.id === 'string' ? info.id : ''
      if (provider === '') continue
      let models: Array<{ id?: string; name?: string }> = []
      try { models = (await llm.listModels(provider)) ?? [] } catch { models = [] }
      for (const model of models) {
        const id = typeof model.id === 'string' ? model.id.trim() : ''
        if (id === '') continue
        const name = typeof model.name === 'string' && model.name.trim() !== '' ? model.name.trim() : id
        options.push({ provider, providerName: directory.get(provider) ?? provider, id, name })
      }
    }
    return options
  }

  const channelsView = (): ChannelsView => {
    const value = resolve()
    return { channels: value.channels, defaultChannelId: value.defaultChannelId }
  }

  ctx.inject(['settings', 'webServer'], (sctx) => {
    const seam = sctx.get('settings') as unknown as SettingsSeam
    sctx.effect(() => {
      const routes = makeRoutes({
        settings: seam,
        resolveChannels: channelsView,
        autoSave: () => resolve().autoSaveToLibrary,
        budget,
        enhance,
        recommend,
        llmModelOptions,
      })
      const disposers = routes.map(route => ctx.webServer.register(route))
      return () => { for (const dispose of disposers) dispose() }
    }, 'dsh-audiogen: routes')
  })

  ctx.inject(['tools'], (tctx) => {
    tctx.effect(() => registerAgentAudioTools(tctx, (): AgentAudioToolConfig => {
      const value = resolve()
      return {
        enabled: value.enabled,
        allowAgentAudioGeneration: value.allowAgentAudioGeneration,
        channels: value.channels,
        defaultChannelId: value.defaultChannelId,
        autoSaveToLibrary: value.autoSaveToLibrary,
        budget,
        enhance,
        recommend,
      }
    }), 'dsh-audiogen: agent audio tools')
  })

  let disposeSection: (() => void) | undefined
  const sync = (): void => {
    if (disposeSection !== undefined) {
      disposeSection()
      disposeSection = undefined
    }
    const value = resolve()
    if (!value.enabled || !value.announceToAgent) return
    disposeSection = ctx.systemPrompt.section({
      name: 'plugin:dsh-audiogen',
      order: SECTION_ORDER,
      text: guidanceFor(value.channels, value.defaultChannelId),
    })
  }

  installSettingsSection(ctx, AudioGenSettingsNamespace, Config, config ?? {}, {
    setSource: (source) => {
      current = source
      sync()
    },
    onChange: sync,
  })

  sync()
}
