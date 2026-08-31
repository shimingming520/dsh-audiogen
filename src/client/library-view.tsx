/**
 * Library view: curated audio assets, organized by type (voice / music / sfx /
 * tts) with categories (voice: male/female/custom; tts: the speaking voice).
 * Search + chips + card grid + detail drawer (full provenance) + batch mode.
 */

import { useEffect, useMemo, useState } from 'react'
import type { AudiogenApi } from './api.ts'
import type { AudioMode, LibraryEntry, LibraryType } from '../protocol.ts'
import { AudioPlayer } from './audio-player.tsx'
import { LIBRARY_TYPE_LABELS } from './library-save-dialog.tsx'
import { CheckIcon, CopyIcon, ListIcon, MicIcon, MusicNoteIcon, SearchIcon, TrashIcon, WaveIcon } from './icons.tsx'
import css from './library.module.css'

const TYPE_ORDER: LibraryType[] = ['voice', 'music', 'sfx', 'tts']
const VOICE_CATEGORIES = ['male', 'female', 'custom']

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`
  const date = new Date(ts)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function typeIcon(type: LibraryType): React.JSX.Element {
  if (type === 'voice') return <MicIcon />
  if (type === 'music') return <MusicNoteIcon />
  if (type === 'sfx') return <WaveIcon />
  return <ListIcon />
}

export interface LibraryReusePayload {
  mode: AudioMode
  voice?: string
  voiceId?: string
  model?: string
}

interface DraftState {
  name: string
  tags: string
  note: string
  type: LibraryType
  category: string
}

export function LibraryView(props: {
  api: AudiogenApi
  revision: number
  showToast: (text: string) => void
  onReuseVoice: (payload: LibraryReusePayload) => void
}): React.JSX.Element {
  const { api, revision } = props
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | LibraryType>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [batchMode, setBatchMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const load = (): void => {
    setLoading(true)
    setError(null)
    api.libraryList()
      .then(setEntries)
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [revision])
  useEffect(() => { setCategoryFilter('all') }, [typeFilter])

  const categoriesOf = useMemo(() => {
    const map = new Map<LibraryType, string[]>()
    for (const entry of entries) {
      if (entry.category === undefined || entry.category === '') continue
      const list = map.get(entry.type) ?? []
      if (!list.includes(entry.category)) list.push(entry.category)
      map.set(entry.type, list)
    }
    return map
  }, [entries])

  const tags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const entry of entries) {
      for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)
  }, [entries])

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase()
    return entries.filter(entry => {
      if (typeFilter !== 'all' && entry.type !== typeFilter) return false
      if (categoryFilter !== 'all' && (entry.category ?? '') !== categoryFilter) return false
      if (tagFilter !== null && !entry.tags.includes(tagFilter)) return false
      if (needle !== '') {
        const haystack = [entry.name, ...entry.tags, entry.provenance.prompt, entry.provenance.model ?? '', entry.provenance.channel ?? ''].join(' ').toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      return true
    })
  }, [entries, keyword, typeFilter, categoryFilter, tagFilter])

  const typeCounts = useMemo(() => {
    const counts: Record<'all' | LibraryType, number> = { all: entries.length, voice: 0, music: 0, sfx: 0, tts: 0 }
    for (const entry of entries) counts[entry.type] += 1
    return counts
  }, [entries])

  const detail = entries.find(entry => entry.id === detailId) ?? null
  /** Voice ID：provenance 优先；旧记录未写入时从 files[].voiceId 兜底。 */
  const drawerVoiceId = detail?.provenance.voiceId ?? detail?.files.find(file => file.voiceId !== undefined)?.voiceId
  /** 音色设计音频对应的试听文本：provenance.previewText 优先，旧记录从 params 快照兜底。 */
  const drawerPreviewTextRaw =
    detail?.provenance.previewText ?? (typeof detail?.provenance.params?.['previewText'] === 'string' ? detail.provenance.params['previewText'] as string : undefined)
  const drawerPreviewText = typeof drawerPreviewTextRaw === 'string' && drawerPreviewTextRaw.trim() !== '' ? drawerPreviewTextRaw.trim() : undefined

  const currentCategoryOptions = useMemo(() => {
    if (typeFilter === 'all') return []
    return [...new Set([...(categoriesOf.get(typeFilter) ?? []), ...(typeFilter === 'voice' ? VOICE_CATEGORIES : [])])]
  }, [typeFilter, categoriesOf])

  const toggleSelect = (id: string): void => {
    setSelected(current => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  const doDelete = async (ids: string[]): Promise<void> => {
    setBusy(true)
    try {
      await api.libraryRemove(ids)
      setEntries(current => current.filter(entry => !ids.includes(entry.id)))
      setSelected(current => {
        const next = new Set(current)
        for (const id of ids) next.delete(id)
        return next
      })
      if (detailId !== null && ids.includes(detailId)) setDetailId(null)
      props.showToast(`已删除 ${ids.length} 个资源`)
    } catch (err) {
      props.showToast(err instanceof Error ? err.message : '删除失败')
    } finally {
      setBusy(false)
      setConfirmDelete(null)
    }
  }

  const copyText = async (text: string, key: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      window.setTimeout(() => setCopied(null), 1400)
    } catch {
      props.showToast('复制失败')
    }
  }

  // ---- detail drawer state -------------------------------------------------
  const [draft, setDraft] = useState<DraftState | null>(null)
  useEffect(() => {
    if (detail !== null) {
      setDraft({
        name: detail.name,
        tags: detail.tags.join(', '),
        note: detail.note ?? '',
        type: detail.type,
        category: detail.category ?? '',
      })
    }
  }, [detailId])

  const saveDraft = async (): Promise<void> => {
    if (detail === null || draft === null) return
    setBusy(true)
    try {
      const result = await api.libraryUpdate({
        id: detail.id,
        name: draft.name,
        tags: draft.tags.split(/[,，、\n]/).map(tag => tag.trim()).filter(tag => tag !== ''),
        note: draft.note,
        type: draft.type,
        ...((draft.type === 'voice' || draft.type === 'tts') && draft.category.trim() !== '' ? { category: draft.category.trim() } : {}),
      })
      if (!result.ok || result.entry === undefined) {
        props.showToast(result.message ?? '保存失败')
        return
      }
      setEntries(current => current.map(entry => entry.id === result.entry!.id ? result.entry! : entry))
      props.showToast('资源已更新')
    } catch (err) {
      props.showToast(err instanceof Error ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const batchMoveCategory = async (category: string, type: LibraryType): Promise<void> => {
    if (selected.size === 0) return
    setBusy(true)
    try {
      for (const id of selected) {
        await api.libraryUpdate({ id, type, ...(category !== '' ? { category } : {}) })
      }
      await load()
      setSelected(new Set())
      props.showToast(`已移动 ${selected.size} 个资源`)
    } catch (err) {
      props.showToast(err instanceof Error ? err.message : '移动失败')
    } finally {
      setBusy(false)
    }
  }

  const [batchTypeSelect, setBatchTypeSelect] = useState<LibraryType>('voice')
  const [batchCategorySelect, setBatchCategorySelect] = useState('')

  return (
    <div className={css.library}>
      <div className={css.toolbar}>
        <label className={css.searchBox}>
          <SearchIcon />
          <input
            className={css.searchInput}
            value={keyword}
            onChange={event => setKeyword(event.target.value)}
            placeholder="搜索名称、标签、提示词、模型…"
          />
        </label>
        <div className={css.typeChips}>
          <button type="button" className={css.chip} data-active={typeFilter === 'all' ? 'true' : 'false'} onClick={() => setTypeFilter('all')}>
            全部 <span className={css.chipCount}>{typeCounts.all}</span>
          </button>
          {TYPE_ORDER.map(type => (
            <button key={type} type="button" className={css.chip} data-active={typeFilter === type ? 'true' : 'false'} onClick={() => setTypeFilter(type)}>
              {typeIcon(type)} {LIBRARY_TYPE_LABELS[type]} <span className={css.chipCount}>{typeCounts[type]}</span>
            </button>
          ))}
        </div>
      </div>

      {typeFilter !== 'all' && currentCategoryOptions.length > 0 ? (
        <div className={css.filterRow}>
          <span className={css.filterLabel}>分类</span>
          <button type="button" className={css.smallChip} data-active={categoryFilter === 'all' ? 'true' : 'false'} onClick={() => setCategoryFilter('all')}>全部</button>
          {currentCategoryOptions.map(category => (
            <button key={category} type="button" className={css.smallChip} data-active={categoryFilter === category ? 'true' : 'false'} onClick={() => setCategoryFilter(category)}>
              {typeFilter === 'voice' ? ({ male: '男声', female: '女声', custom: '未分级' }[category] ?? category) : category}
            </button>
          ))}
        </div>
      ) : null}

      {tags.length > 0 ? (
        <div className={css.filterRow}>
          <span className={css.filterLabel}>标签</span>
          {tags.map(([tag, count]) => (
            <button key={tag} type="button" className={css.smallChip} data-active={tagFilter === tag ? 'true' : 'false'} onClick={() => setTagFilter(tagFilter === tag ? null : tag)}>
              {tag} <span className={css.chipCount}>{count}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className={css.listHead}>
        <span className={css.listCount}>{filtered.length} 个资源</span>
        <div className={css.listActions}>
          {batchMode ? (
            <>
              <span className={css.selCount}>已选 {selected.size}</span>
              <select
                className={css.smallSelect}
                value={batchTypeSelect}
                onChange={event => {
                  setBatchTypeSelect(event.target.value as LibraryType)
                  setBatchCategorySelect('')
                }}
              >
                {TYPE_ORDER.map(type => <option key={type} value={type}>{LIBRARY_TYPE_LABELS[type]}</option>)}
              </select>
              <input className={css.smallSelect} list="library-category-options" placeholder="分类（可选）" value={batchCategorySelect} onChange={event => setBatchCategorySelect(event.target.value)} />
              <datalist id="library-category-options">
                {(categoriesOf.get(batchTypeSelect) ?? []).map(category => <option key={category} value={category} />)}
              </datalist>
              <button type="button" className={css.ghostBtn} disabled={busy || selected.size === 0} onClick={() => void batchMoveCategory(batchCategorySelect, batchTypeSelect)}>
                <CheckIcon /> 移动
              </button>
              <button
                type="button"
                className={css.dangerBtn}
                disabled={busy || selected.size === 0}
                onClick={() => {
                  if (confirmDelete === 'batch') void doDelete([...selected])
                  else setConfirmDelete('batch')
                }}
              >
                <TrashIcon /> {confirmDelete === 'batch' ? '确认删除' : '批量删除'}
              </button>
              <button type="button" className={css.ghostBtn} onClick={() => { setBatchMode(false); setSelected(new Set()); setConfirmDelete(null) }}>
                退出
              </button>
            </>
          ) : (
            <button type="button" className={css.ghostBtn} onClick={() => setBatchMode(true)}>
              多选管理
            </button>
          )}
        </div>
      </div>

      {loading ? <p className={css.stateNote}>加载中…</p> : null}
      {error !== null ? (
        <div className={css.stateNote} data-error>
          <p>{error}</p>
          <p>若提示 not found / 404：插件宿主尚未加载新代码，请重启 `dsh web` 后在浏览器强制刷新（Cmd+Shift+R）。</p>
        </div>
      ) : null}
      {!loading && error === null && filtered.length === 0 ? (
        <div className={css.empty}>
          <span className={css.emptyIcon}>🎧</span>
          <p>资源库还是空的</p>
          <p className={css.emptyHint}>在生成页点击「加入资源库」，把满意的音频沉淀为可管理的资源</p>
        </div>
      ) : null}

      <div className={css.grid}>
        {filtered.map(entry => {
          const fileCount = entry.files.length
          const first = entry.files[0]
          return (
            <article
              key={entry.id}
              className={css.card}
              data-selected={selected.has(entry.id) ? 'true' : 'false'}
              onClick={() => {
                if (batchMode) toggleSelect(entry.id)
                else setDetailId(entry.id)
              }}
              role="button"
              tabIndex={0}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (batchMode) toggleSelect(entry.id); else setDetailId(entry.id) }
              }}
            >
              {batchMode ? (
                <span className={css.cardCheck} onClick={event => event.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(entry.id)} onChange={() => toggleSelect(entry.id)} />
                </span>
              ) : null}
              <div className={css.cardHead}>
                <span className={css.typeBadge} data-type={entry.type}>{typeIcon(entry.type)}{LIBRARY_TYPE_LABELS[entry.type]}</span>
                <span className={css.cardTime}>{timeAgo(entry.createdAt)}</span>
              </div>
              <strong className={css.cardName} title={entry.name}>{entry.name}</strong>
              {first !== undefined ? (
                <div onClick={event => event.stopPropagation()}>
                  <AudioPlayer src={first.url} compact itemKey={entry.id} />
                </div>
              ) : null}
              <div className={css.cardFoot}>
                {entry.category !== undefined && entry.category !== '' ? (
                  <span className={css.metaChip}>{entry.type === 'voice' ? ({ male: '男声', female: '女声', custom: '未分级' }[entry.category] ?? entry.category) : entry.category}</span>
                ) : null}
                {entry.provenance.model !== undefined ? <span className={css.metaChip} title={`模型：${entry.provenance.model}`}>{entry.provenance.model}</span> : null}
                {fileCount > 1 ? <span className={css.metaChip}>×{fileCount}</span> : null}
                {entry.tags.length > 0 ? <span className={css.metaChip} data-tag>{entry.tags[0]}{entry.tags.length > 1 ? ` +${entry.tags.length - 1}` : ''}</span> : null}
              </div>
            </article>
          )
        })}
      </div>

      {detail !== null ? (
        <div className={css.drawerMask} onClick={() => setDetailId(null)}>
          <aside className={css.drawer} onClick={event => event.stopPropagation()}>
            <header className={css.drawerHead}>
              <strong className={css.drawerTitle}>{detail.name}</strong>
              <button type="button" className={css.iconBtn} aria-label="关闭" onClick={() => setDetailId(null)}>×</button>
            </header>

            <div className={css.drawerBody}>
              <div className={css.drawerSection}>
                <div className={css.drawerPlayerList}>
                  {detail.files.map(file => (
                    <div key={file.rel} className={css.drawerPlayer}>
                      <span className={css.drawerPlayerName}>{file.rel.split('/').pop()}</span>
                      <AudioPlayer src={file.url} itemKey={`${file.rel}-${detail.createdAt}`} />
                    </div>
                  ))}
                </div>
              </div>

              {draft !== null ? (
                <div className={css.drawerSection}>
                  <div className={css.drawerLabel}>编辑</div>
                  <label className={css.drawerField}>
                    <span>名称</span>
                    <input className={css.input} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} />
                  </label>
                  <label className={css.drawerField}>
                    <span>标签（逗号分隔）</span>
                    <input className={css.input} value={draft.tags} onChange={event => setDraft({ ...draft, tags: event.target.value })} />
                  </label>
                  <label className={css.drawerField}>
                    <span>备注</span>
                    <textarea className={css.textarea} rows={2} value={draft.note} onChange={event => setDraft({ ...draft, note: event.target.value })} />
                  </label>
                  <div className={css.drawerSplit}>
                    <label className={css.drawerField}>
                      <span>类型</span>
                      <select className={css.input} value={draft.type} onChange={event => setDraft({ ...draft, type: event.target.value as LibraryType, category: '' })}>
                        {TYPE_ORDER.map(type => <option key={type} value={type}>{LIBRARY_TYPE_LABELS[type]}</option>)}
                      </select>
                    </label>
                    {(draft.type === 'voice' || draft.type === 'tts') ? (
                      <label className={css.drawerField}>
                        <span>{draft.type === 'voice' ? '分级（男/女）' : '音色键'}</span>
                        <input className={css.input} list="library-category-options" value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value })} placeholder={draft.type === 'voice' ? 'male / female / custom' : 'voice 键'} />
                      </label>
                    ) : null}
                  </div>
                  <button type="button" className={css.primaryBtn} disabled={busy} onClick={() => void saveDraft()}><CheckIcon /> 保存修改</button>
                </div>
              ) : null}

              <div className={css.drawerSection}>
                <div className={css.drawerLabel}>来源（可追溯）</div>
                <div className={css.provenance}>
                  <div className={css.provRow}><span className={css.provKey}>类型</span><span className={css.provValue}>{LIBRARY_TYPE_LABELS[detail.type]} · {detail.provenance.mode}</span></div>
                  {detail.provenance.channel !== undefined ? <div className={css.provRow}><span className={css.provKey}>渠道</span><span className={css.provValue}>{detail.provenance.channel}</span></div> : null}
                  {detail.provenance.apiUrl !== undefined ? <div className={css.provRow}><span className={css.provKey}>API 地址</span><span className={`${css.provValue} ${css.mono}`}>{detail.provenance.apiUrl}</span></div> : null}
                  {detail.provenance.model !== undefined ? (
                    <div className={css.provRow}>
                      <span className={css.provKey}>模型</span>
                      <span className={css.provValue}>{detail.provenance.model}{detail.provenance.upstream !== undefined && detail.provenance.upstream !== detail.provenance.model ? ` → ${detail.provenance.upstream}` : ''}</span>
                    </div>
                  ) : null}
                  {detail.provenance.voice !== undefined ? <div className={css.provRow}><span className={css.provKey}>音色</span><span className={css.provValue}>{detail.provenance.voice}</span></div> : null}
                  {drawerVoiceId !== undefined ? (
                    <div className={css.provRow}>
                      <span className={css.provKey}>Voice ID</span>
                      <span className={css.provValue}>
                        <code className={css.code}>{drawerVoiceId}</code>
                        <button type="button" className={css.iconBtn} title="复制 Voice ID" onClick={() => void copyText(drawerVoiceId, `vid-${detail.id}`)}>
                          {copied === `vid-${detail.id}` ? <CheckIcon /> : <CopyIcon />}
                        </button>
                      </span>
                    </div>
                  ) : null}
                  <div className={css.provRow}><span className={css.provKey}>提示词</span><span className={`${css.provValue} ${css.promptText}`}>{detail.provenance.prompt || '—'}</span></div>
                  {drawerPreviewText !== undefined ? (
                    <div className={css.provRow}><span className={css.provKey}>试听文本</span><span className={`${css.provValue} ${css.promptText}`}>{drawerPreviewText}</span></div>
                  ) : null}
                  <div className={css.provRow}><span className={css.provKey}>创建时间</span><span className={css.provValue}>{new Date(detail.createdAt).toLocaleString('zh-CN', { hour12: false })}</span></div>
                  {detail.provenance.params !== undefined ? (
                    <div className={css.provRow}>
                      <span className={css.provKey}>生成参数</span>
                      <span className={css.provValue}>
                        <details className={css.paramsDetails}>
                          <summary>查看参数快照</summary>
                          <pre className={css.code}>{JSON.stringify(detail.provenance.params, null, 2)}</pre>
                        </details>
                        <button type="button" className={css.iconBtn} title="复制参数 JSON" onClick={() => void copyText(JSON.stringify(detail.provenance.params, null, 2), `params-${detail.id}`)}>
                          {copied === `params-${detail.id}` ? <CheckIcon /> : <CopyIcon />}
                        </button>
                      </span>
                    </div>
                  ) : null}
                  <div className={css.provRow}><span className={css.provKey}>文件</span><span className={`${css.provValue} ${css.mono}`}>{detail.files.length} 段 · {detail.files.map(file => file.rel).join('，')}</span></div>
                </div>
              </div>

              <div className={css.drawerActions}>
                {drawerVoiceId !== undefined || detail.provenance.voice !== undefined ? (
                  <button
                    type="button"
                    className={css.primaryBtn}
                    onClick={() => {
                      props.onReuseVoice({
                        mode: 'tts',
                        ...(drawerVoiceId !== undefined ? { voiceId: drawerVoiceId } : {}),
                        ...(detail.provenance.voice !== undefined ? { voice: detail.provenance.voice } : {}),
                        ...(detail.provenance.model !== undefined ? { model: detail.provenance.model } : {}),
                      })
                      setDetailId(null)
                    }}
                  >
                    <MicIcon /> 用此音色去 TTS
                  </button>
                ) : null}
                <button
                  type="button"
                  className={css.dangerBtn}
                  onClick={() => {
                    if (confirmDelete === detail.id) void doDelete([detail.id])
                    else setConfirmDelete(detail.id)
                  }}
                  disabled={busy}
                >
                  <TrashIcon /> {confirmDelete === detail.id ? '确认删除' : '删除资源'}
                </button>
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  )
}
