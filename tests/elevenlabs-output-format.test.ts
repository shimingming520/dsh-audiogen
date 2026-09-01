/**
 * elevenLabsOutputFormat 单元测试：把「格式/采样率/码率」三个面板参数组合为
 * ElevenLabs output_format（codec_sample_rate_bitrate），覆盖默认值回填、
 * 非法组合报错与 generateAudio 官方 SFX 请求体携带 output_format。
 * 运行：pnpm test（vitest）
 */
import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  elevenLabsOutputFormat,
  generateAudio,
  AudioGenError,
  type AudioChannel,
} from '../src/audio-engine.ts'

const byFormat = (format: string, sampleRate?: number, bitrate?: number) =>
  ({ format, sampleRate, bitrate })
const none = { format: '', sampleRate: undefined, bitrate: undefined }

test('三个参数都不给 → 不发送 output_format（undefined）', () => {
  assert.equal(elevenLabsOutputFormat(none), undefined)
  assert.equal(elevenLabsOutputFormat({}), undefined)
})

test('只给格式 mp3 → 默认 44100Hz/128kbps', () => {
  assert.equal(elevenLabsOutputFormat(byFormat('mp3')), 'mp3_44100_128')
})

test('mp3 + 22050 → 码率回填该采样率唯一值 32', () => {
  assert.equal(elevenLabsOutputFormat(byFormat('mp3', 22050)), 'mp3_22050_32')
  assert.equal(elevenLabsOutputFormat(byFormat('mp3', 24000)), 'mp3_24000_48')
})

test('mp3 + 44100 + 192 → mp3_44100_192（Creator 档）', () => {
  assert.equal(elevenLabsOutputFormat(byFormat('mp3', 44100, 192)), 'mp3_44100_192')
})

test('pcm 各采样率不带码率', () => {
  assert.equal(elevenLabsOutputFormat(byFormat('pcm', 8000)), 'pcm_8000')
  assert.equal(elevenLabsOutputFormat(byFormat('pcm', 16000)), 'pcm_16000')
  assert.equal(elevenLabsOutputFormat(byFormat('pcm', 44100)), 'pcm_44100')
})

test('ulaw/alaw 仅 8000；opus 仅 48000/32', () => {
  assert.equal(elevenLabsOutputFormat(byFormat('ulaw')), 'ulaw_8000')
  assert.equal(elevenLabsOutputFormat(byFormat('alaw', 8000)), 'alaw_8000')
  assert.equal(elevenLabsOutputFormat(byFormat('opus')), 'opus_48000_32')
  assert.equal(elevenLabsOutputFormat(byFormat('opus', 48000, 32)), 'opus_48000_32')
})

test('只给采样率/码率时默认 mp3 编码', () => {
  assert.equal(elevenLabsOutputFormat(byFormat('', 22050)), 'mp3_22050_32')
  assert.equal(elevenLabsOutputFormat(byFormat('', undefined, 192)), 'mp3_44100_192')
})

test('格式大小写不敏感；空白输入视为未给', () => {
  assert.equal(elevenLabsOutputFormat(byFormat('MP3', 44100, 96)), 'mp3_44100_96')
  assert.equal(elevenLabsOutputFormat(byFormat('  ')), undefined)
})

test('非法编码（wav/flac/ogg）→ 可操作的错误', () => {
  assert.throws(() => elevenLabsOutputFormat(byFormat('wav')), (error: unknown) => {
    assert.ok(error instanceof AudioGenError)
    assert.equal(error.code, 'audio-bad-format')
    assert.match(error.message, /不支持「wav」/)
    assert.match(error.message, /mp3\/pcm\/ulaw\/alaw\/opus/)
    return true
  })
})

test('非法采样率 → 报错并列出合法值', () => {
  assert.throws(() => elevenLabsOutputFormat(byFormat('mp3', 48000)), /仅支持 22050\/24000\/44100Hz/)
  assert.throws(() => elevenLabsOutputFormat(byFormat('pcm', 1000)), /仅支持 8000\/16000\/22050\/24000\/32000\/44100\/48000Hz/)
})

test('非法码率 → 报错；pcm 带码率报「该编码不带码率」', () => {
  assert.throws(() => elevenLabsOutputFormat(byFormat('mp3', 22050, 64)), /码率仅支持 32kbps/)
  assert.throws(() => elevenLabsOutputFormat(byFormat('opus', 48000, 64)), /码率仅支持 32kbps/)
  assert.throws(() => elevenLabsOutputFormat(byFormat('pcm', 16000, 128)), /该编码不带码率/)
})

test('generateAudio 官方 ElevenLabs SFX 请求体携带组合后的 output_format', async () => {
  const channel: AudioChannel = {
    id: 'eleven-1',
    preset: 'elevenlabs',
    name: 'ElevenLabs',
    apiUrl: 'https://api.elevenlabs.io/v1',
    apiKey: 'test-key',
    models: [],
  }
  const captured: Array<{ url: string; body: Record<string, unknown> }> = []
  ;(globalThis as { fetch: unknown }).fetch = async (url: string | URL, init?: RequestInit) => {
    captured.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> })
    return new Response(new Uint8Array([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg' },
    })
  }
  await generateAudio(channel, {
    mode: 'sfx',
    model: 'eleven_text_to_sound_v2',
    upstream: 'eleven_text_to_sound_v2',
    prompt: 'thunder rumble',
    format: 'mp3',
    sampleRate: 22050,
    bitrate: 32,
  })
  assert.equal(captured.length, 1)
  assert.ok(captured[0]!.url.includes('/sound-generation'))
  assert.equal(captured[0]!.body.output_format, 'mp3_22050_32')
  assert.equal(captured[0]!.body.model_id, 'eleven_text_to_sound_v2')
  assert.equal(captured[0]!.body.text, 'thunder rumble')
})

test('generateAudio 未给格式/采样率/码率时不发送 output_format', async () => {
  const channel: AudioChannel = {
    id: 'eleven-1',
    preset: 'elevenlabs',
    name: 'ElevenLabs',
    apiUrl: 'https://api.elevenlabs.io/v1',
    apiKey: 'test-key',
    models: [],
  }
  const captured: Array<{ body: Record<string, unknown> }> = []
  ;(globalThis as { fetch: unknown }).fetch = async (url: string | URL, init?: RequestInit) => {
    captured.push({ body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> })
    return new Response(new Uint8Array([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg' },
    })
  }
  await generateAudio(channel, { mode: 'sfx', model: 'eleven_text_to_sound_v2', upstream: 'eleven_text_to_sound_v2', prompt: 'rain' })
  assert.equal(captured[0]!.body.output_format, undefined)
})

test('generateAudio 非法组合直接把错误抛给调用方（不静默修改参数）', async () => {
  const channel: AudioChannel = {
    id: 'eleven-1',
    preset: 'elevenlabs',
    name: 'ElevenLabs',
    apiUrl: 'https://api.elevenlabs.io/v1',
    apiKey: 'test-key',
    models: [],
  }
  ;(globalThis as { fetch: unknown }).fetch = async () => {
    throw new Error('should not be reached')
  }
  await assert.rejects(
    generateAudio(channel, { mode: 'sfx', model: 'eleven_text_to_sound_v2', upstream: 'eleven_text_to_sound_v2', prompt: 'rain', format: 'wav' }),
    (error: unknown) => error instanceof AudioGenError && error.code === 'audio-bad-format',
  )
})
