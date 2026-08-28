/**
 * Host-side model/voice discovery.
 *
 * Each vendor answers differently:
 *  - MiniMax exposes a voice-management API (/v1/get_voice) that returns all
 *    system and user-generated voice ids; the known MiniMax music models are
 *    appended so the settings card can offer a full categorized catalog.
 *  - ElevenLabs exposes /v1/models and /v1/voices; only models that can
 *    actually speak (text_to_speech capability) and account voices are kept.
 *  - Stability AI has no listing endpoint; the built-in stable-audio catalog
 *    is returned.
 *  - Generic OpenAI-compatible endpoints answer /models; the reply is filtered
 *    to audio-related model ids only (tts / music / sfx), never the whole
 *    model list of a gateway.
 */

import type { AudioChannel } from './audio-engine.ts'
import type { AudioModelCategory, DiscoveredAudioModel } from './protocol.ts'
import { audioPresetById } from './audio-presets.ts'

function isMiniMax(channel: AudioChannel): boolean {
  return channel.preset === 'minimax' || /minimax/i.test(channel.apiUrl)
}

function isElevenLabs(channel: AudioChannel): boolean {
  return channel.preset === 'elevenlabs' || /elevenlabs/i.test(channel.apiUrl)
}

function isStability(channel: AudioChannel): boolean {
  return channel.preset === 'stability' || /stability\.ai/i.test(channel.apiUrl)
}

function baseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/** Whether an upstream model id is audio-related at all. */
function categoryFor(id: string): AudioModelCategory | undefined {
  const value = id.toLowerCase()
  if (/(tts|speech|voice|t2a|talk|narration)/i.test(value)) return 'tts'
  if (/(music|song|cover|lyrics|audio|melody|beat)/i.test(value)) return 'music'
  if (/(sfx|sound.?effect|effect|foley)/i.test(value)) return 'sfx'
  return undefined
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init)
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}${text === '' ? '' : `: ${text.slice(0, 300)}`}`)
  }
  return response.json()
}

async function postJson(url: string, apiKey: string, body: unknown): Promise<unknown> {
  return fetchJson(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey.trim()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

/** Discover available models/voices for a channel. */
export async function discoverAudioModels(channel: AudioChannel): Promise<{ models: DiscoveredAudioModel[]; source: string }> {
  if (channel.apiUrl.trim() === '') throw new Error('API URL is not configured')
  if (channel.apiKey.trim() === '') throw new Error('API key is not configured')

  if (isMiniMax(channel)) return discoverMiniMax(channel)
  if (isElevenLabs(channel)) return discoverElevenLabs(channel)
  if (isStability(channel)) return discoverStability(channel)
  return discoverOpenAICompatible(channel)
}

// ---------------------------------------------------------------- MiniMax

async function discoverMiniMax(channel: AudioChannel): Promise<{ models: DiscoveredAudioModel[]; source: string }> {
  const base = baseUrl(channel.apiUrl).replace(/\/v1$/i, '')
  const url = `${base}/v1/get_voice`
  try {
    const payload = await postJson(url, channel.apiKey, { voice_type: 'all' }) as {
      system_voice?: Array<{ voice_id?: string; voice_name?: string; description?: string[] }>
      voice_cloning?: Array<{ voice_id?: string; description?: string[] }>
      voice_generation?: Array<{ voice_id?: string; description?: string[] }>
      base_resp?: { status_code?: number; status_msg?: string }
    }
    if (payload.base_resp?.status_code !== undefined && payload.base_resp.status_code !== 0) {
      throw new Error(payload.base_resp.status_msg ?? `MiniMax returned status ${payload.base_resp.status_code}`)
    }
    const models: DiscoveredAudioModel[] = []
    for (const voice of payload.system_voice ?? []) {
      const id = voice.voice_id?.trim() ?? ''
      if (id === '') continue
      models.push({
        alias: voice.voice_name?.trim() || id,
        id,
        category: 'tts',
        ...(voice.description !== undefined && voice.description.length > 0 ? { description: voice.description.join('；') } : {}),
      })
    }
    for (const voice of payload.voice_cloning ?? []) {
      const id = voice.voice_id?.trim() ?? ''
      if (id === '') continue
      models.push({
        alias: id,
        id,
        category: 'tts',
        ...(voice.description !== undefined && voice.description.length > 0 ? { description: voice.description.join('；') } : {}),
      })
    }
    for (const voice of payload.voice_generation ?? []) {
      const id = voice.voice_id?.trim() ?? ''
      if (id === '') continue
      models.push({
        alias: id,
        id,
        category: 'tts',
        ...(voice.description !== undefined && voice.description.length > 0 ? { description: voice.description.join('；') } : {}),
      })
    }
    // MiniMax music models are not returned by get_voice; append the static catalog.
    const music = (audioPresetById('minimax')?.models ?? []).filter(model => model.category === 'music')
    for (const model of music) models.push({ ...model, category: 'music' as const })
    const deduped = dedupe(models)
    return { models: deduped, source: 'MiniMax get_voice + music 目录' }
  } catch (error) {
    // Gateways may not route /v1/get_voice (or lack voice-management access).
    // Fall back to the built-in catalog so generation still works.
    const fallback = (audioPresetById('minimax')?.models ?? []).map(model => ({ ...model }))
    const message = error instanceof Error ? error.message : String(error)
    return {
      models: dedupe(fallback),
      source: `内置 MiniMax 目录（音色发现失败：${message.slice(0, 160)}）`,
    }
  }
}

// ------------------------------------------------------------- ElevenLabs

async function discoverElevenLabs(channel: AudioChannel): Promise<{ models: DiscoveredAudioModel[]; source: string }> {
  const base = baseUrl(channel.apiUrl)
  const headers = { 'xi-api-key': channel.apiKey.trim() }
  const failures: string[] = []
  const models: DiscoveredAudioModel[] = []

  // 1. TTS-capable models from /v1/models (audio-related only).
  try {
    const payload = await fetchJson(`${base}/models`, { headers }) as Array<{
      model_id?: string
      name?: string
      description?: string
      capabilities?: { text_to_speech?: boolean; voice_change?: boolean; speech_to_text?: boolean }
    }>
    for (const item of Array.isArray(payload) ? payload : []) {
      const id = item.model_id?.trim() ?? ''
      if (id === '') continue
      // Only what actually produces speech audio.
      if (item.capabilities?.text_to_speech !== true && item.capabilities?.voice_change !== true) continue
      models.push({
        alias: item.name?.trim() || id,
        id,
        category: 'tts',
        ...(item.description !== undefined && item.description.trim() !== '' ? { description: item.description.trim() } : {}),
      })
    }
  } catch (error) {
    failures.push(`模型列表：${error instanceof Error ? error.message : String(error)}`)
  }

  // 2. The account's voices from /v1/voices, grouped as tts entries.
  try {
    const payload = await fetchJson(`${base}/voices`, { headers }) as {
      voices?: Array<{ voice_id?: string; name?: string; description?: string }>
    }
    for (const voice of Array.isArray(payload?.voices) ? payload.voices : []) {
      const id = voice.voice_id?.trim() ?? ''
      if (id === '') continue
      models.push({
        alias: voice.name?.trim() || id,
        id,
        category: 'tts',
        ...(voice.description !== undefined && voice.description.trim() !== '' ? { description: voice.description.trim() } : {}),
      })
    }
  } catch (error) {
    failures.push(`音色列表：${error instanceof Error ? error.message : String(error)}`)
  }

  if (models.length === 0) {
    // Neither endpoint answered — fall back to the built-in catalog.
    const fallback = (audioPresetById('elevenlabs')?.models ?? []).map(model => ({ ...model }))
    const detail = failures.length === 0 ? '' : `（发现失败：${failures.join('；').slice(0, 160)}）`
    return { models: dedupe(fallback), source: `内置 ElevenLabs 目录${detail}` }
  }
  return { models: dedupe(models), source: 'ElevenLabs /models + /voices' }
}

// -------------------------------------------------------------- Stability

async function discoverStability(channel: AudioChannel): Promise<{ models: DiscoveredAudioModel[]; source: string }> {
  // Stability has no public audio model listing; serve the built-in catalog.
  const fallback = (audioPresetById('stability-audio')?.models ?? []).map(model => ({ ...model }))
  return { models: dedupe(fallback), source: 'Stability stable-audio 内置目录' }
}

// ------------------------------------------------------ OpenAI-compatible

async function discoverOpenAICompatible(channel: AudioChannel): Promise<{ models: DiscoveredAudioModel[]; source: string }> {
  const base = baseUrl(channel.apiUrl)
  const url = `${base}/models`
  const payload = await fetchJson(url, {
    headers: { authorization: `Bearer ${channel.apiKey.trim()}` },
  }) as { data?: Array<{ id?: string }> }
  const models: DiscoveredAudioModel[] = []
  for (const item of payload.data ?? []) {
    const id = item.id?.trim() ?? ''
    if (id === '') continue
    // Audio-related models only — never the whole gateway model list.
    const category = categoryFor(id)
    if (category === undefined) continue
    models.push({ alias: id, id, category })
  }
  return { models: dedupe(models), source: 'OpenAI-compatible /models（仅音频相关）' }
}

function dedupe(models: DiscoveredAudioModel[]): DiscoveredAudioModel[] {
  const seen = new Set<string>()
  const out: DiscoveredAudioModel[] = []
  for (const model of models) {
    if (seen.has(model.id)) continue
    seen.add(model.id)
    out.push(model)
  }
  return out
}
