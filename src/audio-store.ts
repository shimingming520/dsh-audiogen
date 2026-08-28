/**
 * Host-side persistence for generated audio and generation history.
 * Files live under ~/.dsh/dsh-audiogen/audio/; history is one JSON document.
 * The resource library lives under ~/.dsh/dsh-audiogen/library/ with one
 * index JSON plus files organized by type (voice/music/sfx/tts) and category.
 */

import { mkdir, readFile, writeFile, unlink, rename, rmdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import type { HistoryEntry, HistoryEntryInput, LibraryEntry, LibraryType, LibraryFileRef, LibraryAudioInput, LibraryProvenance } from './protocol.ts'
import { HISTORY_MAX, LIBRARY_API, LIBRARY_NAME_MAX } from './protocol.ts'

function dshHome(): string {
  return process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
}

export const AUDIO_DATA_DIR = path.join(dshHome(), 'dsh-audiogen', 'audio')
const HISTORY_FILE = path.join(dshHome(), 'dsh-audiogen', 'history.json')
export const LIBRARY_DATA_DIR = path.join(dshHome(), 'dsh-audiogen', 'library')
const LIBRARY_INDEX_FILE = path.join(LIBRARY_DATA_DIR, 'index.json')

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
    ...(entry.voiceId === undefined ? {} : { voiceId: entry.voiceId }),
    ...(entry.speed === undefined ? {} : { speed: entry.speed }),
    ...(entry.duration === undefined ? {} : { duration: entry.duration }),
    ...(entry.format === undefined ? {} : { format: entry.format }),
    audio: entry.audio.map(audio => ({
      url: audio.url,
      mime: audio.mime,
      ...(audio.duration === undefined ? {} : { duration: audio.duration }),
      ...(audio.voiceId === undefined ? {} : { voiceId: audio.voiceId }),
    })),
    ...(entry.channelId === undefined ? {} : { channelId: entry.channelId }),
    ...(entry.channel === undefined ? {} : { channel: entry.channel }),
    ...(entry.params === undefined ? {} : { params: entry.params }),
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

// ---------------------------------------------------------------------------
// Resource library
// ---------------------------------------------------------------------------

/** Library type dir names (whitelisted on the audio route too). */
const LIBRARY_TYPE_DIRS: Record<LibraryType, string> = {
  voice: 'voice',
  music: 'music',
  sfx: 'sfx',
  tts: 'tts',
}

/** Sanitize one path segment (cid or voice key). Falls back to 'default'. */
export function sanitizeSegment(value: string): string {
  const cleaned = value
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 60)
  return cleaned === '' ? 'default' : cleaned
}

/** Infer the category for a save when the client did not provide one. */
export function defaultLibraryCategory(
  type: LibraryType,
  meta: { voice?: string; voiceId?: string },
): string | undefined {
  if (type === 'voice') {
    // Check female first: 'female' contains the substring 'male'.
    const probe = `${meta.voiceId ?? ''} ${meta.voice ?? ''}`.toLowerCase()
    if (/female|女/.test(probe)) return 'female'
    if (/male|男/.test(probe)) return 'male'
    return 'custom'
  }
  if (type === 'tts') return sanitizeSegment(meta.voice ?? meta.voiceId ?? 'default')
  return undefined
}

/** Default resource name from the prompt. */
export function defaultLibraryName(prompt: string): string {
  const flat = prompt.replace(/\s+/g, ' ').trim()
  return flat === '' ? '未命名音频' : (flat.length > LIBRARY_NAME_MAX ? `${flat.slice(0, LIBRARY_NAME_MAX)}…` : flat)
}

async function readLibraryIndex(): Promise<LibraryEntry[]> {
  try {
    const text = await readFile(LIBRARY_INDEX_FILE, 'utf8')
    const parsed = JSON.parse(text) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isLibraryEntry)
  } catch {
    return []
  }
}

function isLibraryEntry(value: unknown): value is LibraryEntry {
  if (value === null || typeof value !== 'object') return false
  const raw = value as Record<string, unknown>
  return typeof raw.id === 'string'
    && typeof raw.name === 'string'
    && (raw.type === 'voice' || raw.type === 'music' || raw.type === 'sfx' || raw.type === 'tts')
    && Array.isArray(raw.files)
    && typeof raw.createdAt === 'number'
    && typeof (raw as Record<string, unknown>).provenance === 'object'
}

