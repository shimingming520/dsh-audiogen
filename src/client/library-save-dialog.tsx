/**
 * «保存到资源库» dialog: pick type/category, set name/tags/note, then save.
 * Built from either freshly generated audio or a history entry.
 */

import { useMemo, useState } from 'react'
import type { AudiogenApi } from './api.ts'
import type { AudioMode, GeneratedAudio, LibraryEntry, LibraryType } from '../protocol.ts'
import css from './audio-panel.module.css'

export interface SaveDialogContext {
  mode: AudioMode
  prompt: string
  voice?: string
  voiceId?: string
  model?: string
  channel?: string
  channelId?: string
  params?: Record<string, unknown>
}

export function typeOfMode(mode: AudioMode): LibraryType {
  if (mode === 'voice_design') return 'voice'
  return mode
}

export const LIBRARY_TYPE_LABELS: Record<LibraryType, string> = {
  voice: '音色',
  music: '音乐',
  sfx: '音效',
  tts: 'TTS 语音',
}

function parseTags(text: string): string[] {
  return [...new Set(text.split(/[,，、\n]/).map(tag => tag.trim()).filter(tag => tag !== ''))].slice(0, 20)
}

function guessCategory(type: LibraryType, context: SaveDialogContext): string {
  if (type === 'voice') {
    const probe = `${context.voiceId ?? ''} ${context.voice ?? ''}`.toLowerCase()
    if (/male|男/.test(probe)) return 'male'
    if (/female|女/.test(probe)) return 'female'
    return 'custom'
  }
  if (type === 'tts') return (context.voice ?? context.voiceId ?? 'default').replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]+/g, '_')
  return ''
}

export function LibrarySaveDialog(props: {
  api: AudiogenApi
  files: GeneratedAudio[]
  context: SaveDialogContext
  onClose: () => void
  onSaved: (entry: LibraryEntry) => void
}): React.JSX.Element {
  const { api, files, context } = props
  const [type, setType] = useState<LibraryType>(typeOfMode(context.mode))
  const [category, setCategory] = useState(() => guessCategory(typeOfMode(context.mode), context))
  const [name, setName] = useState('')
  const [tags, setTags] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isVoice = type === 'voice'
  const isTts = type === 'tts'

  const defaultName = useMemo(() => {
    const flat = context.prompt.replace(/\s+/g, ' ').trim()
    return flat === '' ? '未命名音频' : (flat.length > 40 ? `${flat.slice(0, 40)}…` : flat)
  }, [context.prompt])

  const switchType = (next: LibraryType): void => {
    setType(next)
    setCategory(guessCategory(next, context))
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const result = await api.librarySave({
        audioFiles: files.map(file => ({
          id: file.id,
          file: file.file,
          mime: file.mime,
          ...(file.voiceId === undefined ? {} : { voiceId: file.voiceId }),
          ...(file.duration === undefined ? {} : { duration: file.duration }),
        })),
        type,
        ...(category.trim() !== '' && (isVoice || isTts) ? { category: category.trim() } : {}),
        ...(name.trim() !== '' ? { name: name.trim() } : {}),
        ...(parseTags(tags).length > 0 ? { tags: parseTags(tags) } : {}),
        ...(note.trim() !== '' ? { note: note.trim() } : {}),
        provenance: {
          mode: context.mode,
          prompt: context.prompt,
          ...(context.channel === undefined ? {} : { channel: context.channel }),
          ...(context.channelId === undefined ? {} : { channelId: context.channelId }),
          ...(context.model === undefined ? {} : { model: context.model }),
          ...(context.voice === undefined ? {} : { voice: context.voice }),
          ...(context.voiceId === undefined ? {} : { voiceId: context.voiceId }),
          ...(context.params === undefined ? {} : { params: context.params }),
        },
      })
      if (!result.ok || result.entry === undefined) {
        setError(result.message ?? '保存失败')
        return
      }
      props.onSaved(result.entry)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={css.modalMask}>
      <div className={css.modal} role="dialog" aria-modal="true" aria-label="保存到资源库">
        <div className={css.modalHead}>
          <strong>{files.length > 1 ? `保存 ${files.length} 段音频到资源库` : '保存到资源库'}</strong>
          <button type="button" className={css.iconButton} aria-label="关闭" onClick={props.onClose}>×</button>
        </div>
        <div className={css.modalBody}>
          <div className={css.formRow}>
            <label className={css.label}>
              <span>资源类型</span>
              <select className={css.input} value={type} onChange={event => switchType(event.target.value as LibraryType)}>
                {(['voice', 'music', 'sfx', 'tts'] as LibraryType[]).map(item => (
                  <option key={item} value={item}>{LIBRARY_TYPE_LABELS[item]}</option>
                ))}
              </select>
            </label>
            {isVoice || isTts ? (
              <label className={css.label}>
                <span>{isVoice ? '音色分级（男 / 女）' : '按音色归档（voice 键）'}</span>
                {isVoice ? (
                  <select className={css.input} value={category} onChange={event => setCategory(event.target.value)}>
                    <option value="male">男声 male</option>
                    <option value="female">女声 female</option>
                    <option value="custom">未分级 custom</option>
                  </select>
                ) : (
                  <input className={css.input} value={category} onChange={event => setCategory(event.target.value)} placeholder={context.voice ?? 'default'} />
                )}
              </label>
            ) : null}
          </div>
          <label className={css.label}>
            <span>名称（留空则使用提示词）</span>
            <input className={css.input} value={name} onChange={event => setName(event.target.value)} placeholder={defaultName} />
          </label>
          <label className={css.label}>
            <span>标签（逗号分隔，可多个）</span>
            <input className={css.input} value={tags} onChange={event => setTags(event.target.value)} placeholder={'温暖, 男声, 复古…'} />
          </label>
          <label className={css.label}>
            <span>备注（可选）</span>
            <textarea className={css.textarea} rows={2} value={note} onChange={event => setNote(event.target.value)} placeholder="用途、风格备注…" />
          </label>
          {error !== null ? <p className={css.error}>{error}</p> : null}
        </div>
        <div className={css.modalFoot}>
          <button type="button" className={css.secondaryButton} onClick={props.onClose}>取消</button>
          <button type="button" className={css.primaryButton} disabled={saving || files.length === 0} onClick={() => void save()}>
            {saving ? '保存中…' : '保存到资源库'}
          </button>
        </div>
      </div>
    </div>
  )
}
