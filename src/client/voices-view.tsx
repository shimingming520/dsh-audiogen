/**
 * Voices view: vendor voice management (browse/filter + delete + reuse).
 *
 * Lists TTS voices of a channel through the host voice-manager:
 * MiniMax (system presets + custom designed/cloned) and ElevenLabs
 * (owned + shared library, with the official /v1/shared-voices server-side
 * filters). Owned/custom voices can be deleted (confirmed); official,
 * shared and system voices are read-only. «用此音色生成» backfills the
 * studio form and switches to TTS.
 */

import { useEffect, useMemo, useState } from 'react'
import type { AudiogenApi } from './api.ts'
import type { AudiogenScope } from './settings-scope.ts'
import type { VoiceEntry, VoiceRecommendRecord } from '../protocol.ts'
import { tt } from './helpers.ts'
import { AudioPlayer } from './audio-player.tsx'
import { MicIcon, SearchIcon, TrashIcon, CheckIcon, ListIcon } from './icons.tsx'
import css from './voices.module.css'

export interface VoicesReusePayload {
  mode: 'tts'
  voiceId: string
  model?: string
}

const SOURCE_LABELS: Record<VoiceEntry['source'], string> = {
  system: '官方预置',
  custom: '自建设计',
  owned: '账户自有',
  shared: '社区共享',
  configured: '渠道模型',
}

/** 语言下拉：ISO 639-1 值；后端按两套厂商词汇匹配（ElevenLabs ISO / MiniMax 前缀）。 */
const LANGUAGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: '全部' },
  { value: 'zh', label: '中文（普通话 / 粤语）' },
  { value: 'en', label: '英语 English' },
  { value: 'ja', label: '日语 Japanese' },
  { value: 'ko', label: '韩语 Korean' },
  { value: 'es', label: '西班牙语 Spanish' },
  { value: 'fr', label: '法语 French' },
  { value: 'de', label: '德语 German' },
  { value: 'ru', label: '俄语 Russian' },
  { value: 'it', label: '意大利语 Italian' },
  { value: 'pt', label: '葡萄牙语 Portuguese' },
  { value: 'ar', label: '阿拉伯语 Arabic' },
  { value: 'hi', label: '印地语 Hindi' },
]

function useConfig(scope: AudiogenScope) {
  const [value, setValue] = useState(scope.getSnapshot().value)
  useEffect(() => scope.subscribe(() => { setValue(scope.getSnapshot().value) }), [scope])
  return value
}

