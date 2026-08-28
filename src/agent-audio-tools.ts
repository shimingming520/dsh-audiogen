/**
 * Agent-facing audio-generation tool backed by the same host engine as the
 * panel. Returns a compact JSON text result with same-origin audio URLs so the
 * model can reference the generated audio without receiving binary payloads.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { randomUUID } from 'node:crypto'
import type { AudioChannel } from './audio-engine.ts'
import { generateAudio, AudioGenError } from './audio-engine.ts'
import { appendHistory, saveAudioFile } from './audio-store.ts'
import type { AudioMode, GenerateAudioRequest } from './protocol.ts'

export interface AgentAudioToolConfig {
  enabled: boolean
  allowAgentAudioGeneration: boolean
  channels: AudioChannel[]
  defaultChannelId: string
}

interface AgentAudioRef {
  id: string
  url: string
  mime: string
  bytes: number
  voiceId?: string
}

interface AgentAudioResult {
  status: string
  message: string
  mode: AudioMode
  model: string
  audio: AgentAudioRef[]
  error?: string
}

const audioRefSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    url: { type: 'string', required: true },
    mime: { type: 'string', required: true },
    bytes: { type: 'integer', required: true },
    voiceId: { type: 'string' },
  },
} as const

const resultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', required: true },
    message: { type: 'string', required: true },
    mode: { type: 'string', required: true, enum: ['tts', 'music', 'sfx', 'voice_design'] },
    model: { type: 'string', required: true },
    audio: { type: 'array', required: true, items: audioRefSchema },
    error: { type: 'string' },
  },
} as const

function renderResult(value: AgentAudioResult): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

function resolveModel(config: AgentAudioToolConfig, requested: unknown): {
  channel: AudioChannel
  alias: string
  upstream: string
} {
  const entries = config.channels.flatMap(channel => channel.models.map(model => ({ channel, alias: model.alias, upstream: model.id })))
  if (entries.length === 0) {
    throw new AudioGenError('No audio models/voices are configured. Open Settings > Plugins > AI Audio and add at least one.', 'no-models-configured')
  }
  const wanted = typeof requested === 'string' && requested.trim() !== '' ? requested.trim() : ''
  if (wanted === '') {
    if (entries.length === 1) return entries[0]!
    const options = entries.map(entry => `"${entry.channel.name} · ${entry.alias}"`).join(', ')
    throw new AudioGenError(`Multiple audio models/voices are available — ask the user which channel and model to use, then call again. Options: ${options}.`, 'model-choice-required')
  }
  const hosting = entries.filter(entry => entry.alias === wanted)
  if (hosting.length === 0) {
    const available = [...new Set(entries.map(entry => entry.alias))].join(', ')
    throw new AudioGenError(`Audio model/voice "${wanted}" is not configured. Choose one of: ${available}.`, 'audio-model-not-configured')
  }
  const preferred = hosting.find(entry => entry.channel.id === config.defaultChannelId)
  return preferred ?? hosting[0]!
}

function ensureConfigured(config: AgentAudioToolConfig): void {
  if (!config.enabled) throw new AudioGenError('AI audio generation is disabled. Open Settings > Plugins > AI Audio and enable it.', 'plugin-disabled')
  if (!config.allowAgentAudioGeneration) throw new AudioGenError('Agent audio generation is disabled in Settings > Plugins > AI Audio.', 'agent-generation-disabled')
  const usable = config.channels.some(channel => channel.apiUrl.trim() !== '' && channel.apiKey.trim() !== '')
  if (!usable) throw new AudioGenError('Audio API credentials are not configured. Open Settings > Plugins > AI Audio, add a channel and fill its API URL and API key.', 'audio-api-not-configured')
}

/** Register the Agent audio tool. */
export function registerAgentAudioTools(ctx: Context, resolve: () => AgentAudioToolConfig): () => void {
  const disposer = ctx.tools.register(defineTool({
    name: 'generate_audio',
    description: 'Generate audio with the configured audio provider. Supports text-to-speech, music generation, sound effects and MiniMax voice design. The tool call waits for the upstream result and returns same-origin audio URLs; pass those URLs to the user for playback or download. If multiple models are configured, first ask the user which one to use or pass model explicitly.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'For tts, the text to speak. For music/sfx, a descriptive prompt.' },
      mode: { type: 'string', enum: ['tts', 'music', 'sfx', 'voice_design'], description: 'Generation mode. Defaults to tts.' },
      model: { type: 'string', description: 'One of the configured audio models/voices. Defaults to the first configured model.' },
      voice: { type: 'string', description: 'Optional voice id/name for TTS providers.' },
      preview_text: { type: 'string', description: 'Optional preview text for voice_design.' },
      speed: { type: 'number', description: 'Optional speaking rate / speed multiplier where supported.' },
      duration: { type: 'number', description: 'Requested duration in seconds for music/sfx.' },
      format: { type: 'string', description: 'Output format such as mp3 or wav.' },
    },
    output: {
      schema: resultSchema,
      render: (_args, value) => renderResult(value),
    },
    timeoutMs: 300_000,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const config = resolve()
      ensureConfigured(config)
      const mode = args.mode === 'music' ? 'music' : args.mode === 'sfx' ? 'sfx' : args.mode === 'voice_design' ? 'voice_design' : 'tts'
      const picked = mode === 'voice_design'
        ? (() => {
          const usable = config.channels.filter(channel => channel.apiUrl.trim() !== '' && channel.apiKey.trim() !== '')
          const target = usable.find(channel => channel.id === config.defaultChannelId) ?? usable[0]
          if (target === undefined) throw new AudioGenError('No usable audio channel is configured for voice design.', 'no-channel-available')
          return { channel: target, alias: '', upstream: '' }
        })()
        : resolveModel(config, args.model)
      const request: GenerateAudioRequest = {
        mode,
        model: picked.alias,
        upstream: picked.upstream,
        channelId: picked.channel.id,
        channel: picked.channel.name,
        prompt: args.prompt.trim(),
        ...(typeof args.voice === 'string' && args.voice.trim() !== '' ? { voice: args.voice.trim() } : {}),
        ...(typeof args.preview_text === 'string' && args.preview_text.trim() !== '' ? { previewText: args.preview_text.trim() } : {}),
        ...(typeof args.speed === 'number' ? { speed: args.speed } : {}),
        ...(typeof args.duration === 'number' ? { duration: args.duration } : {}),
        ...(typeof args.format === 'string' && args.format.trim() !== '' ? { format: args.format.trim() } : {}),
      }
      try {
        const outputs = await generateAudio(picked.channel, request, exec.signal)
        const audio: AgentAudioRef[] = []
        for (const [index, output] of outputs.entries()) {
          const saved = await saveAudioFile(output.data, output.mime, `generated-${index + 1}`)
          audio.push({
            id: saved.id,
            url: `/api/dsh-audiogen/audio/${encodeURIComponent(saved.file)}`,
            mime: saved.mime,
            bytes: saved.bytes,
            ...(output.voiceId === undefined ? {} : { voiceId: output.voiceId }),
          })
        }
        try {
          await appendHistory({
            id: randomUUID(),
            createdAt: Date.now(),
            mode: request.mode,
            model: picked.alias,
            prompt: request.prompt,
            ...(request.voice === undefined ? {} : { voice: request.voice }),
            ...(request.speed === undefined ? {} : { speed: request.speed }),
            ...(request.duration === undefined ? {} : { duration: request.duration }),
            ...(request.format === undefined ? {} : { format: request.format }),
            audio: outputs.map((output, index) => ({
              id: audio[index]!.id,
              b64: Buffer.from(output.data).toString('base64'),
              mime: audio[index]!.mime,
              bytes: audio[index]!.bytes,
              url: audio[index]!.url,
              ...(output.voiceId === undefined ? {} : { voiceId: output.voiceId }),
            })),
            channelId: picked.channel.id,
            channel: picked.channel.name,
          })
        } catch {
          // History is best-effort and must not fail the agent tool.
        }
        return {
          status: 'completed',
          message: 'Audio generation completed. The audio files can be played/downloaded from the returned URLs.',
          mode: request.mode,
          model: picked.alias,
          audio,
        }
      } catch (error) {
        if (exec.signal?.aborted === true) throw error
        return {
          status: 'failed',
          message: 'Audio generation failed.',
          mode: request.mode,
          model: picked.alias,
          audio: [],
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }))
  return disposer
}
