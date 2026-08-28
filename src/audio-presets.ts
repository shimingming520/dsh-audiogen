/**
 * Built-in audio provider catalog (presets).
 * Framework-free pure data; served to the settings card through a host route.
 */

import type { ModelMapping } from './protocol.ts'

/** One built-in provider the settings card can instantiate a channel from. */
export interface AudioPresetProvider {
  /** Stable preset id stored on channels created from it ('' = custom). */
  id: string
  /** Display name shown in the picker (also the channel's default name). */
  name: string
  /** Official base URL prefilled into the channel. */
  apiUrl: string
  /** One-line description shown in the picker. */
  hint: string
  /** Known model/voice catalog prefilled into the channel. */
  models: ModelMapping[]
}

export const AUDIO_PRESETS: AudioPresetProvider[] = [
  {
    id: 'openai-tts',
    name: 'OpenAI · TTS',
    apiUrl: 'https://api.openai.com/v1',
    hint: 'OpenAI 官方语音合成接口（/audio/speech）',
    models: [
      { alias: 'tts-1', id: 'tts-1' },
      { alias: 'tts-1-hd', id: 'tts-1-hd' },
      { alias: 'gpt-4o-mini-tts', id: 'gpt-4o-mini-tts' },
    ],
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    apiUrl: 'https://api.elevenlabs.io/v1',
    hint: 'ElevenLabs TTS；模型列表请填写你的 Voice ID（如 Rachel / Adam 等别名）',
    models: [
      { alias: 'Rachel', id: '21m00Tcm4TlvDq8ikWAM' },
      { alias: 'Adam', id: 'pNInz6obpgDQGcFmaJgB' },
      { alias: 'Antoni', id: 'ErXwobaYiN019PkySvjV' },
      { alias: 'Bella', id: 'EXAVITQu4vr4xnSDxMaL' },
    ],
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    apiUrl: 'https://api.minimax.chat/v1',
    hint: 'MiniMax 语音合成（T2A）；需在 API URL 后按官方要求携带 GroupId 或使用完整接口地址',
    models: [
      { alias: 'speech-01-turbo', id: 'speech-01-turbo' },
      { alias: 'speech-01-hd', id: 'speech-01-hd' },
      { alias: 'speech-02-turbo', id: 'speech-02-turbo' },
      { alias: 'speech-02-hd', id: 'speech-02-hd' },
    ],
  },
  {
    id: 'stability-audio',
    name: 'Stability AI · 音频',
    apiUrl: 'https://api.stability.ai/v2beta/audio',
    hint: 'Stability AI 音乐/音效生成（stable-audio 系列）',
    models: [
      { alias: 'stable-audio-2.0', id: 'stable-audio-2.0' },
      { alias: 'stable-audio-1.0', id: 'stable-audio-1.0' },
    ],
  },
  {
    id: 'custom',
    name: '自定义渠道',
    apiUrl: '',
    hint: '任意兼容接口；支持 OpenAI 兼容 TTS，或返回音频字节 / JSON 的通用 POST',
    models: [],
  },
]

/** Look up one built-in provider by id. */
export function audioPresetById(id: string): AudioPresetProvider | undefined {
  return AUDIO_PRESETS.find(preset => preset.id === id)
}
