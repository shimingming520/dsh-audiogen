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
      voice: { type: 'string', description: 'Optional voice id/name for TTS providers. Required for MiniMax TTS (e.g. male-qn-qingse, female-shaonv); fetch the account voices in Settings > Plugins > AI Audio.' },
      preview_text: { type: 'string', description: 'Optional preview text for voice_design.' },
      speed: { type: 'number', description: 'Optional speaking rate / speed multiplier where supported. MiniMax range 0.5-2.0 (default 1).' },
      duration: { type: 'number', description: 'Requested duration in seconds for music/sfx.' },
      lyrics: { type: 'string', description: 'Lyrics for music generation (MiniMax music-3.0/music-cover). Required unless is_instrumental is true. Split verses with an empty line.' },
      is_instrumental: { type: 'boolean', description: 'Generate purely instrumental music without vocals/lyrics (MiniMax is_instrumental). When true, lyrics may be omitted.' },
      format: { type: 'string', description: 'Output format such as mp3 or wav. MiniMax music supports mp3/wav/pcm.' },
      // ---- MiniMax TTS only (ignored by other providers) ----
      emotion: { type: 'string', description: 'MiniMax TTS emotion, e.g. happy/sad/angry/nervous/fearful/bored (voice_setting.emotion).' },
      vol: { type: 'number', description: 'MiniMax TTS volume 0-10, default 1 (voice_setting.vol).' },
      pitch: { type: 'integer', description: 'MiniMax TTS pitch shift -12..12 semitones, default 0 (voice_setting.pitch).' },
      text_normalization: { type: 'boolean', description: 'MiniMax TTS text normalization switch (voice_setting.text_normalization).' },
      latex_read: { type: 'boolean', description: 'MiniMax TTS math formula reading switch (voice_setting.latex_read).' },
      pronunciation_tone: { type: 'array', items: { type: 'string' }, description: 'MiniMax TTS pronunciation dictionary tone entries, each "word/pronunciation", e.g. ["处理/(chu3)(li3)", "危险/dangerous"] (pronunciation_dict.tone).' },
      sample_rate: { type: 'integer', description: 'MiniMax TTS sample rate: 16000/24000/32000/44100/48000, default 32000 (audio_setting.sample_rate).' },
      bitrate: { type: 'integer', description: 'MiniMax TTS bitrate in bps: 64000-320000, default 128000 (audio_setting.bitrate).' },
      channel: { type: 'integer', description: 'MiniMax TTS audio channels: 1 or 2, default 1 (audio_setting.channel).' },
      force_cbr: { type: 'boolean', description: 'MiniMax TTS force CBR encoding (audio_setting.force_cbr).' },
      subtitle_enable: { type: 'boolean', description: 'MiniMax TTS subtitle output switch (subtitle_enable).' },
      aigc_watermark: { type: 'boolean', description: 'MiniMax TTS AIGC watermark switch (aigc_watermark).' },
      language_boost: { type: 'string', description: 'MiniMax TTS language boost, e.g. 中英混读 (language_boost, model-dependent).' },
      voice_modify: {
        type: 'object',
        additionalProperties: false,
        properties: {
          pitch: { type: 'integer', description: 'Pitch shift for voice modification.' },
          intensity: { type: 'integer', description: 'Intensity for voice modification.' },
          timbre: { type: 'integer', description: 'Timbre shift for voice modification.' },
          sound_effects: { type: 'string', description: 'Sound effect for voice modification, e.g. 耳语.' },
        },
        description: 'MiniMax TTS voice modification (voice_modify, supported by speech-2.8+).',
      },
      timbre_weights: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            voice_id: { type: 'string' },
            weight: { type: 'integer' },
          },
          required: ['voice_id', 'weight'],
        },
        description: 'MiniMax TTS dual-voice blend weights (timbre_weights).',
      },
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
      const voiceModify = typeof args.voice_modify === 'object' && args.voice_modify !== null
        ? (() => {
          const raw = args.voice_modify as Record<string, unknown>
          const out: { pitch?: number; intensity?: number; timbre?: number; soundEffects?: string } = {}
          if (typeof raw.pitch === 'number') out.pitch = raw.pitch
          if (typeof raw.intensity === 'number') out.intensity = raw.intensity
          if (typeof raw.timbre === 'number') out.timbre = raw.timbre
          if (typeof raw.sound_effects === 'string' && raw.sound_effects.trim() !== '') out.soundEffects = raw.sound_effects.trim()
          return Object.keys(out).length > 0 ? out : undefined
        })()
        : undefined
      const timbreWeights = Array.isArray(args.timbre_weights)
        ? args.timbre_weights
          .filter((item): item is { voice_id: string; weight: number } => typeof item === 'object' && item !== null && typeof (item as { voice_id?: unknown }).voice_id === 'string' && typeof (item as { weight?: unknown }).weight === 'number')
          .map(item => ({ voiceId: (item.voice_id as string).trim(), weight: item.weight as number }))
          .filter(item => item.voiceId !== '')
        : undefined
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
        ...(typeof args.lyrics === 'string' && args.lyrics.trim() !== '' ? { lyrics: args.lyrics.trim() } : {}),
        ...(typeof args.is_instrumental === 'boolean' ? { isInstrumental: args.is_instrumental } : {}),
        ...(typeof args.format === 'string' && args.format.trim() !== '' ? { format: args.format.trim() } : {}),
        // ---- MiniMax TTS 专属字段 ----
        ...(typeof args.emotion === 'string' && args.emotion.trim() !== '' ? { emotion: args.emotion.trim() } : {}),
        ...(typeof args.vol === 'number' && Number.isFinite(args.vol) ? { vol: args.vol } : {}),
        ...(typeof args.pitch === 'number' && Number.isFinite(args.pitch) ? { pitch: args.pitch } : {}),
        ...(typeof args.text_normalization === 'boolean' ? { textNormalization: args.text_normalization } : {}),
        ...(typeof args.latex_read === 'boolean' ? { latexRead: args.latex_read } : {}),
        ...(Array.isArray(args.pronunciation_tone) && args.pronunciation_tone.length > 0
          ? { pronunciationTone: args.pronunciation_tone.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item: string) => item.trim()) }
          : {}),
        ...(typeof args.sample_rate === 'number' && Number.isFinite(args.sample_rate) ? { sampleRate: args.sample_rate } : {}),
        ...(typeof args.bitrate === 'number' && Number.isFinite(args.bitrate) ? { bitrate: args.bitrate } : {}),
        ...(typeof args.channel === 'number' && Number.isFinite(args.channel) ? { audioChannel: args.channel } : {}),
        ...(typeof args.force_cbr === 'boolean' ? { forceCbr: args.force_cbr } : {}),
        ...(typeof args.subtitle_enable === 'boolean' ? { subtitleEnable: args.subtitle_enable } : {}),
        ...(typeof args.aigc_watermark === 'boolean' ? { aigcWatermark: args.aigc_watermark } : {}),
        ...(typeof args.language_boost === 'string' && args.language_boost.trim() !== '' ? { languageBoost: args.language_boost.trim() } : {}),
        ...(voiceModify !== undefined ? { voiceModify } : {}),
        ...(timbreWeights !== undefined && timbreWeights.length > 0 ? { timbreWeights } : {}),
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
