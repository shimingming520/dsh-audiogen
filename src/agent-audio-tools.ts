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
import type { GenerationBudget } from './audio-scheduler.ts'
import { appendHistory, saveAudioFile, saveToLibrary, listLibrary } from './audio-store.ts'
import {
  listVendorVoices,
  deleteVendorVoice,
  isElevenLabs,
  type VendorVoiceEntry,
} from './voice-manager.ts'
import type { VoiceRecommendation } from './voice-recommend.ts'
import {
  parseCharacterProfiles,
  prepareVoiceCast,
  saveVoiceCast,
  type CastSelectionInput,
} from './voice-cast.ts'
import type { AudioMode, GenerateAudioRequest, LibraryType } from './protocol.ts'

export interface AgentAudioToolConfig {
  enabled: boolean
  allowAgentAudioGeneration: boolean
  channels: AudioChannel[]
  defaultChannelId: string
  autoSaveToLibrary: boolean
  /** 全局并发闸门（与面板路由共享「最大并发生成数」）。 */
  budget?: GenerationBudget
  /** 提示词增强（复用 Agent 默认模型）；enhance_prompt=true 时在生成前调用。 */
  enhance?: (prompt: string, mode: AudioMode) => Promise<string>
  /** 音色推荐（复用 Agent 默认模型）：需求描述 + 候选池 → top-k 推荐。 */
  recommend?: (requirement: string, candidates: VendorVoiceEntry[], topK: number) => Promise<VoiceRecommendation[]>
}

interface AgentAudioRef {
  id: string
  url: string
  mime: string
  bytes: number
  voiceId?: string
}

/** Internal: the persisted file name, needed for library copies. */
interface SavedAudioRef extends AgentAudioRef {
  file: string
}

/** Per-model group in a multi-model comparison result. */
interface AgentAudioGroup {
  model: string
  audio: AgentAudioRef[]
  resources?: string[]
  error?: string
}

