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
  return () => {
    disposer()
    searchDisposer()
  }
}