async function writeLibraryIndex(entries: LibraryEntry[]): Promise<void> {
  await mkdir(LIBRARY_DATA_DIR, { recursive: true })
  await writeFile(LIBRARY_INDEX_FILE, JSON.stringify(entries, null, 2))
}

/** Same-origin URL for a library-relative file path. */
export function libraryUrlOf(rel: string): string {
  return `${LIBRARY_API.audio}/${rel.split('/').map(segment => encodeURIComponent(segment)).join('/')}`
}

/** Merge-library-entry: copy one audio/ file into library/<type>/<category>/. */
async function copyIntoLibrary(input: LibraryAudioInput, typeDir: string, category: string): Promise<LibraryFileRef> {
  const stored = await readAudioFile(input.file)
  if (stored === undefined) {
    throw new Error(`音频文件不存在：${input.file}（请重新生成后再入库）`)
  }
  const ext = path.extname(input.file).replace('.', '') || (stored.mime.split('/')[1]?.replace('mpeg', 'mp3') ?? 'bin')
  const rel = `${typeDir}/${category}/${input.id}.${ext}`
  const target = path.join(LIBRARY_DATA_DIR, ...rel.split('/'))
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, stored.data)
  return {
    url: libraryUrlOf(rel),
    rel,
    mime: stored.mime,
    bytes: stored.bytes,
    ...(input.duration === undefined ? {} : { duration: input.duration }),
    ...(input.voiceId === undefined ? {} : { voiceId: input.voiceId }),
  }
}

/**
 * Save one curated library entry: copies the referenced audio files into
 * library/<type>/<category>/ (audio/ files stay untouched) and appends the
 * entry to the index.
 */
export async function saveToLibrary(input: {
  audioFiles: LibraryAudioInput[]
  type: LibraryType
  category?: string
  name?: string
  tags?: string[]
  note?: string
  provenance: LibraryProvenance
}): Promise<LibraryEntry> {
  if (input.audioFiles.length === 0) throw new Error('没有可入库的音频文件')
  const typeDir = LIBRARY_TYPE_DIRS[input.type]
  const category = input.category !== undefined && input.category.trim() !== ''
    ? sanitizeSegment(input.category.trim())
    : defaultLibraryCategory(input.type, {
      voice: input.provenance.voice,
      voiceId: input.provenance.voiceId ?? input.audioFiles.find(file => file.voiceId !== undefined)?.voiceId,
    }) ?? 'default'
  const files = await Promise.all(input.audioFiles.map(file => copyIntoLibrary(file, typeDir, category)))
  const rawName = (input.name ?? '').trim()
  const entry: LibraryEntry = {
    id: randomUUID(),
    createdAt: Date.now(),
    type: input.type,
    category: category === 'default' && input.type !== 'voice' && input.type !== 'tts' ? undefined : category,
    name: rawName === '' ? defaultLibraryName(input.provenance.prompt) : rawName,
    tags: Array.isArray(input.tags) ? [...new Set(input.tags.map(tag => tag.trim()).filter(tag => tag !== ''))].slice(0, 20) : [],
    ...(input.note !== undefined && input.note.trim() !== '' ? { note: input.note.trim() } : {}),
    files,
    provenance: input.provenance,
  }
  const entries = await readLibraryIndex()
  entries.unshift(entry)
  await writeLibraryIndex(entries)
  return entry
}

/** Read library entries (newest first). */
export async function listLibrary(): Promise<LibraryEntry[]> {
  const entries = await readLibraryIndex()
  return [...entries].sort((a, b) => b.createdAt - a.createdAt)
}

/** Move one library-relative file to a new rel path (same volume rename, else copy). */
async function moveLibraryFile(fromRel: string, toRel: string): Promise<void> {
  const from = path.join(LIBRARY_DATA_DIR, ...fromRel.split('/'))
  const to = path.join(LIBRARY_DATA_DIR, ...toRel.split('/'))
  await mkdir(path.dirname(to), { recursive: true })
  try {
    await rename(from, to)
  } catch {
    const data = await readFile(from)
    await writeFile(to, data)
    await unlink(from)
  }
}

