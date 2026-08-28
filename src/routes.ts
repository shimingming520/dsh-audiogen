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
import { discoverAudioModels } from './audio-models.ts'
import { AUDIO_PRESETS } from './audio-presets.ts'
import { appendHistory, clearHistory, listHistory, readAudioFile, removeHistory, saveAudioFile } from './audio-store.ts'
import {
  AUDIO_API, AUDIOGEN_SETTINGS_NAMESPACE, GENERATE_API, HISTORY_API, MODEL_API, PRESETS_API, SETTINGS_API,
  type GenerateAudioRequest, type GeneratedAudio, type HistoryEntryInput,
} from './protocol.ts'

const MAX_JSON_BODY_BYTES = 16 * 1024 * 1024

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
  const mode = body.mode === 'music' ? 'music' : body.mode === 'sfx' ? 'sfx' : 'tts'
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (prompt === '') return undefined
  return {
    mode,
    model: typeof body.model === 'string' ? body.model.trim() : '',
    prompt,
    ...(typeof body.voice === 'string' && body.voice.trim() !== '' ? { voice: body.voice.trim() } : {}),
    ...(typeof body.speed === 'number' ? { speed: body.speed } : {}),
    ...(typeof body.duration === 'number' ? { duration: body.duration } : {}),
    ...(typeof body.format === 'string' && body.format.trim() !== '' ? { format: body.format.trim() } : {}),
    ...(typeof body.channelId === 'string' && body.channelId !== '' ? { channelId: body.channelId } : {}),
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

/** Build every /api/dsh-audiogen route. */
export function makeRoutes(deps: AudiogenRoutesDeps): WebRoute[] {
  const guard = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
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
          preset: stored?.preset ?? '',
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
        try {
          const outputs = await generateAudio(channel, request)
          const generated: GeneratedAudio[] = []
          for (const [index, output] of outputs.entries()) {
            const saved = await saveAudioFile(output.data, output.mime, `generated-${index + 1}`)
            generated.push({
              id: saved.id,
              b64: Buffer.from(output.data).toString('base64'),
              mime: saved.mime,
              bytes: saved.bytes,
              url: `${AUDIO_API.file}/${encodeURIComponent(saved.file)}`,
            })
          }
          let history
          try {
            history = await appendHistory({
              id: randomUUID(),
              createdAt: Date.now(),
              mode: request.mode,
              model: request.model,
              prompt: request.prompt,
              ...(request.voice === undefined ? {} : { voice: request.voice }),
              ...(request.speed === undefined ? {} : { speed: request.speed }),
              ...(request.duration === undefined ? {} : { duration: request.duration }),
              ...(request.format === undefined ? {} : { format: request.format }),
              audio: generated,
              ...(request.channelId === undefined ? {} : { channelId: request.channelId }),
              ...(request.channel === undefined ? {} : { channel: request.channel }),
            })
          } catch (error) {
            writeJson(res, 200, { ok: true, outputs: generated, historyError: messageOf(error) })
            return
          }
          writeJson(res, 200, { ok: true, outputs: generated, history })
        } catch (error) {
          const code = error instanceof AudioGenError ? error.code : 'generate-failed'
          writeJson(res, 200, { ok: false, code, message: messageOf(error) })
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
