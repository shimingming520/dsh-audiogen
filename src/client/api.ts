/**
 * Browser-side API client for the audio generation, history and
 * resource-library routes.
 */

import {
  GENERATE_API, HISTORY_API, LIBRARY_API,
  type GenerateAudioRequest, type GeneratedAudio, type HistoryEntry,
  type LibraryEntry, type LibrarySaveRequest, type LibraryUpdateRequest,
} from '../protocol.ts'

export interface GenerateResponse {
  ok: boolean
  outputs?: GeneratedAudio[]
  history?: HistoryEntry[]
  historyError?: string
  /** Resource-library entries created by the generation (auto-save). */
  resources?: Array<{ id: string; name: string; type: string }>
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

  async libraryList(): Promise<LibraryEntry[]> {
    const response = await fetch(LIBRARY_API.list, { method: 'POST' })
    const body = await response.json() as { ok?: boolean; entries?: LibraryEntry[] }
    return body.ok === true ? (body.entries ?? []) : []
  }

  async librarySave(request: LibrarySaveRequest): Promise<{ ok: boolean; entry?: LibraryEntry; message?: string }> {
    const response = await fetch(LIBRARY_API.save, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    const body = await response.json() as { ok?: boolean; entry?: LibraryEntry; message?: string }
    return { ok: body.ok === true, ...(body.entry === undefined ? {} : { entry: body.entry }), ...(body.message === undefined ? {} : { message: body.message }) }
  }

  async libraryUpdate(request: LibraryUpdateRequest): Promise<{ ok: boolean; entry?: LibraryEntry; message?: string }> {
    const response = await fetch(LIBRARY_API.update, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    const body = await response.json() as { ok?: boolean; entry?: LibraryEntry; message?: string }
    return { ok: body.ok === true, ...(body.entry === undefined ? {} : { entry: body.entry }), ...(body.message === undefined ? {} : { message: body.message }) }
  }

  async libraryRemove(ids: string[]): Promise<{ ok: boolean }> {
    const response = await fetch(LIBRARY_API.remove, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids }),
    })
    const body = await response.json() as { ok?: boolean }
    return { ok: body.ok === true }
  }
}
