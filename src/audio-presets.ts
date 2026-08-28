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
      { alias: 'tts-1', id: 'tts-1', category: 'tts' },
      { alias: 'tts-1-hd', id: 'tts-1-hd', category: 'tts' },
      { alias: 'gpt-4o-mini-tts', id: 'gpt-4o-mini-tts', category: 'tts' },
    ],
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    apiUrl: 'https://api.elevenlabs.io/v1',
    hint: 'ElevenLabs TTS；模型列表请填写你的 Voice ID（如 Rachel / Adam 等别名）',
    models: [
      { alias: 'Rachel', id: '21m00Tcm4TlvDq8ikWAM', category: 'tts' },
      { alias: 'Adam', id: 'pNInz6obpgDQGcFmaJgB', category: 'tts' },
      { alias: 'Antoni', id: 'ErXwobaYiN019PkySvjV', category: 'tts' },
      { alias: 'Bella', id: 'EXAVITQu4vr4xnSDxMaL', category: 'tts' },
    ],
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    apiUrl: 'https://api.minimaxi.com',
    hint: 'MiniMax 音色设计 / TTS / 音乐生成；可使用“获取可用模型”拉取账号音色',
    models: [
      // TTS models
      { alias: 'speech-2.8-hd', id: 'speech-2.8-hd', category: 'tts' },
      { alias: 'speech-2.8-turbo', id: 'speech-2.8-turbo', category: 'tts' },
      { alias: 'speech-2.6-hd', id: 'speech-2.6-hd', category: 'tts' },
      { alias: 'speech-2.6-turbo', id: 'speech-2.6-turbo', category: 'tts' },
      { alias: 'speech-02-hd', id: 'speech-02-hd', category: 'tts' },
      { alias: 'speech-02-turbo', id: 'speech-02-turbo', category: 'tts' },
      { alias: 'speech-01-hd', id: 'speech-01-hd', category: 'tts' },
      { alias: 'speech-01-turbo', id: 'speech-01-turbo', category: 'tts' },
      // Music models
      { alias: 'music-3.0', id: 'music-3.0', category: 'music' },
      { alias: 'music-2.6', id: 'music-2.6', category: 'music' },
      { alias: 'music-cover', id: 'music-cover', category: 'music' },
    ],
  },
  {
    id: 'stability-audio',
    name: 'Stability AI · 音频',
    apiUrl: 'https://api.stability.ai/v2beta/audio',
    hint: 'Stability AI 音乐/音效生成（stable-audio 系列）',
    models: [
      { alias: 'stable-audio-2.0', id: 'stable-audio-2.0', category: 'music' },
      { alias: 'stable-audio-1.0', id: 'stable-audio-1.0', category: 'music' },
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
