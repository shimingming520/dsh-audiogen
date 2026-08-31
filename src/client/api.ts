/**
 * Browser-side API client for the audio generation, history and
 * resource-library routes.
 */

import {
  ENHANCE_API, GENERATE_API, HISTORY_API, LIBRARY_API, TASK_API,
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
  /** 引擎兜底提示（如：未提供歌词时按纯音乐生成）。 */
  note?: string
  code?: string
  message?: string
}

/** POST helper: the host API requires the JSON content type on every POST. */
function postJson(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...(signal === undefined ? {} : { signal }),
  })
}

export class AudiogenApi {
  async generate(request: GenerateAudioRequest, signal?: AbortSignal): Promise<GenerateResponse> {
    const response = await postJson(GENERATE_API, { ...request, taskId: request.taskId }, signal)
    const body = await response.json() as GenerateResponse
    return body
  }

  /** 取消进行中的任务：宿主侧中断全部在途上游调用，剩余模型跳过。 */
  async cancelTask(taskId: string): Promise<void> {
    await postJson(TASK_API.cancel, { taskId }).catch(() => { /* best-effort */ })
  }

  /** 提示词增强（复用 Agent 默认模型）。 */
  async enhancePrompt(prompt: string, mode: string): Promise<{ ok: boolean; enhanced?: string; code?: string; message?: string }> {
    const response = await postJson(ENHANCE_API, { prompt, mode })
    const body = await response.json() as { ok?: boolean; enhanced?: string; code?: string; message?: string }
    return { ok: body.ok === true, ...(body.enhanced === undefined ? {} : { enhanced: body.enhanced }), ...(body.code === undefined ? {} : { code: body.code }), ...(body.message === undefined ? {} : { message: body.message }) }
  }

  async history(): Promise<HistoryEntry[]> {
    const response = await postJson(HISTORY_API.list, {})
    const body = await response.json() as { ok?: boolean; history?: HistoryEntry[] }
    return body.ok === true ? (body.history ?? []) : []
  }

  /** 删除一条历史记录（返回删后的列表）。 */
  async removeHistory(id: string): Promise<HistoryEntry[]> {
    const response = await postJson(HISTORY_API.remove, { id })
    const body = await response.json() as { ok?: boolean; history?: HistoryEntry[] }
    return body.ok === true ? (body.history ?? []) : []
  }

  async clearHistory(): Promise<void> {
    await postJson(HISTORY_API.clear, {})
  }

  async libraryList(): Promise<LibraryEntry[]> {
    const response = await postJson(LIBRARY_API.list, {})
    const body = await response.json() as { ok?: boolean; entries?: LibraryEntry[] }
    return body.ok === true ? (body.entries ?? []) : []
  }

  async librarySave(request: LibrarySaveRequest): Promise<{ ok: boolean; entry?: LibraryEntry; message?: string }> {
    const response = await postJson(LIBRARY_API.save, request)
    const body = await response.json() as { ok?: boolean; entry?: LibraryEntry; message?: string }
    return { ok: body.ok === true, ...(body.entry === undefined ? {} : { entry: body.entry }), ...(body.message === undefined ? {} : { message: body.message }) }
  }

  async libraryUpdate(request: LibraryUpdateRequest): Promise<{ ok: boolean; entry?: LibraryEntry; message?: string }> {
    const response = await postJson(LIBRARY_API.update, request)
    const body = await response.json() as { ok?: boolean; entry?: LibraryEntry; message?: string }
    return { ok: body.ok === true, ...(body.entry === undefined ? {} : { entry: body.entry }), ...(body.message === undefined ? {} : { message: body.message }) }
  }

  async libraryRemove(ids: string[]): Promise<{ ok: boolean }> {
    const response = await postJson(LIBRARY_API.remove, { ids })
    const body = await response.json() as { ok?: boolean }
    return { ok: body.ok === true }
  }
}