interface AgentAudioResult {
  status: string
  message: string
  mode: AudioMode
  model: string
  audio: AgentAudioRef[]
  /** Resource-library entry ids when the audio was saved to the library. */
  resources?: string[]
  /** Per-model results when several models were generated with the same prompt. */
  groups?: AgentAudioGroup[]
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

const groupSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    model: { type: 'string', required: true },
    audio: { type: 'array', required: true, items: audioRefSchema },
    resources: { type: 'array', items: { type: 'string' } },
    error: { type: 'string' },
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
    resources: { type: 'array', items: { type: 'string' } },
    groups: { type: 'array', items: groupSchema },
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

/** Library type from the generation mode, with an explicit override. */
function libraryTypeOf(mode: AudioMode, override: unknown): LibraryType {
  if (override === 'voice' || override === 'music' || override === 'sfx' || override === 'tts') return override
  if (mode === 'voice_design') return 'voice'
  return mode
}

/** Register the Agent audio tool. */
export function registerAgentAudioTools(ctx: Context, resolve: () => AgentAudioToolConfig): () => void {
  const disposer = ctx.tools.register(defineTool({
    name: 'generate_audio',    description: 'Generate audio with the configured audio provider. Supports text-to-speech, music generation, sound effects and voice design (MiniMax /v1/voice_design, ElevenLabs /v1/text-to-voice/design). The tool call waits for the upstream result and returns same-origin audio URLs; pass those URLs to the user for playback or download. If multiple models are configured, first ask the user which one to use or pass model explicitly.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'For tts, the text to speak. For music/sfx, a descriptive prompt.' },
      mode: { type: 'string', enum: ['tts', 'music', 'sfx', 'voice_design'], description: 'Generation mode. Defaults to tts.' },
      model: { type: 'string', description: 'One of the configured audio models/voices. Defaults to the first configured model.' },
      models: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: several configured model aliases to generate the SAME prompt with each one, sequentially, for comparison (e.g. ["speech-2.8-hd","speech-2.6-hd"]). Cannot be combined with model; when present, models wins.',
      },
      model_params: {
        type: 'object',
        additionalProperties: true,
        description: 'Optional per-model parameter overrides used with "models" (automatic by default = all models share the global params). Keys are model aliases; values are partial param objects using the same param names (format, duration, voice, speed, emotion, vol, pitch, sample_rate, bitrate, lyrics, is_instrumental, loop, prompt_influence, seed, steps, cfg_scale, subtitle_enable, aigc_watermark, language_boost, pronunciation_tone, voice_modify, timbre_weights). Unset fields fall back to the global values.',
      },
      voice: { type: 'string', description: 'Optional voice id/name for TTS providers. Required for MiniMax TTS (e.g. male-qn-qingse, female-shaonv); fetch the account voices in Settings > Plugins > AI Audio.' },
      preview_text: { type: 'string', description: 'Optional preview text for voice_design.' },
      enhance_prompt: { type: 'boolean', description: 'Enhance the prompt with the agent default model before generating (uses the configured model settings, no extra key). Best-effort: on failure the original prompt is used.' },
      speed: { type: 'number', description: 'Optional speaking rate / speed multiplier where supported. MiniMax range 0.5-2.0 (default 1).' },
      duration: { type: 'number', description: 'Requested duration in seconds for music/sfx.' },
      lyrics: { type: 'string', description: 'Lyrics for music generation (MiniMax music-3.0/music-cover). Required unless is_instrumental is true. Split verses with an empty line.' },
      is_instrumental: { type: 'boolean', description: 'Generate purely instrumental music without vocals/lyrics (MiniMax is_instrumental). When true, lyrics may be omitted.' },
      loop: { type: 'boolean', description: 'Create a seamlessly looping sound effect (ElevenLabs sound generation loop, only for eleven_text_to_sound_v2).' },
      prompt_influence: { type: 'number', description: 'Sound effect prompt influence 0-1 (ElevenLabs prompt_influence, default 0.3): higher follows the prompt more closely, lower is more variable.' },
      seed: { type: 'integer', description: 'Stable Audio random seed 0-4294967294 (default 0 = random); same seed yields reproducible audio.' },
      steps: { type: 'integer', description: 'Stable Audio sampling steps, model-dependent: stable-audio-2 30-100, stable-audio-2.5/3 4-8 (out-of-range auto-clamped).' },
      cfg_scale: { type: 'number', description: 'Stable Audio prompt adherence 1-25 (stable-audio-2 default 7, 2.5/3 default 1); higher follows the prompt more strictly.' },
      format: { type: 'string', description: 'Output format such as mp3 or wav. MiniMax music supports mp3/wav/pcm.' },
      // ---- MiniMax TTS only (ignored by other providers) ----
      emotion: { type: 'string', description: 'MiniMax TTS emotion, e.g. happy/sad/angry/nervous/fearful/bored (voice_setting.emotion).' },
      vol: { type: 'number', description: 'MiniMax TTS volume 0-10, default 1 (voice_setting.vol).' },
      pitch: { type: 'integer', description: 'MiniMax TTS pitch shift -12..12 semitones, default 0 (voice_setting.pitch).' },
      text_normalization: { type: 'boolean', description: 'MiniMax TTS text normalization switch (voice_setting.text_normalization).' },
      latex_read: { type: 'boolean', description: 'MiniMax TTS math formula reading switch (voice_setting.latex_read).' },
      pronunciation_tone: { type: 'array', items: { type: 'string' }, description: 'MiniMax TTS pronunciation dictionary tone entries, each "word/pronunciation", e.g. ["处理/(chu3)(li3)", "危险/dangerous"] (pronunciation_dict.tone).' },
      sample_rate: { type: 'integer', description: 'MiniMax sample rate: music 16000/24000/32000/44100 (default 44100); tts default 32000 (audio_setting.sample_rate).' },
      bitrate: { type: 'integer', description: 'MiniMax bitrate in bps: 32000/64000/128000/256000 (music default 256000, tts default 128000; audio_setting.bitrate).' },
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
            voice_id: { type: 'string', required: true },
            weight: { type: 'integer', required: true },
          },
        },
        description: 'MiniMax TTS dual-voice blend weights (timbre_weights).',
      },
      // ---- resource library ----
      save_to_library: { type: 'boolean', description: 'Save the generated audio into the local resource library after success. Also enabled globally by the "auto save to library" setting; pass false to skip a single run.' },
      library_name: { type: 'string', description: 'Resource name in the library. Defaults to the prompt.' },
      library_type: { type: 'string', enum: ['voice', 'music', 'sfx', 'tts'], description: 'Resource type in the library. Defaults to the generation mode (voice_design → voice).' },
      library_tags: { type: 'array', items: { type: 'string' }, description: 'Tags for the library resource.' },
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
      const mode: AudioMode = args.mode === 'music' ? 'music' : args.mode === 'sfx' ? 'sfx' : args.mode === 'voice_design' ? 'voice_design' : 'tts'
      /** 把生成参数（snake_case 入参或 model_params 片段）映射为请求字段。 */
      const mapParams = (raw: Record<string, unknown>): Partial<GenerateAudioRequest> => {
        const voiceModify = typeof raw.voice_modify === 'object' && raw.voice_modify !== null
          ? (() => {
            const src = raw.voice_modify as Record<string, unknown>
            const out: { pitch?: number; intensity?: number; timbre?: number; soundEffects?: string } = {}
            if (typeof src.pitch === 'number') out.pitch = src.pitch
            if (typeof src.intensity === 'number') out.intensity = src.intensity
            if (typeof src.timbre === 'number') out.timbre = src.timbre
            if (typeof src.sound_effects === 'string' && src.sound_effects.trim() !== '') out.soundEffects = src.sound_effects.trim()
            return Object.keys(out).length > 0 ? out : undefined
          })()
          : undefined
        const timbreWeights = Array.isArray(raw.timbre_weights)
          ? raw.timbre_weights
            .filter((item): item is { voice_id: string; weight: number } => typeof item === 'object' && item !== null && typeof (item as { voice_id?: unknown }).voice_id === 'string' && typeof (item as { weight?: unknown }).weight === 'number')
            .map(item => ({ voiceId: (item.voice_id as string).trim(), weight: item.weight as number }))
            .filter(item => item.voiceId !== '')
          : undefined
        const stringOrEmpty = (key: string): string | undefined => {
          const value = raw[key]
          return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
        }
        const finiteOrUndefined = (key: string): number | undefined => {
          const value = raw[key]
          return typeof value === 'number' && Number.isFinite(value) ? value : undefined
        }
        return {
          ...(stringOrEmpty('voice') !== undefined ? { voice: stringOrEmpty('voice')! } : {}),
          ...(stringOrEmpty('preview_text') !== undefined ? { previewText: stringOrEmpty('preview_text')! } : {}),
          ...(finiteOrUndefined('speed') !== undefined ? { speed: finiteOrUndefined('speed')! } : {}),
          ...(finiteOrUndefined('duration') !== undefined ? { duration: finiteOrUndefined('duration')! } : {}),
          ...(stringOrEmpty('lyrics') !== undefined ? { lyrics: stringOrEmpty('lyrics')! } : {}),
          ...(typeof raw.is_instrumental === 'boolean' ? { isInstrumental: raw.is_instrumental } : {}),
          ...(typeof raw.loop === 'boolean' ? { loop: raw.loop } : {}),
          ...(finiteOrUndefined('prompt_influence') !== undefined ? { promptInfluence: finiteOrUndefined('prompt_influence')! } : {}),
          ...(finiteOrUndefined('seed') !== undefined ? { seed: finiteOrUndefined('seed')! } : {}),
          ...(finiteOrUndefined('steps') !== undefined ? { steps: finiteOrUndefined('steps')! } : {}),
          ...(finiteOrUndefined('cfg_scale') !== undefined ? { cfgScale: finiteOrUndefined('cfg_scale')! } : {}),
          ...(stringOrEmpty('format') !== undefined ? { format: stringOrEmpty('format')! } : {}),
          // ---- MiniMax / ElevenLabs / Stability 专属字段 ----
          ...(stringOrEmpty('emotion') !== undefined ? { emotion: stringOrEmpty('emotion')! } : {}),
          ...(finiteOrUndefined('vol') !== undefined ? { vol: finiteOrUndefined('vol')! } : {}),
          ...(finiteOrUndefined('pitch') !== undefined ? { pitch: finiteOrUndefined('pitch')! } : {}),
          ...(typeof raw.text_normalization === 'boolean' ? { textNormalization: raw.text_normalization } : {}),
          ...(typeof raw.latex_read === 'boolean' ? { latexRead: raw.latex_read } : {}),
          ...(Array.isArray(raw.pronunciation_tone) && raw.pronunciation_tone.length > 0
            ? { pronunciationTone: raw.pronunciation_tone.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item: string) => item.trim()) }
            : {}),
          ...(finiteOrUndefined('sample_rate') !== undefined ? { sampleRate: finiteOrUndefined('sample_rate')! } : {}),
          ...(finiteOrUndefined('bitrate') !== undefined ? { bitrate: finiteOrUndefined('bitrate')! } : {}),
          ...(finiteOrUndefined('channel') !== undefined ? { audioChannel: finiteOrUndefined('channel')! } : {}),
          ...(typeof raw.force_cbr === 'boolean' ? { forceCbr: raw.force_cbr } : {}),
          ...(typeof raw.subtitle_enable === 'boolean' ? { subtitleEnable: raw.subtitle_enable } : {}),
          ...(typeof raw.aigc_watermark === 'boolean' ? { aigcWatermark: raw.aigc_watermark } : {}),
          ...(stringOrEmpty('language_boost') !== undefined ? { languageBoost: stringOrEmpty('language_boost')! } : {}),
          ...(voiceModify !== undefined ? { voiceModify } : {}),
          ...(timbreWeights !== undefined && timbreWeights.length > 0 ? { timbreWeights } : {}),
        }
      }
      const buildRequest = (picked: { channel: AudioChannel; alias: string; upstream: string }): GenerateAudioRequest => {
        const base = mapParams(args as unknown as Record<string, unknown>)
        // 每模型参数覆盖（model_params[alias]）；缺省 = 自动沿用全局配置
        let override: Partial<GenerateAudioRequest> = {}
        if (typeof args.model_params === 'object' && args.model_params !== null) {
          const perModel = (args.model_params as Record<string, unknown>)[picked.alias]
          if (typeof perModel === 'object' && perModel !== null) override = mapParams(perModel as Record<string, unknown>)
        }
        return {
          mode,
          model: picked.alias,
          upstream: picked.upstream,
          channelId: picked.channel.id,
          channel: picked.channel.name,
          prompt: typeof args.prompt === 'string' ? args.prompt.trim() : '',
          ...base,
          ...override,
        }
      }
      /** 单模型执行：生成 + 保存文件 + 历史 + 可选资源库；错误收敛为分组结果。 */
      const runOne = async (picked: { channel: AudioChannel; alias: string; upstream: string }): Promise<AgentAudioGroup> => {
        const request = buildRequest(picked)
        // 可选：生成前用 Agent 默认模型增强 prompt（失败则沿用原文）
        if (args.enhance_prompt === true && config.enhance !== undefined) {
          try {
            request.prompt = await config.enhance(request.prompt, request.mode)
          } catch {
            // 增强失败不阻断生成
          }
        }
        try {
          // 与面板路由共享全局并发闸门（限流时排队；取消时立即出队）。
          const release = await (config.budget?.acquire(exec.signal) ?? Promise.resolve(() => { /* 默认不限制 */ }))
          let outputs
          try {
            outputs = await generateAudio(picked.channel, request, exec.signal)
          } finally {
            release()
          }
          const audio: AgentAudioRef[] = []
          const saved: SavedAudioRef[] = []
          for (const [index, output] of outputs.entries()) {
            const stored = await saveAudioFile(output.data, output.mime, `generated-${index + 1}`)
            saved.push({
              id: stored.id,
              url: `/api/dsh-audiogen/audio/${encodeURIComponent(stored.file)}`,
              file: stored.file,
              mime: stored.mime,
              bytes: stored.bytes,
              ...(output.voiceId === undefined ? {} : { voiceId: output.voiceId }),
            })
            audio.push({
              id: stored.id,
              url: `/api/dsh-audiogen/audio/${encodeURIComponent(stored.file)}`,
              mime: stored.mime,
              bytes: stored.bytes,
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
              ...(request.previewText === undefined ? {} : { previewText: request.previewText }),
              ...(request.speed === undefined ? {} : { speed: request.speed }),
              ...(request.duration === undefined ? {} : { duration: request.duration }),
              ...(request.format === undefined ? {} : { format: request.format }),
              audio: outputs.map((output, index) => ({
                id: saved[index]!.id,
                file: saved[index]!.file,
                b64: Buffer.from(output.data).toString('base64'),
                mime: saved[index]!.mime,
                bytes: saved[index]!.bytes,
                url: saved[index]!.url,
                ...(output.voiceId === undefined ? {} : { voiceId: output.voiceId }),
              })),
              channelId: picked.channel.id,
              channel: picked.channel.name,
              params: { ...request },
            })
          } catch {
            // History is best-effort and must not fail the agent tool.
          }
          // ---- 资源库保存：显式参数优先；设置自动入库时可用 false 跳过 ----
          const wantSave = args.save_to_library === true || (config.autoSaveToLibrary && args.save_to_library !== false)
          let resources: string[] | undefined
          if (wantSave) {
            try {
              const entry = await saveToLibrary({
                audioFiles: saved.map(item => ({
                  id: item.id,
                  file: item.file,
                  mime: item.mime,
                  ...(item.voiceId === undefined ? {} : { voiceId: item.voiceId }),
                })),
                type: libraryTypeOf(request.mode, args.library_type),
                ...(typeof args.library_name === 'string' && args.library_name.trim() !== '' ? { name: args.library_name.trim() } : {}),
                ...(Array.isArray(args.library_tags) ? { tags: args.library_tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim() !== '').map(tag => tag.trim()) } : {}),
                provenance: {
                  mode: request.mode,
                  prompt: request.prompt,
                  channel: picked.channel.name,
                  channelId: picked.channel.id,
                  apiUrl: picked.channel.apiUrl,
                  model: picked.alias,
                  upstream: picked.upstream,
                  ...(request.voice === undefined ? {} : { voice: request.voice }),
                  ...(request.previewText === undefined ? {} : { previewText: request.previewText }),
                  params: { ...request },
                },
              })
              resources = [entry.id]
            } catch {
              // library-save is best-effort; generation already succeeded.
            }
          }
          return {
            model: picked.alias,
            audio,
            ...(resources === undefined ? {} : { resources }),
          }
        } catch (error) {
          if (exec.signal?.aborted === true) throw error
          return {
            model: picked.alias,
            audio: [],
            error: error instanceof Error ? error.message : String(error),
          }
        }
      }
      // ---- 多模型对比：同一 prompt 依次生成 ----
      const requestedModels = Array.isArray(args.models)
        ? [...new Set(args.models.filter((item: unknown): item is string => typeof item === 'string' && item.trim() !== '').map((item: string) => item.trim()))]
        : []
      if (requestedModels.length > 0 && mode !== 'voice_design') {
        const groups: AgentAudioGroup[] = []
        let succeeded = 0
        for (const alias of requestedModels) {
          let picked
          try {
            picked = resolveModel(config, alias)
          } catch (error) {
            groups.push({ model: alias, audio: [], error: error instanceof Error ? error.message : String(error) })
            continue
          }
          const group = await runOne(picked)
          groups.push(group)
          if (group.error === undefined) succeeded++
        }
        return {
          status: succeeded > 0 ? 'completed' : 'failed',
          message: succeeded > 0
            ? `Generated ${succeeded}/${groups.length} model(s) with the same prompt for comparison. The audio files can be played/downloaded from the returned URLs.`
            : 'All model generations failed.',
          mode,
          model: groups[0]?.model ?? requestedModels[0]!,
          audio: groups.flatMap(group => group.audio),
          groups,
          ...(succeeded === 0
            ? { error: groups.map(group => `${group.model}: ${group.error ?? ''}`).filter(item => !item.endsWith(': ')).join('；') }
            : {}),
        }
      }
      // ---- 单模型（含音色设计） ----
      const picked = mode === 'voice_design'
        ? (() => {
          const usable = config.channels.filter(channel => channel.apiUrl.trim() !== '' && channel.apiKey.trim() !== '')
          const target = usable.find(channel => channel.id === config.defaultChannelId) ?? usable[0]
          if (target === undefined) throw new AudioGenError('No usable audio channel is configured for voice design.', 'no-channel-available')
          return { channel: target, alias: '', upstream: '' }
        })()
        : resolveModel(config, args.model)
      const one = await runOne(picked)
      if (one.error !== undefined) {
        return {
          status: 'failed',
          message: 'Audio generation failed.',
          mode,
          model: one.model,
          audio: [],
          error: one.error,
        }
      }
      return {
        status: 'completed',
        message: 'Audio generation completed. The audio files can be played/downloaded from the returned URLs.',
        mode,
        model: one.model,
        audio: one.audio,
        ...(one.resources === undefined ? {} : { resources: one.resources }),
      }
    },
  }))

  const searchDisposer = ctx.tools.register(defineTool({
    name: 'search_audio_library',
    description: 'Search curated audio resources in the local resource library (voice / music / sfx / tts). Returns matching resources with type, category, name, tags, full provenance (channel, model, voiceId, prompt) and same-origin audio URLs the user can play. Use it before generating to reuse an existing voice, music bed or sound effect instead of generating a new one.',
    parameters: {
      type: { type: 'string', enum: ['voice', 'music', 'sfx', 'tts'], description: 'Filter by resource type.' },
      category: { type: 'string', description: 'Filter by category (voice: male/female/custom; tts: the speaking voice key).' },
      keyword: { type: 'string', description: 'Search name, tags, prompt and model.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, enum: ['ok'] },
          count: { type: 'integer', required: true },
          entries: {
            type: 'array', required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                type: { type: 'string', required: true, enum: ['voice', 'music', 'sfx', 'tts'] },
                category: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' }, required: true },
                prompt: { type: 'string', required: true },
                model: { type: 'string' },
                channel: { type: 'string' },
                voiceId: { type: 'string' },
                urls: { type: 'array', items: { type: 'string' }, required: true },
              },
            },
          },
        },
      } as const,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const keyword = typeof args.keyword === 'string' ? args.keyword.trim().toLowerCase() : ''
      const wantedType = args.type === 'voice' || args.type === 'music' || args.type === 'sfx' || args.type === 'tts' ? args.type : undefined
      const wantedCategory = typeof args.category === 'string' && args.category.trim() !== '' ? args.category.trim() : undefined
      const all = await listLibrary()
      const entries = all.filter(entry => {
        if (wantedType !== undefined && entry.type !== wantedType) return false
        if (wantedCategory !== undefined && (entry.category ?? '') !== wantedCategory) return false
        if (keyword !== '') {
          const haystack = [entry.name, ...entry.tags, entry.provenance.prompt, entry.provenance.model ?? '', entry.provenance.channel ?? ''].join(' ').toLowerCase()
          if (!haystack.includes(keyword)) return false
        }
        return true
      }).slice(0, 30).map(entry => ({
        id: entry.id,
        name: entry.name,
        type: entry.type,
        ...(entry.category === undefined ? {} : { category: entry.category }),
        tags: entry.tags,
        prompt: entry.provenance.prompt,
        ...(entry.provenance.model === undefined ? {} : { model: entry.provenance.model }),
        ...(entry.provenance.channel === undefined ? {} : { channel: entry.provenance.channel }),
        ...(entry.provenance.voiceId === undefined ? {} : { voiceId: entry.provenance.voiceId }),
        urls: entry.files.map(file => file.url),
      }))
      return { status: 'ok' as const, count: entries.length, entries }
    },
  }))

  /** 单条音色条目 schema（voices / candidate_voices 共用）。 */
  const voiceItemSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      voice_id: { type: 'string', required: true },
      name: { type: 'string', required: true },
      source: { type: 'string', required: true },
      deletable: { type: 'boolean', required: true },
      language: { type: 'string' },
      locale: { type: 'string' },
      accent: { type: 'string' },
      gender: { type: 'string' },
      age: { type: 'string' },
      use_case: { type: 'string' },
      category: { type: 'string' },
      description: { type: 'string' },
      preview_url: { type: 'string' },
    },
  } as const

  /** 厂商音色管理：浏览/筛选 + 按需求描述推荐 + 删除（仅自建）+ 角色选角（cast）。删除不可逆，必须 confirm=true。 */
  const managementDisposer = ctx.tools.register(defineTool({
    name: 'manage_audio_voices',
    description: 'Manage vendor voice libraries (MiniMax / ElevenLabs). action=list: browse available TTS voices of a channel — official/shared voices plus voices designed/cloned by the account; filtering supports the official /v1/shared-voices server-side filters (search/use_case/accent/gender/age/locale/category/sort/featured/free_users_allowed/descriptive) for the ElevenLabs shared library, plus local language/keyword/source filtering everywhere; returns voice_id/name/source/description/preview_url and whether each voice is deletable. action=recommend: let the agent default model pick the top-k voices for a natural-language requirement (e.g. "17岁清亮甜美的少女音，适合活泼女主角，英式口音") from the same candidate pool — pass requirement (required) and optional top_k (1-10, default 5); returns ranked voices with a short reason each; voice_ids are validated against the pool (hallucinated ids are dropped). action=cast: 角色音色选角第一步 — pass characters (角色画像 JSON 数组/对象/JSON 字符串：character_id, character_name, gender 男/女, age_stage 少年/青年/中年/老年, voice_traits, personality_traits, appearance, sample_lines, dialogue_count, language, use_case) plus optional language/use_case/accent; the tool applies deterministic hard filters per character (gender/age/use_case strict; accent is a preference and is relaxed only when the strict pool is empty) and returns each character\u2019s mapped filters + filtered candidate_voices (primary + backup slots). Then select voices globally in-context (lead/major 角色主音色不要复用), and call action=save_cast with the same characters plus selections [{character_id, voice_id, character_name?, backup_voice_ids?, reason?}] to validate membership, auto-fill backups, flag primary reuse and persist the cast plan to ~/.dsh/dsh-audiogen/cast-selections.json. action=delete: delete one OWNED voice (custom/owned only; official/shared/system voices are read-only and refused) — irreversible, so confirm must be true (pass the exact voice_id from action=list). Use the returned voice_id with generate_audio (mode=tts, voice=<voice_id>) to speak with the selected voice.',
    parameters: {
      action: { type: 'string', enum: ['list', 'recommend', 'delete', 'cast', 'save_cast'], required: true, description: 'list = browse/filter voices; recommend = pick voices for a requirement with the agent default model; cast = prepare per-character filtered candidate pools (deterministic hard filters, no LLM); save_cast = validate + persist a cast plan made in-context; delete = remove an owned voice.' },
      channel: { type: 'string', description: 'Channel name or id (e.g. the channel shown in settings). Defaults to the default channel; required when more than one channel is configured.' },
      characters: { type: 'json', description: 'Required for cast/save_cast: 角色画像 — JSON array of profile objects, a single profile object, or a JSON string. Each profile: character_id (optional, auto-derived from character_name), character_name (required), gender (男/女 or male/female), age_stage (少年/青年/中年/老年…, string or array), age_stage_source (explicit/appearance_inferred/unknown), voice_traits, personality_traits, appearance (string or string[]), sample_lines ([{text, emotion_hint?}] or text), dialogue_count (number), language (en/zh/ja…), use_case. Convert free-text character descriptions into this structure before calling.' },
      selections: { type: 'json', description: 'Required for save_cast: the cast plan made by you — JSON array of {character_id, voice_id, character_name?, backup_voice_ids?, reason?}. voice_id must come from the cast action\u2019s candidate_voices; the tool validates membership, fills missing backups, flags lead/major primary reuse and persists to ~/.dsh/dsh-audiogen/cast-selections.json.' },
      language: { type: 'string', description: 'Filter for list/recommend: language substring (ISO code like en/zh/ja, or a label like Chinese (Mandarin)). For cast: pool language for the candidates (per-character language overrides it).' },
      keyword: { type: 'string', description: 'Filter for list/recommend: free text over voice name/description/accent/use_case.' },
      source: { type: 'string', enum: ['system', 'custom', 'owned', 'shared'], description: 'Filter for list/recommend: MiniMax system/custom; ElevenLabs owned (account) / shared (community).' },
      search: { type: 'string', description: 'Official /v1/shared-voices filter: free-text search over the ElevenLabs shared voice library (ElevenLabs only; local fallback elsewhere).' },
      use_case: { type: 'string', description: 'Official filter: use case, e.g. characters_animation / conversational / narration / gaming (ElevenLabs shared library). For cast: hard filter per character (default characters_animation for ElevenLabs; pass "" to disable).' },
      accent: { type: 'string', description: 'Official filter: accent, e.g. british / american / australian. For cast: accent is a preference (strict first, relaxed when the strict pool is empty).' },
      gender: { type: 'string', description: 'Official filter: male / female.' },
      age: { type: 'string', description: 'Official filter: age bracket, e.g. adult / young / middle_aged.' },
      locale: { type: 'string', description: 'Official filter: language locale, e.g. en-us / en-gb.' },
      category: { type: 'string', description: 'Official filter: voice category, e.g. animation / voice_actors.' },
      sort: { type: 'string', enum: ['most_used', 'random', 'oldest', 'newest'], description: 'Official sort for the shared library.' },
      featured: { type: 'boolean', description: 'Official filter: featured shared voices only (true only).' },
      free_users_allowed: { type: 'boolean', description: 'Official filter: voices allowed for free users only (true only).' },
      descriptive: { type: 'boolean', description: 'Official filter: voices with descriptions only (true only).' },
      requirement: { type: 'string', description: 'Required for recommend: the natural-language voice requirement, e.g. "低沉磁性的中年男声，适合沉稳旁白".' },
      top_k: { type: 'integer', description: 'Optional for recommend: how many voices to return (1-10, default 5).' },
      voice_id: { type: 'string', description: 'Required for delete: the exact voice_id from action=list.' },
      confirm: { type: 'boolean', description: 'Required for delete: must be true; deletion is irreversible.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, enum: ['ok'] },
          kind: { type: 'string', required: true, enum: ['list', 'recommend', 'delete', 'cast', 'save_cast'] },
          vendor: { type: 'string', required: true },
          channel: { type: 'string', required: true },
          count: { type: 'integer' },
          truncated: { type: 'boolean' },
          requirement: { type: 'string' },
          candidate_count: { type: 'integer' },
          voices: {
            type: 'array',
            items: voiceItemSchema,
          },
          recommendations: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                voice_id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                source: { type: 'string', required: true },
                deletable: { type: 'boolean', required: true },
                language: { type: 'string' },
                accent: { type: 'string' },
                gender: { type: 'string' },
                age: { type: 'string' },
                use_case: { type: 'string' },
                description: { type: 'string' },
                preview_url: { type: 'string' },
                reason: { type: 'string', required: true },
              },
            },
          },
          // ---- cast / save_cast ----
          pool_size: { type: 'integer' },
          use_case_filter: { type: 'string' },
          accent_preference: { type: 'string' },
          character_count: { type: 'integer' },
          characters: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                character: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    character_id: { type: 'string', required: true },
                    character_name: { type: 'string', required: true },
                    gender: { type: 'string' },
                    age_stage: { type: 'array', items: { type: 'string' } },
                    age_stage_source: { type: 'string' },
                    voice_traits: { type: 'array', items: { type: 'string' } },
                    personality_traits: { type: 'array', items: { type: 'string' } },
                    appearance: { type: 'array', items: { type: 'string' } },
                    sample_lines: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          text: { type: 'string', required: true },
                          emotion_hint: { type: 'string' },
                        },
                      },
                    },
                    dialogue_count: { type: 'integer', required: true },
                    importance_tier: { type: 'string', required: true },
                    language: { type: 'string' },
                    use_case: { type: 'string' },
                  },
                },
                mapped_filters: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    gender: { type: 'string' },
                    age: { type: 'array', items: { type: 'string' } },
                    fallback_age: { type: 'array', items: { type: 'string' } },
                    accent: { type: 'string' },
                    use_case: { type: 'string' },
                    language: { type: 'string' },
                    notes: { type: 'string', required: true },
                  },
                },
                candidate_count: { type: 'integer', required: true },
                candidate_voices: { type: 'array', required: true, items: voiceItemSchema },
                note: { type: 'string' },
              },
            },
          },
          selections: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                character_id: { type: 'string', required: true },
                character_name: { type: 'string', required: true },
                voice_id: { type: 'string', required: true },
                voice_name: { type: 'string', required: true },
                backup_voice_ids: { type: 'array', items: { type: 'string' }, required: true },
                reason: { type: 'string', required: true },
                dialogue_count: { type: 'integer' },
                importance_tier: { type: 'string' },
                selection_status: { type: 'string', required: true },
                issues: { type: 'array', items: { type: 'string' }, required: true },
                selected_at: { type: 'string' },
              },
            },
          },
          issues: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                character_id: { type: 'string', required: true },
                character_name: { type: 'string', required: true },
                issue: { type: 'string', required: true },
                detail: { type: 'string', required: true },
              },
            },
          },
          store_path: { type: 'string' },
          voice_id: { type: 'string' },
          deleted: { type: 'boolean' },
          message: { type: 'string' },
          note: { type: 'string' },
        },
      } as const,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    timeoutMs: 120_000,
    isConcurrencySafe: () => true,
    async execute(args) {
      const config = resolve()
      if (!config.enabled) {
        throw new AudioGenError('AI audio is disabled. Open Settings > Plugins > AI Audio and enable it.', 'plugin-disabled')
      }
      const channel = resolveVoiceManagementChannel(config, args.channel)
      const action = args.action === 'delete' ? 'delete'
        : args.action === 'recommend' ? 'recommend'
          : args.action === 'cast' ? 'cast'
            : args.action === 'save_cast' ? 'save_cast'
              : 'list'
      // ---- 角色选角：先过滤（cast），后校验落盘（save_cast）——LLM 推理在中间由 Agent 完成。 ----
      if (action === 'cast' || action === 'save_cast') {
        const characters = parseCharacterProfiles(args.characters)
        // ElevenLabs 选角默认硬过滤用途 characters_animation（传 "" 可关闭）；accent 仅是偏好。
        const defaultUseCase = isElevenLabs(channel) && typeof args.use_case !== 'string' ? 'characters_animation' : undefined
        const castOptions = {
          ...(typeof args.use_case === 'string' ? { use_case: args.use_case.trim() } : defaultUseCase === undefined ? {} : { use_case: defaultUseCase }),
          ...(typeof args.language === 'string' && args.language.trim() !== '' ? { language: args.language.trim() } : {}),
          ...(typeof args.accent === 'string' && args.accent.trim() !== '' ? { accent: args.accent.trim() } : {}),
        }
        if (action === 'cast') {
          const prepared = await prepareVoiceCast(channel, characters, castOptions)
          return {
            status: 'ok' as const,
            kind: 'cast' as const,
            vendor: prepared.vendor,
            channel: prepared.channel,
            pool_size: prepared.pool_size,
            use_case_filter: prepared.use_case_filter,
            accent_preference: prepared.accent_preference,
            character_count: prepared.character_count,
            characters: prepared.characters,
            ...(prepared.note === undefined ? {} : { note: prepared.note }),
          }
        }
        const rawSelections = args.selections
        const selectionInputs: CastSelectionInput[] = Array.isArray(rawSelections) ? rawSelections as unknown as CastSelectionInput[] : []
        if (selectionInputs.length === 0) {
          throw new AudioGenError(
            'save_cast requires selections — an array of {character_id, voice_id, character_name?, backup_voice_ids?, reason?} matching the cast result',
            'cast-selections-required',
          )
        }
        const saved = await saveVoiceCast(channel, characters, selectionInputs, castOptions)
        return {
          status: 'ok' as const,
          kind: 'save_cast' as const,
          vendor: saved.vendor,
          channel: saved.channel,
          store_path: saved.store_path,
          count: saved.count,
          selections: saved.entries,
          issues: saved.issues,
        }
      }
      if (action === 'list' || action === 'recommend') {
        const source = typeof args.source === 'string' && ['system', 'custom', 'owned', 'shared'].includes(args.source) ? args.source : undefined
        const pick = (value: unknown): string | undefined => typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
        const serverFilters = {
          ...(pick(args.search) === undefined ? {} : { search: pick(args.search)! }),
          ...(pick(args.use_case) === undefined ? {} : { use_case: pick(args.use_case)! }),
          ...(pick(args.accent) === undefined ? {} : { accent: pick(args.accent)! }),
          ...(pick(args.gender) === undefined ? {} : { gender: pick(args.gender)! }),
          ...(pick(args.age) === undefined ? {} : { age: pick(args.age)! }),
          ...(pick(args.locale) === undefined ? {} : { locale: pick(args.locale)! }),
          ...(pick(args.category) === undefined ? {} : { category: pick(args.category)! }),
          ...(typeof args.sort === 'string' && ['most_used', 'random', 'oldest', 'newest'].includes(args.sort) ? { sort: args.sort } : {}),
          ...(args.featured === true ? { featured: true } : {}),
          ...(args.free_users_allowed === true ? { free_users_allowed: true } : {}),
          ...(args.descriptive === true ? { descriptive: true } : {}),
        }
        const result = await listVendorVoices(channel, {
          ...(typeof args.language === 'string' && args.language.trim() !== '' ? { language: args.language.trim() } : {}),
          ...(typeof args.keyword === 'string' && args.keyword.trim() !== '' ? { keyword: args.keyword.trim() } : {}),
          ...(source === undefined ? {} : { source }),
          ...(Object.keys(serverFilters).length === 0 ? {} : { serverFilters }),
          // 推荐用宽候选池（最高上限）；浏览保持默认窗口更快。
          ...(action === 'recommend' ? { limit: 500 } : {}),
        })
        if (action === 'recommend') {
          const requirement = typeof args.requirement === 'string' ? args.requirement.trim() : ''
          if (requirement === '') throw new AudioGenError('recommend requires requirement (a natural-language voice description).', 'recommend-requirement-required')
          const rawTopK = args.top_k
          const topK = typeof rawTopK === 'number' && Number.isFinite(rawTopK)
            ? Math.max(1, Math.min(10, Math.floor(rawTopK)))
            : 5
          if (config.recommend === undefined) throw new AudioGenError('Voice recommendation is unavailable (LLM service not wired).', 'recommend-unavailable')
          const recommendations = await config.recommend(requirement, result.voices, topK)
          return {
            status: 'ok' as const,
            kind: 'recommend' as const,
            vendor: result.vendor,
            channel: channel.name,
            requirement,
            candidate_count: result.voices.length,
            recommendations,
            ...(result.note === undefined ? {} : { note: result.note }),
          }
        }
        return {
          status: 'ok' as const,
          kind: 'list' as const,
          vendor: result.vendor,
          channel: channel.name,
          count: result.voices.length,
          ...(result.truncated ? { truncated: true } : {}),
          voices: result.voices,
          ...(result.note === undefined ? {} : { note: result.note }),
        }
      }
      const voiceId = typeof args.voice_id === 'string' ? args.voice_id.trim() : ''
      if (voiceId === '') throw new AudioGenError('delete requires voice_id (the exact voice_id from action=list).', 'voice-id-required')
      if (args.confirm !== true) throw new AudioGenError('Deletion is irreversible: pass confirm=true after verifying the voice_id.', 'voice-delete-requires-confirm')
      const deleted = await deleteVendorVoice(channel, voiceId)
      return {
        status: 'ok' as const,
        kind: 'delete' as const,
        vendor: deleted.vendor,
        channel: channel.name,
        voice_id: deleted.voice_id,
        deleted: true,
        message: `已删除音色 ${deleted.voice_id}（${channel.name}）`,
      }
    },
  }))

  return () => {
    disposer()
    searchDisposer()
    managementDisposer()
  }
}