/** Patch name/tags/note/type/category; moving type/category relocates files. */
export async function updateLibraryEntry(id: string, patch: {
  name?: string
  tags?: string[]
  note?: string
  category?: string
  type?: LibraryType
}): Promise<LibraryEntry | undefined> {
  const entries = await readLibraryIndex()
  const index = entries.findIndex(entry => entry.id === id)
  if (index < 0) return undefined
  const entry = { ...entries[index]!, files: [...entries[index]!.files] }
  if (patch.type !== undefined && LIBRARY_TYPES_VALID.includes(patch.type)) entry.type = patch.type
  if (patch.name !== undefined) entry.name = patch.name.trim() === '' ? defaultLibraryName(entry.provenance.prompt) : patch.name.trim()
  if (patch.tags !== undefined) entry.tags = [...new Set(patch.tags.map(tag => tag.trim()).filter(tag => tag !== ''))].slice(0, 20)
  if (patch.note !== undefined) entry.note = patch.note.trim() === '' ? undefined : patch.note.trim()
  if (patch.category !== undefined && patch.category.trim() !== '') {
    const next = sanitizeSegment(patch.category.trim())
    if (entry.type === 'voice' || entry.type === 'tts') entry.category = next
  }
  const oldCat = entries[index]!.category ?? 'default'
  const newCat = entry.category ?? 'default'
  if (entries[index]!.type !== entry.type || oldCat !== newCat) {
    const moved: LibraryFileRef[] = []
    for (const file of entry.files) {
      const fileName = file.rel.split('/').pop() ?? ''
      const fromRel = `${LIBRARY_TYPE_DIRS[entries[index]!.type]}/${oldCat}/${fileName}`
      const toRel = `${LIBRARY_TYPE_DIRS[entry.type]}/${newCat}/${fileName}`
      if (fromRel !== toRel) await moveLibraryFile(fromRel, toRel)
      moved.push({ ...file, rel: toRel, url: libraryUrlOf(toRel) })
    }
    entry.files = moved
  }
  entries[index] = entry
  await writeLibraryIndex(entries)
  return entry
}

/** Remove entries and their audio files; best-effort prune empty dirs. */
export async function removeLibraryEntries(ids: string[]): Promise<LibraryEntry[]> {
  const entries = await readLibraryIndex()
  const doomed = new Set(ids)
  const kept = entries.filter(entry => !doomed.has(entry.id))
  for (const entry of entries) {
    if (!doomed.has(entry.id)) continue
    for (const file of entry.files) {
      try {
        await unlink(path.join(LIBRARY_DATA_DIR, ...file.rel.split('/')))
      } catch {
        // best-effort
      }
    }
  }
  // prune now-empty leaf dirs (best effort, one level under type dirs)
  for (const entry of entries) {
    if (!doomed.has(entry.id)) continue
    try {
      await rmdir(path.dirname(path.join(LIBRARY_DATA_DIR, ...entry.files[0]!.rel.split('/'))), { recursive: false })
    } catch {
      // dir not empty or already gone
    }
  }
  await writeLibraryIndex(kept)
  return kept
}

/** Read one library file by its rel path (whitelisted, traversal-safe). */
export async function readLibraryFile(rel: string): Promise<{ data: Buffer; mime: string; bytes: number } | undefined> {
  const segments = rel.split('/').filter(segment => segment !== '')
  if (segments.length < 2 || segments.length > 3) return undefined
  const [typeDir, category, fileName] = segments
  if (typeDir === undefined || !Object.values(LIBRARY_TYPE_DIRS).includes(typeDir)) return undefined
  if (category === undefined || sanitizeSegment(category) !== category || category.length > 60) return undefined
  if (fileName === undefined || !/^[0-9a-f-]{36}\.[a-z0-9]{2,5}$/i.test(fileName)) return undefined
  const full = path.join(LIBRARY_DATA_DIR, typeDir, category, fileName)
  if (!full.startsWith(path.join(LIBRARY_DATA_DIR, typeDir, category) + path.sep)) return undefined
  try {
    const data = await readFile(full)
    return { data, mime: mimeFromFile(fileName), bytes: data.byteLength }
  } catch {
    return undefined
  }
}

const LIBRARY_TYPES_VALID = ['voice', 'music', 'sfx', 'tts'] as const
