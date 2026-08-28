/**
 * Built-in audio provider catalog (presets).
 * Framework-free pure data; served to the settings card through a host route.
 *
 * Only the officially supported audio vendors are offered here — MiniMax,
 * ElevenLabs and Stability AI. Any other endpoint (including OpenAI-compatible
 * TTS gateways) is added through the "自定义渠道" flow instead.
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
  /** Official vendor website, shown as a link in the channel editor. */
  site?: string
  /** Known model/voice catalog prefilled into the channel. */
  models: ModelMapping[]
}

export const AUDIO_PRESETS: AudioPresetProvider[] = [
  {
    id: 'minimax',
    name: 'MiniMax',
    apiUrl: 'https://api.minimaxi.com',
    site: 'https://www.minimaxi.com',
    hint: 'MiniMax 官方音频：音色设计 / TTS / 音乐生成；建议点击「获取可用模型」拉取账号音色与模型',
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
    id: 'elevenlabs',
    name: 'ElevenLabs',
    apiUrl: 'https://api.elevenlabs.io/v1',
    site: 'https://elevenlabsai.cn',
    hint: 'ElevenLabs 语音合成（TTS）与音乐生成（POST /v1/music，music_v2）；可点「获取可用模型」拉取音色与模型',
    models: [
      { alias: 'Rachel', id: '21m00Tcm4TlvDq8ikWAM', category: 'tts' },
      { alias: 'Adam', id: 'pNInz6obpgDQGcFmaJgB', category: 'tts' },
      { alias: 'Antoni', id: 'ErXwobaYiN019PkySvjV', category: 'tts' },
      { alias: 'Bella', id: 'EXAVITQu4vr4xnSDxMaL', category: 'tts' },
      { alias: 'eleven_multilingual_v2', id: 'eleven_multilingual_v2', category: 'tts' },
      { alias: 'eleven_turbo_v2_5', id: 'eleven_turbo_v2_5', category: 'tts' },
      { alias: 'eleven_flash_v2_5', id: 'eleven_flash_v2_5', category: 'tts' },
      // ElevenLabs Music（POST /v1/music）
      { alias: 'music_v2', id: 'music_v2', category: 'music' },
      { alias: 'music_v1', id: 'music_v1', category: 'music' },
    ],
  },
  {
    id: 'stability-audio',
    name: 'Stability AI（stable-audio）',
    apiUrl: 'https://api.stability.ai/v2beta/audio',
    site: 'https://stability.ai/stable-audio',
    hint: 'Stability AI 音乐 / 音效生成（stable-audio 系列）',
    models: [
      { alias: 'stable-audio-2.0', id: 'stable-audio-2.0', category: 'music' },
      { alias: 'stable-audio-1.0', id: 'stable-audio-1.0', category: 'music' },
    ],
  },
]

/** Look up one built-in provider by id. */
export function audioPresetById(id: string): AudioPresetProvider | undefined {
  return AUDIO_PRESETS.find(preset => preset.id === id)
}