/** 解析工具目标渠道：默认渠道 > 唯一可用渠道；多渠道未指定时要求显式选择。 */
function resolveVoiceManagementChannel(config: AgentAudioToolConfig, requested: unknown): AudioChannel {
  const usable = config.channels.filter(channel => channel.apiUrl.trim() !== '' && channel.apiKey.trim() !== '')
  if (usable.length === 0) {
    throw new AudioGenError('Audio API credentials are not configured. Open Settings > Plugins > AI Audio, add a channel and fill its API URL and API key.', 'audio-api-not-configured')
  }
  const wanted = typeof requested === 'string' ? requested.trim() : ''
  if (wanted === '') {
    if (usable.length === 1) return usable[0]!
    const target = usable.find(channel => channel.id === config.defaultChannelId)
    if (target !== undefined) return target
    const options = usable.map(channel => `"${channel.name}"`).join(', ')
    throw new AudioGenError(`Multiple audio channels are configured — specify the channel (one of: ${options}).`, 'channel-choice-required')
  }
  const direct = usable.find(channel => channel.name === wanted || channel.id === wanted)
  if (direct !== undefined) return direct
  const partial = usable.filter(channel => channel.name.toLowerCase().includes(wanted.toLowerCase()))
  if (partial.length === 1) return partial[0]!
  const options = usable.map(channel => channel.name).join(', ')
  throw new AudioGenError(`Audio channel "${wanted}" is not configured. Choose one of: ${options}.`, 'channel-not-configured')
}
