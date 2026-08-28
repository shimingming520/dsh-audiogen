/**
 * Browser-side API client for the audio generation and history routes.
 */

import { GENERATE_API, HISTORY_API, type GenerateAudioRequest, type GeneratedAudio, type HistoryEntry } from '../protocol.ts'

export interface GenerateResponse {
  ok: boolean
  outputs?: GeneratedAudio[]
  history?: HistoryEntry[]
  historyError?: string
  code?: string
  message?: string
}

export class AudiogenApi {
  async generate(request: GenerateAudioRequest): Promise<GenerateResponse> {
    const response = await fetch(GENERATE_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    const body = await response.json() as GenerateResponse
    return body
  }

  async history(): Promise<HistoryEntry[]> {
    const response = await fetch(HISTORY_API.list, { method: 'POST' })
    const body = await response.json() as { ok?: boolean; history?: HistoryEntry[] }
    return body.ok === true ? (body.history ?? []) : []
  }

  async clearHistory(): Promise<void> {
    await fetch(HISTORY_API.clear, { method: 'POST' })
  }
}
