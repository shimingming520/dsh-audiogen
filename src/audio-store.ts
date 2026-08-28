/**
 * Host-side persistence for generated audio and generation history.
 * Files live under ~/.dsh/dsh-audiogen/audio/; history is one JSON document.
 */

import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import type { HistoryEntry, HistoryEntryInput } from './protocol.ts'
import { HISTORY_MAX } from './protocol.ts'

function dshHome(): string {
  return process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
}

export const AUDIO_DATA_DIR = path.join(dshHome(), 'dsh-audiogen', 'audio')
const HISTORY_FILE = path.join(dshHome(), 'dsh-audiogen', 'history.json')

async function ensureDir(): Promise<void> {
  await mkdir(AUDIO_DATA_DIR, { recursive: true })
}

function safeName(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, '_')
}

/** Persist one generated audio file. Returns its metadata and public id. */
export async function saveAudioFile(data: Uint8Array, mime: string, name?: string): Promise<{
  id: string
  file: string
  mime: string
  bytes: number
  name?: string
}> {
  await ensureDir()
  const id = randomUUID()
  const extension = mime.split('/')[1]?.replace('mpeg', 'mp3') ?? 'bin'
  const file = `${id}.${extension}`
  await writeFile(path.join(AUDIO_DATA_DIR, file), data)
  return {
    id,
    file,
    mime,
    bytes: data.byteLength,
    ...(name === undefined ? {} : { name }),
  }
}

/** Read a persisted audio file by its id/file name. */
export async function readAudioFile(file: string): Promise<{ data: Buffer; mime: string; bytes: number } | undefined> {
  const safe = safeName(file)
  const full = path.join(AUDIO_DATA_DIR, safe)
  if (!full.startsWith(AUDIO_DATA_DIR)) return undefined
  try {
    const data = await readFile(full)
    return { data, mime: mimeFromFile(safe), bytes: data.byteLength }
  } catch {
    return undefined
  }
}

function mimeFromFile(file: string): string {
  const ext = path.extname(file).toLowerCase()
  switch (ext) {
    case '.wav': return 'audio/wav'
    case '.mp3': return 'audio/mpeg'
    case '.flac': return 'audio/flac'
    case '.ogg': return 'audio/ogg'
    case '.m4a': return 'audio/mp4'
    case '.aac': return 'audio/aac'
    case '.aiff': return 'audio/aiff'
    default: return 'application/octet-stream'
  }
}

async function readHistory(): Promise<HistoryEntry[]> {
  try {
    const text = await readFile(HISTORY_FILE, 'utf8')
    const parsed = JSON.parse(text) as unknown
    return Array.isArray(parsed) ? parsed as HistoryEntry[] : []
  } catch {
    return []
  }
}

async function writeHistory(entries: HistoryEntry[]): Promise<void> {
  await mkdir(path.dirname(HISTORY_FILE), { recursive: true })
  await writeFile(HISTORY_FILE, JSON.stringify(entries, null, 2))
}

/** Append one history entry and enforce the cap. */
export async function appendHistory(entry: HistoryEntryInput): Promise<HistoryEntry[]> {
  const list = await readHistory()
  const next: HistoryEntry[] = [{
    id: entry.id,
    createdAt: entry.createdAt,
    mode: entry.mode,
    model: entry.model,
    prompt: entry.prompt,
    ...(entry.voice === undefined ? {} : { voice: entry.voice }),
    ...(entry.speed === undefined ? {} : { speed: entry.speed }),
    ...(entry.duration === undefined ? {} : { duration: entry.duration }),
    ...(entry.format === undefined ? {} : { format: entry.format }),
    audio: entry.audio.map(audio => ({
      url: audio.url,
      mime: audio.mime,
      ...(audio.duration === undefined ? {} : { duration: audio.duration }),
    })),
    ...(entry.channelId === undefined ? {} : { channelId: entry.channelId }),
    ...(entry.channel === undefined ? {} : { channel: entry.channel }),
  }, ...list].slice(0, HISTORY_MAX)
  await writeHistory(next)
  return next
}

export async function listHistory(): Promise<HistoryEntry[]> {
  return readHistory()
}

export async function removeHistory(id: string): Promise<HistoryEntry[]> {
  const list = await readHistory()
  const next = list.filter(entry => entry.id !== id)
  await writeHistory(next)
  return next
}

export async function clearHistory(): Promise<HistoryEntry[]> {
  await writeHistory([])
  return []
}