export function VoicesView(props: {
  api: AudiogenApi
  scope: AudiogenScope
  showToast: (text: string) => void
  onReuseVoice: (payload: VoicesReusePayload) => void
}): React.JSX.Element {
  const { api, scope, showToast, onReuseVoice } = props
  const cfg = useConfig(scope)
  const channels = cfg?.channels ?? []
  const channelOptions = useMemo(
    () => channels.filter(channel => channel.apiUrl.trim() !== ''),
    [channels],
  )
  const [channelId, setChannelId] = useState('')
  useEffect(() => {
    if (channelId === '' || !channels.some(channel => channel.id === channelId)) {
      const fallback = channels.find(channel => channel.id === cfg?.defaultChannelId) ?? channels[0]
      setChannelId(fallback?.id ?? '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, cfg?.defaultChannelId])

  // 基础筛选
  const [language, setLanguage] = useState('')
  const [keyword, setKeyword] = useState('')
  const [source, setSource] = useState('')
  // ElevenLabs 官方共享库筛选（高级）
  const [search, setSearch] = useState('')
  const [useCase, setUseCase] = useState('')
  const [accent, setAccent] = useState('')
  const [gender, setGender] = useState('')
  const [age, setAge] = useState('')
  const [locale, setLocale] = useState('')
  const [category, setCategory] = useState('')
  const [sort, setSort] = useState('')
  const [featured, setFeatured] = useState(false)
  const [freeUsersAllowed, setFreeUsersAllowed] = useState(false)

  const [voices, setVoices] = useState<VoiceEntry[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // AI 推荐记录（每次推荐自动落盘，最多保留 50 条；关闭面板后仍可回看）
  const [records, setRecords] = useState<VoiceRecommendRecord[]>([])
  const [recordsOpen, setRecordsOpen] = useState(false)

  const loadRecords = async (): Promise<void> => {
    try {
      const response = await api.voiceRecommendHistory(30)
      setRecords(response.entries ?? [])
    } catch {
      // best-effort：记录加载失败不打扰主流程
    }
  }

  const removeRecord = async (id: string): Promise<void> => {
    await api.voiceRecommendHistoryRemove(id).catch(() => { /* best-effort */ })
    void loadRecords()
  }

  useEffect(() => { void loadRecords() }, [api])

  /** 当前的筛选载荷（查询音色列表用）。 */
  const currentFilterPayload = (): Record<string, unknown> => ({
    channel: channelId,
    ...(language.trim() === '' ? {} : { language: language.trim() }),
    ...(keyword.trim() === '' ? {} : { keyword: keyword.trim() }),
    ...(source === '' ? {} : { source }),
    ...(search.trim() === '' ? {} : { search: search.trim() }),
    ...(useCase.trim() === '' ? {} : { use_case: useCase.trim() }),
    ...(accent.trim() === '' ? {} : { accent: accent.trim() }),
    ...(gender.trim() === '' ? {} : { gender: gender.trim() }),
    ...(age.trim() === '' ? {} : { age: age.trim() }),
    ...(locale.trim() === '' ? {} : { locale: locale.trim() }),
    ...(category.trim() === '' ? {} : { category: category.trim() }),
    ...(sort === '' ? {} : { sort }),
    ...(featured ? { featured: true } : {}),
    ...(freeUsersAllowed ? { free_users_allowed: true } : {}),
  })

  const load = async (): Promise<void> => {
    const channel = channels.find(item => item.id === channelId)
    if (channel === undefined) return
    setLoading(true)
    setError(null)
    setNote(null)
    try {
      const response = await api.voiceList({
        ...currentFilterPayload(),
        limit: 500,
      })
      if (response.ok) {
        setVoices(response.voices ?? [])
        setTruncated(response.truncated === true)
        setNote(response.note ?? null)
      } else {
        setVoices([])
        setError(response.message ?? '音色列表拉取失败')
      }
    } catch (err) {
      setVoices([])
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  // 首次挂载与切渠道时自动查询
  useEffect(() => {
    if (channelId === '') return
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId])

  const remove = async (voice: VoiceEntry): Promise<void> => {
    if (deletingId !== null) return
    if (!window.confirm(`确认删除音色「${voice.name}」（${voice.voice_id}）？\n此操作不可逆，删除后无法恢复。`)) return
    setDeletingId(voice.voice_id)
    try {
      const response = await api.voiceDelete({ channel: channelId, voice_id: voice.voice_id, confirm: true })
      if (response.ok) {
        showToast(`已删除音色 ${voice.name}`)
      } else {
        showToast(response.message ?? '删除失败')
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err))
    } finally {
      setDeletingId(null)
      void load()
    }
  }

  const reuse = (voice: VoiceEntry): void => {
    const channel = channels.find(item => item.id === channelId)
    const ttsModel = channel?.models.find(model => model.category === 'tts' || /tts|speech|voice|t2a/i.test(model.alias))
    onReuseVoice({
      mode: 'tts',
      voiceId: voice.voice_id,
      ...(ttsModel === undefined || ttsModel.alias === '' ? {} : { model: ttsModel.alias }),
    })
  }

  /** 从推荐记录里复用音色：切到记录对应的渠道，再回填 TTS 表单。 */
  const reuseFromRecord = (record: VoiceRecommendRecord, voice: { voice_id: string }): void => {
    if (record.channel_id !== undefined && record.channel_id !== '' && channels.some(item => item.id === record.channel_id)) {
      setChannelId(record.channel_id)
    }
    const channel = channels.find(item => item.id === (record.channel_id ?? channelId))
    const ttsModel = channel?.models.find(model => model.category === 'tts' || /tts|speech|voice|t2a/i.test(model.alias))
    onReuseVoice({
      mode: 'tts',
      voiceId: voice.voice_id,
      ...(ttsModel === undefined || ttsModel.alias === '' ? {} : { model: ttsModel.alias }),
    })
  }

  return (
    <div className={css.view}>
      <div className={css.toolbar}>
        <label className={css.field}>
          <span className={css.fieldLabel}>厂商 / 渠道</span>
          <select className={css.select} value={channelId} onChange={event => setChannelId(event.target.value)}>
            {channelOptions.map(channel => (
              <option key={channel.id} value={channel.id}>{channel.name}</option>
            ))}
          </select>
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>语言</span>
          <select className={css.select} value={language} onChange={event => setLanguage(event.target.value)}>
            {LANGUAGE_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>关键词</span>
          <input className={css.input} value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="名字/描述/口音…" />
        </label>
        <label className={css.field}>
          <span className={css.fieldLabel}>来源</span>
          <select className={css.select} value={source} onChange={event => setSource(event.target.value)}>
            <option value="">全部</option>
            <option value="system">官方预置</option>
            <option value="custom">自建设计</option>
            <option value="owned">账户自有</option>
            <option value="shared">社区共享</option>
          </select>
        </label>
        <button type="button" className={css.primaryBtn} onClick={() => void load()} disabled={loading}>
          <SearchIcon /> {loading ? '查询中…' : '查询音色'}
        </button>
      </div>

      <p className={css.stateNote}>
        按需求描述（prompt）推荐音色请使用生成页左侧「🎤 音色推荐」模式；这里仅浏览/筛选/删除音色，下方为历次 AI 推荐记录。
      </p>

      {records.length > 0 ? (
        <details
          className={css.recordBox}
          open={recordsOpen}
          onToggle={(event) => setRecordsOpen((event.target as HTMLDetailsElement).open)}
        >
          <summary className={css.recordSummary}>
            <ListIcon /> 最近 AI 推荐（{records.length}）
            <span className={css.recordHint}>每次推荐自动记录，点「用此音色生成」可直接回填 TTS 表单</span>
          </summary>
          <div className={css.recordList}>
            {records.map(record => (
              <div className={`${css.card} ${css.recordCard}`} key={record.id}>
                <div className={css.cardHead}>
                  <span className={css.voiceName} title={record.requirement}>{record.requirement}</span>
                  <span className={css.badge} data-source={record.vendor}>{record.channel}</span>
                </div>
                <div className={css.meta}>
                  <span>{new Date(record.createdAt).toLocaleString()}</span>
                  <span>候选池 {record.candidate_count}</span>
                  <span>推荐 {record.recommendations.length} 条</span>
                </div>
                <div className={css.recordVoices}>
                  {record.recommendations.map((voice, index) => (
                    <div className={css.recordVoiceRow} key={`${record.id}:${voice.voice_id}`}>
                      <span className={css.rank}>{index + 1}</span>
                      <span className={css.recordVoiceName} title={voice.name}>{voice.name}</span>
                      <span className={css.voiceId} title={voice.voice_id}>ID: {voice.voice_id}</span>
                      {voice.descriptive === undefined ? null : <span className={css.reasonInline}>descriptive: {voice.descriptive}</span>}
                      {voice.reason === '' ? null : <span className={css.reasonInline}>{voice.reason}</span>}
                      <button type="button" className={css.useBtn} onClick={() => reuseFromRecord(record, voice)}>
                        <MicIcon /> 用此音色生成
                      </button>
                    </div>
                  ))}
                </div>
                <div className={css.actions}>
                  <button type="button" className={css.deleteBtn} onClick={() => void removeRecord(record.id)}>
                    <TrashIcon /> 删除记录
                  </button>
                </div>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <details className={css.advanced}>
        <summary className={css.advancedSummary}>官方共享库筛选（ElevenLabs /v1/shared-voices，其它渠道无效）</summary>
        <div className={css.advancedGrid}>
          <label className={css.field}><span className={css.fieldLabel}>搜索（search）</span><input className={css.input} value={search} onChange={event => setSearch(event.target.value)} /></label>
          <label className={css.field}><span className={css.fieldLabel}>用途（use_case）</span><input className={css.input} value={useCase} onChange={event => setUseCase(event.target.value)} placeholder="characters_animation / narration…" /></label>
          <label className={css.field}><span className={css.fieldLabel}>口音（accent）</span><input className={css.input} value={accent} onChange={event => setAccent(event.target.value)} placeholder="british / american…" /></label>
          <label className={css.field}><span className={css.fieldLabel}>性别（gender）</span><input className={css.input} value={gender} onChange={event => setGender(event.target.value)} placeholder="male / female" /></label>
          <label className={css.field}><span className={css.fieldLabel}>年龄（age）</span><input className={css.input} value={age} onChange={event => setAge(event.target.value)} placeholder="adult / young…" /></label>
          <label className={css.field}><span className={css.fieldLabel}>方言（locale）</span><input className={css.input} value={locale} onChange={event => setLocale(event.target.value)} placeholder="en-us / en-gb…" /></label>
          <label className={css.field}><span className={css.fieldLabel}>分类（category）</span><input className={css.input} value={category} onChange={event => setCategory(event.target.value)} placeholder="animation…" /></label>
          <label className={css.field}>
            <span className={css.fieldLabel}>排序（sort）</span>
            <select className={css.select} value={sort} onChange={event => setSort(event.target.value)}>
              <option value="">默认</option>
              <option value="most_used">most_used</option>
              <option value="random">random</option>
              <option value="oldest">oldest</option>
              <option value="newest">newest</option>
            </select>
          </label>
          <label className={css.checkRow}><input type="checkbox" checked={featured} onChange={event => setFeatured(event.target.checked)} /> 仅精选（featured）</label>
          <label className={css.checkRow}><input type="checkbox" checked={freeUsersAllowed} onChange={event => setFreeUsersAllowed(event.target.checked)} /> 仅免费用户可用</label>
        </div>
      </details>

      <div className={css.stateLine}>
        {loading ? <span className={css.stateNote}>正在拉取音色列表…</span> : null}
        {!loading && error !== null ? <span className={css.stateNote} data-error>⚠ {error}</span> : null}
        {!loading && note !== null ? <span className={css.stateNote}>{note}</span> : null}
        {!loading && truncated ? <span className={css.stateNote}>已截断：仅显示前 {voices.length} 个，可用筛选条件缩小范围</span> : null}
        {!loading && error === null ? <span className={css.count}>{voices.length} 个音色</span> : null}
      </div>

      <div className={css.list}>
        {voices.map(voice => (
          <div className={css.card} key={`${voice.source}:${voice.voice_id}`}>
            <div className={css.cardHead}>
              <span className={css.voiceName} title={voice.name}>{voice.name}</span>
              <span
                className={css.badge}
                data-source={voice.source}
                title={voice.deletable ? '可删除（自建音色）' : '只读（官方/共享音色不可删）'}
              >
                {SOURCE_LABELS[voice.source]}{voice.deletable ? '' : ' · 只读'}
              </span>
            </div>
            <div className={css.meta}>
              <span className={css.voiceId} title={voice.voice_id}>ID: {voice.voice_id}</span>
              {voice.language === undefined ? null : <span>{voice.language}</span>}
              {voice.accent === undefined ? null : <span>{voice.accent}</span>}
              {voice.gender === undefined ? null : <span>{voice.gender}</span>}
              {voice.age === undefined ? null : <span>{voice.age}</span>}
              {voice.use_case === undefined ? null : <span>{voice.use_case}</span>}
            </div>
            {voice.description === undefined || voice.description === '' ? null : (
              <p className={css.description}>{voice.description}</p>
            )}
            {voice.preview_url === undefined || voice.preview_url === '' ? null : (
              <div className={css.preview}><AudioPlayer src={voice.preview_url} compact /></div>
            )}
            <div className={css.actions}>
              <button type="button" className={css.useBtn} onClick={() => reuse(voice)}>
                <MicIcon /> 用此音色生成
              </button>
              {voice.deletable ? (
                <button
                  type="button"
                  className={css.deleteBtn}
                  disabled={deletingId !== null}
                  onClick={() => void remove(voice)}
                >
                  <TrashIcon /> {deletingId === voice.voice_id ? '删除中…' : '删除'}
                </button>
              ) : null}
            </div>
          </div>
        ))}
        {!loading && error === null && voices.length === 0 ? (
          <div className={css.empty}>
            <CheckIcon /> 没有匹配的音色——请调整筛选条件，或该渠道不支持音色库接口（部分网关不映射 /v1/voices）。
          </div>
        ) : null}
      </div>
    </div>
  )
}
