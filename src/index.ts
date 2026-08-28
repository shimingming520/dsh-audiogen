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
import z from 'schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { AUDIOGEN_SETTINGS_NAMESPACE, type ChannelConfig, type ModelMapping } from './protocol.ts'
import { makeRoutes, type ChannelsView, type SettingsSeam } from './routes.ts'
import type { AudioChannel } from './audio-engine.ts'
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
}

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
})

const DEFAULT_ENABLED = true
const DEFAULT_ANNOUNCE = true
const DEFAULT_ALLOW_AGENT_AUDIO = true

const SECTION_ORDER = 160

export const AUDIOGEN_GUIDANCE = '本机已安装 dsh-audiogen 插件（DSH AI 音频）：侧边栏「AI 音频」入口。能力：通过「渠道」对接多个音频生成厂商（OpenAI TTS、ElevenLabs、MiniMax、Stability Audio、自定义 OpenAI 兼容接口），支持 TTS 文本转语音、音乐生成和音效生成。API 地址与密钥在 GUI 设置中按渠道配置，密钥仅存于本机设置文档；生成请求由本地宿主代理转发。Agent 可直接调用 `generate_audio` 提交 TTS/音乐/音效任务，默认等待完成并返回同源音频 URL。限制：生成消耗上游 API 额度；音频内容由上游模型生成；模型只能使用用户在各渠道配置目录中的模型。用户提到「音频 / 语音 / TTS / 配乐 / 音效 / AI 音频」时即指本插件，请据此协作。'

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
}

export function apply(ctx: Context, config?: Config): void {
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
      autoSaveToLibrary: value.autoSaveToLibrary === true,
    }
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
