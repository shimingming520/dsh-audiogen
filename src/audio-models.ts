/**
 * Host-side model/voice discovery.
 *
 * MiniMax exposes a voice-management API that returns all available system and
 * user-generated voice ids; we combine those with the known MiniMax music
 * models so the settings card can offer a full categorized catalog.
 */

import type { AudioChannel } from './audio-engine.ts'
import type { AudioModelCategory, DiscoveredAudioModel } from './protocol.ts'
import { audioPresetById } from './audio-presets.ts'

function isMiniMax(channel: AudioChannel): boolean {
  return channel.preset === 'minimax' || /minimax/i.test(channel.apiUrl)
}

function baseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function categoryFor(id: string): AudioModelCategory | undefined {
  const value = id.toLowerCase()
  if (/(tts|speech|voice|t2a)/i.test(value)) return 'tts'
  if (/(music|song|cover|lyrics)/i.test(value)) return 'music'
  if (/(sfx|sound.?effect|effect|foley)/i.test(value)) return 'sfx'
  return undefined
}

async function postJson(url: string, apiKey: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey.trim()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}${text === '' ? '' : `: ${text.slice(0, 300)}`}`)
  }
  return response.json()
}

/** Discover available models/voices for a channel. */
export async function discoverAudioModels(channel: AudioChannel): Promise<{ models: DiscoveredAudioModel[]; source: string }> {
  if (channel.apiUrl.trim() === '') throw new Error('API URL is not configured')
  if (channel.apiKey.trim() === '') throw new Error('API key is not configured')

  if (isMiniMax(channel)) {
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
      return { models: deduped, source: 'MiniMax get_voice + built-in music catalog' }
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

  // Best-effort OpenAI-compatible /models discovery.
  const base = baseUrl(channel.apiUrl)
  const url = `${base}/models`
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${channel.apiKey.trim()}` },
  })
  if (!response.ok) {
    throw new Error(`model list request failed (HTTP ${response.status}); please add models manually`)
  }
  const payload = await response.json() as { data?: Array<{ id?: string }> }
  const models: DiscoveredAudioModel[] = []
  for (const item of payload.data ?? []) {
    const id = item.id?.trim() ?? ''
    if (id === '') continue
    const category = categoryFor(id) ?? 'tts'
    models.push({ alias: id, id, category })
  }
  return { models: dedupe(models), source: 'OpenAI-compatible /models' }
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
