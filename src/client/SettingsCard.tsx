/**
 * The dsh-audiogen settings card.
 *
 * Registers into the official `settings.plugin.item` slot. It manages a list
 * of audio channels (each with API URL, per-channel secret, and model/voice
 * catalog), plus master switches.
 *
 * Channel management follows the DSH "模型" settings pattern: provider rows
 * with a status dot and 编辑/删除 actions, and two equal-width add actions
 * (「添加提供方」 / 「添加自定义提供方」) below. Both add and edit open the
 * same inline editor card — provider select, API key, 自定义设置 (API 地址)
 * and a 模型目录 with 「获取可用模型」 discovery and per-row model editing.
 */

import { useEffect, useMemo, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { CardForm, booleanField, textField, type CardActions, type CardShell, type FieldState as CardFieldState } from './settings-form.ts'
import { ChannelsForm, type ChannelDraft, type ChannelsFormActions, type ChannelsFormState } from './channels-form.ts'
import type { AudiogenScope } from './settings-scope.ts'
import { MODEL_API, PRESETS_API, type AudioModelCategory, type DiscoveredAudioModel, type ModelMapping, type PresetProviderView } from '../protocol.ts'
import type { AudioGenKey } from './locales.ts'
import css from './settings-card.module.css'

export interface AudioGenSettings {
  enabled?: boolean
  announceToAgent?: boolean
  allowAgentAudioGeneration?: boolean
  defaultModel?: string
  autoSaveToLibrary?: boolean
  maxConcurrentGenerations?: number
}

export interface AudioGenSettingsCardState extends CardShell {
  channels: ChannelsFormState
  enabled: CardFieldState
  announceToAgent: CardFieldState
  allowAgentAudioGeneration: CardFieldState
  defaultModel: CardFieldState
  autoSaveToLibrary: CardFieldState
  maxConcurrentGenerations: CardFieldState
}

export interface AudioGenSettingsCardFace extends CardActions {
  channels: ChannelsFormActions
  hooks: {
    audioGenSettingsCard: SnapshotStore<AudioGenSettingsCardState>
  }
}

export class AudioGenSettingsCardController {
  private readonly form: CardForm<AudioGenSettings>
  private readonly channelsForm: ChannelsForm

  constructor(private readonly scope: AudiogenScope) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
      booleanField('announceToAgent'),
      booleanField('allowAgentAudioGeneration'),
      textField('defaultModel'),
      booleanField('autoSaveToLibrary'),
      textField('maxConcurrentGenerations'),
    ])
    this.channelsForm = new ChannelsForm(scope)
  }

  private projection(): AudioGenSettingsCardState {
    const shell = this.form.shell()
    return {
      ...shell,
      dirty: shell.dirty || this.channelsForm.snapshot().dirty,
      channels: this.channelsForm.snapshot(),
      enabled: this.form.field('enabled'),
      announceToAgent: this.form.field('announceToAgent'),
      allowAgentAudioGeneration: this.form.field('allowAgentAudioGeneration'),
      defaultModel: this.form.field('defaultModel'),
      autoSaveToLibrary: this.form.field('autoSaveToLibrary'),
      maxConcurrentGenerations: this.form.field('maxConcurrentGenerations'),
    }
  }

  inject(): AudioGenSettingsCardFace {
    const cardStore = this.form.bind(() => this.projection())
    this.channelsForm.subscribe(() => { cardStore.set(this.projection()) })
    return {
      hooks: {
        audioGenSettingsCard: cardStore,
      },
      channels: this.channelsForm.actions(),
      ...this.form.actions(),
    }
  }
}

export type AudioGenSettingsCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'dsh-audiogen'>
  & InjectFace<AudioGenSettingsCardFace>

/** Which editor card is open. */
type EditorMode =
  | { kind: 'edit'; channelId: string }
  | { kind: 'add-provider' }
  | { kind: 'add-custom' }

const MODEL_CATEGORIES: Array<AudioModelCategory | undefined> = [
  undefined, 'tts', 'music', 'sfx', 'voice_design', 'voice_clone',
]

function newChannelId(): string {
  return `ch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/** Strip a draft before staging: empty rows removed, aliases default to ids. */
function cleanModels(models: ModelMapping[]): ModelMapping[] {
  const cleaned = models.map(model => {
    const alias = model.alias.trim()
    const id = model.id.trim() === '' ? alias : model.id.trim()
    if (alias === '' && id === '') return undefined
    return {
      alias: alias === '' ? id : alias,
      id,
      ...(model.category === undefined ? {} : { category: model.category }),
    } as ModelMapping | undefined
  }).filter((model): model is ModelMapping => model !== undefined)
  return [...new Map(cleaned.map(model => [model.alias, model])).values()]
}

/** Translate one key with interpolation (the injected `t` takes no values). */
function tpl(
  t: (key: AudioGenKey) => string,
  key: AudioGenKey,
  values?: Record<string, string | number>,
): string {
  let text = t(key)
  if (values === undefined) return text
  for (const [name, value] of Object.entries(values)) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

/** One model row as the editor holds it (never empty—rows are removed). */
interface ModelRow extends ModelMapping {
  rowKey: string
}

function rowsOf(models: ModelMapping[]): ModelRow[] {
  return models.map((model, index) => ({ ...model, rowKey: `m-${index}-${model.alias}-${model.id}` }))
}

// ---------------------------------------------------------------------------
// Channel editor card (add + edit share it)
// ---------------------------------------------------------------------------

interface ChannelEditorProps {
  t: (key: AudioGenKey) => string
  writable: boolean
  /** 'edit' | 'add-provider' | 'add-custom' */
  mode: EditorMode
  /** The channel being edited (edit mode). */
  channel?: ChannelDraft
  /** Whether the edited channel currently holds a stored secret. */
  keyHeld: boolean
  /** Presets available for the 提供方 select (add-provider mode). */
  presets: PresetProviderView[]
  /** Whether the edited channel is the default channel. */
  initiallyDefault: boolean
  onCancel: () => void
  onSave: (channel: ChannelDraft, key: string | undefined, isDefault: boolean) => void
}

function ChannelEditor(props: ChannelEditorProps): React.JSX.Element {
  const { t, writable, mode, presets } = props

  const initialPresetId = mode.kind === 'add-provider' ? (presets[0]?.id ?? '') : ''
  const [presetId, setPresetId] = useState(initialPresetId)
  const invited = useMemo(
    () => (mode.kind === 'add-provider' ? presets.find(preset => preset.id === presetId) : undefined),
    [mode, presets, presetId],
  )

  // Draft fields. In add-provider mode the preset change re-seeds them.
  const [name, setName] = useState(props.channel?.name ?? (invited?.name ?? ''))
  const [url, setUrl] = useState(props.channel?.apiUrl ?? (invited?.apiUrl ?? ''))
  const [models, setModels] = useState<ModelRow[]>(rowsOf(props.channel?.models ?? invited?.models ?? []))
  const [key, setKey] = useState('')
  const [keyAction, setKeyAction] = useState<'none' | 'clear'>('none')
  const [isDefault, setIsDefault] = useState(props.initiallyDefault)

  const [discovering, setDiscovering] = useState(false)
  const [discoverError, setDiscoverError] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<DiscoveredAudioModel[] | null>(null)
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const [sourceNote, setSourceNote] = useState<string | null>(null)

  const usePreset = (preset: PresetProviderView | undefined): void => {
    setPresetId(preset?.id ?? '')
    setName(preset?.name ?? '')
    setUrl(preset?.apiUrl ?? '')
    setModels(rowsOf(preset?.models ?? []))
    setKey('')
    setKeyAction('none')
  }

  const effectiveKeyHeld = props.keyHeld && keyAction !== 'clear'

  const save = (): void => {
    const currentId = props.channel?.id ?? newChannelId()
    const channel: ChannelDraft = {
      id: currentId,
      preset: mode.kind === 'edit' ? (props.channel?.preset ?? '') : (mode.kind === 'add-custom' ? '' : invited?.id ?? ''),
      name: name.trim(),
      apiUrl: url.trim(),
      models: cleanModels(models),
    }
    const stagedKey = key.trim() !== '' ? key.trim() : (keyAction === 'clear' ? '' : undefined)
    props.onSave(channel, stagedKey, isDefault)
  }

  const discoverable = url.trim() !== '' && (key.trim() !== '' || effectiveKeyHeld)

  const discover = async (): Promise<void> => {
    if (!discoverable) return
    setDiscovering(true)
    setDiscoverError(null)
    setSourceNote(null)
    try {
      const response = await fetch(MODEL_API.discover, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channelId: props.channel?.id ?? 'preview',
          preset: mode.kind === 'add-provider' ? (invited?.id ?? '') : (props.channel?.preset ?? ''),
          apiUrl: url.trim(),
          ...(key.trim() !== '' ? { apiKey: key.trim() } : {}),
        }),
      })
      const body = await response.json() as { ok?: boolean; models?: DiscoveredAudioModel[]; message?: string; source?: string }
      if (body.ok !== true || body.models === undefined) {
        throw new Error(body.message ?? `HTTP ${response.status}`)
      }
      const known = new Set(models.map(model => model.id.trim()).filter(Boolean))
      const found = body.models
        .map(model => ({ ...model, id: model.id.trim() }))
        .filter(model => model.id !== '')
      if (found.length === 0) {
        setDiscoverError(t('channel.fetchEmpty'))
        return
      }
      setCandidates(found)
      setPicked(new Set(found.filter(model => !known.has(model.id)).map(model => model.id)))
      setSourceNote(body.source ?? null)
    } catch (error) {
      setDiscoverError(error instanceof Error ? error.message : String(error))
    } finally {
      setDiscovering(false)
    }
  }

  const closeCandidates = (): void => {
    setCandidates(null)
    setPicked(new Set())
  }

  const adoptCandidates = (): void => {
    if (candidates === null) return
    const existing = [...models]
    const byId = new Map(existing.map((model, index) => [model.id.trim(), { model, index }]))
    for (const candidate of candidates) {
      const id = candidate.id.trim()
      if (id === '' || !picked.has(id)) continue
      if (byId.has(id)) continue
      byId.set(id, { model: { rowKey: `m-${Date.now()}-${existing.length}`, alias: candidate.alias, id, ...(candidate.category === undefined ? {} : { category: candidate.category }) }, index: existing.length })
      existing.push(byId.get(id)!.model)
    }
    setModels(existing)
    closeCandidates()
  }

  const patchModel = (index: number, next: Partial<ModelMapping>): void => {
    setModels(models.map((model, at) => at === index ? { ...model, ...next } : model))
  }

  const presetPlaceholder = invited?.apiUrl ?? t('channel.apiUrlPlaceholder')

  return (
    <div className={css.channelEditor}>
      {mode.kind === 'add-provider' ? (
        <div className={css.field}>
          <label className={css.label} htmlFor="audiogen-editor-provider">{t('channel.provider')}</label>
          <select
            id="audiogen-editor-provider"
            className={css.select}
            value={presetId}
            disabled={!writable}
            onChange={event => usePreset(presets.find(preset => preset.id === event.target.value))}
          >
            {presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
          </select>
          {invited?.site !== undefined ? (
            <p className={css.sectionHint}>{t('channel.site')}：<a className={css.link} href={invited.site} target="_blank" rel="noreferrer">{invited.site}</a></p>
          ) : null}
        </div>
      ) : null}
      {mode.kind === 'add-custom' ? (
        <div className={css.field}>
          <span className={css.label}>{t('channel.provider')}</span>
          <p className={css.sectionHint}>{t('channel.providerCustom')} — {t('channel.providerCustomHint')}</p>
        </div>
      ) : null}
      {mode.kind === 'edit' ? (
        <div className={css.editorHeader}>
          <span className={css.editorTitle}>{props.channel?.name.trim() !== '' ? props.channel?.name : t('channels.untitled')}</span>
          <span className={css.editorTag}>{mode.kind === 'edit' ? t('channel.editTitle') : ''}</span>
        </div>
      ) : null}
      <div className={css.field}>
        <label className={css.label} htmlFor="audiogen-editor-name">{t('channel.name')}</label>
        <input id="audiogen-editor-name" className={css.input} value={name} placeholder={t('channel.namePlaceholder')} disabled={!writable} onChange={event => setName(event.target.value)} />
      </div>
      <div className={css.field}>
        <div className={css.head}>
          <label className={css.label} htmlFor="audiogen-editor-key">{t('channel.apiKey')}</label>
          {effectiveKeyHeld && key.trim() === '' ? (
            <button type="button" className={css.reset} disabled={!writable} onClick={() => { setKeyAction('clear'); setKey('') }}>
              {t('channel.clearKey')}
            </button>
          ) : null}
        </div>
        <input
          id="audiogen-editor-key"
          className={css.input}
          type="password"
          value={key}
          autoComplete="off"
          placeholder={effectiveKeyHeld ? '••••••••' : ''}
          disabled={!writable}
          onChange={event => { setKey(event.target.value); if (event.target.value !== '') setKeyAction('none') }}
        />
        <p className={css.sectionHint}>{effectiveKeyHeld ? t('channel.apiKeyStoredHint') : t('channel.apiKeyHint')}</p>
      </div>
      <details className={css.customSettings}>
        <summary className={css.customSettingsSummary}>{t('channel.customSettings')}</summary>
        <div className={css.customSettingsBody}>
          <div className={css.field}>
            <label className={css.label} htmlFor="audiogen-editor-url">{t('channel.apiUrl')}</label>
            <input
              id="audiogen-editor-url"
              className={css.input}
              type="text"
              value={url}
              placeholder={presetPlaceholder}
              disabled={!writable}
              onChange={event => setUrl(event.target.value)}
            />
            <p className={css.sectionHint}>{t('channel.apiUrlHint')}</p>
          </div>
        </div>
      </details>
      <ModelCatalog
        t={t}
        writable={writable}
        models={models}
        discoverable={discoverable}
        discovering={discovering}
        discoverError={discoverError}
        candidates={candidates}
        picked={picked}
        sourceNote={sourceNote}
        onPatchModel={patchModel}
        onRemoveModel={index => setModels(models.filter((_model, at) => at !== index))}
        onAddModel={() => setModels([...models, { rowKey: `m-${Date.now()}-${models.length}`, alias: '', id: '' }])}
        onDiscover={() => void discover()}
        onTogglePicked={id => {
          setPicked(current => {
            const next = new Set(current)
            if (!next.delete(id)) next.add(id)
            return next
          })
        }}
        onToggleAllPicked={() => {
          setPicked(current => (candidates !== null && candidates.length > 0 && candidates.every(candidate => current.has(candidate.id)))
            ? new Set()
            : new Set((candidates ?? []).map(candidate => candidate.id)))
        }}
        onAdopt={() => adoptCandidates()}
        onCloseCandidates={closeCandidates}
      />
      <label className={css.field}>
        <span className={css.label}>
          <input type="checkbox" checked={isDefault} disabled={!writable} onChange={event => setIsDefault(event.target.checked)} /> {t('channel.default')}
        </span>
      </label>
      <div className={css.editorFooter}>
        <button type="button" className={css.discard} onClick={props.onCancel}>{t('channel.cancel')}</button>
        <button type="button" className={css.save} onClick={save}>{t('channel.save')}</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Model catalog (目录) inside the channel editor
// ---------------------------------------------------------------------------

interface ModelCatalogProps {
  t: (key: AudioGenKey) => string
  writable: boolean
  models: ModelRow[]
  discoverable: boolean
  discovering: boolean
  discoverError: string | null
  candidates: DiscoveredAudioModel[] | null
  picked: ReadonlySet<string>
  sourceNote: string | null
  onPatchModel: (index: number, next: Partial<ModelMapping>) => void
  onRemoveModel: (index: number) => void
  onAddModel: () => void
  onDiscover: () => void
  onTogglePicked: (id: string) => void
  onToggleAllPicked: () => void
  onAdopt: () => void
  onCloseCandidates: () => void
}

function ModelCatalog(props: ModelCatalogProps): React.JSX.Element {
  const { t, writable, models, discoverable, discovering, candidates, picked } = props
  const allPicked = candidates !== null && candidates.length > 0 && candidates.every(candidate => picked.has(candidate.id))
  return (
    <section className={css.modelCatalog} aria-label={t('channel.modelsTitle')}>
      <div className={css.modelCatalogHead}>
        <div>
          <span className={css.modelCatalogTitle}>{t('channel.modelsTitle')}</span>
          <span className={css.modelCatalogMeta}>
            {models.length > 0 ? tpl(t, 'channel.modelsCount', { n: models.length }) : t('channel.modelsNone')}
          </span>
        </div>
        <button
          type="button"
          className={css.linkButton}
          disabled={!writable || discovering || !discoverable}
          title={discoverable ? undefined : t('channel.discoverNeedsUrlKey')}
          onClick={props.onDiscover}
        >
          {discovering ? t('channel.fetchingModels') : t('channel.fetchModels')}
        </button>
      </div>
      {models.length === 0 ? <p className={css.modelEmpty}>{t('channel.modelsEmpty')}</p> : (
        <ul className={css.modelRows}>
          {models.map((model, index) => (
            <li key={`${model.rowKey}-${index}`} className={css.modelRow}>
              <input
                className={`${css.input} ${css.modelInput}`}
                type="text"
                value={model.alias}
                placeholder={t('channel.modelAlias')}
                aria-label={`${t('channel.modelAlias')} ${index + 1}`}
                disabled={!writable}
                onChange={event => props.onPatchModel(index, { alias: event.target.value })}
              />
              <span className={css.modelArrow} aria-hidden="true">→</span>
              <input
                className={`${css.input} ${css.modelInput}`}
                type="text"
                value={model.id}
                placeholder={t('channel.modelId')}
                aria-label={`${t('channel.modelId')} ${index + 1}`}
                disabled={!writable}
                onChange={event => props.onPatchModel(index, { id: event.target.value })}
              />
              <select
                className={`${css.select} ${css.modelCategorySelect}`}
                value={model.category ?? ''}
                aria-label={`${t('channel.modelCategory')} ${index + 1}`}
                disabled={!writable}
                onChange={event => {
                  const value = event.target.value as AudioModelCategory | ''
                  props.onPatchModel(index, value === '' ? { category: undefined } : { category: value })
                }}
              >
                {MODEL_CATEGORIES.map(category => (
                  <option key={category ?? 'auto'} value={category ?? ''}>{category === undefined ? t('channel.category.auto') : t(`channel.category.${category}`)}</option>
                ))}
              </select>
              <button
                type="button"
                className={css.modelRowRemove}
                aria-label={t('channel.removeModel')}
                disabled={!writable}
                onClick={() => props.onRemoveModel(index)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={css.modelCatalogTools}>
        <button type="button" className={css.addModel} disabled={!writable} onClick={props.onAddModel}>
          {t('channel.addModel')}
        </button>
      </div>
      {props.sourceNote !== null && props.candidates !== null ? (
        <p className={css.detectOk}>{tpl(t, 'channel.discoverSource', { source: props.sourceNote })}</p>
      ) : null}
      {props.discoverError !== null ? <p className={css.failed}>{props.discoverError}</p> : null}
      {candidates === null ? null : (
        <div className={css.candidatePanel}>
          <div className={css.candidateHead}>
            <span className={css.candidateTitle}>{tpl(t, 'channel.candidates', { n: candidates.length })}</span>
            <button type="button" className={css.linkButton} onClick={props.onToggleAllPicked}>
              {allPicked ? t('channel.clearSelection') : t('channel.selectAll')}
            </button>
          </div>
          <ul className={css.candidateList}>
            {candidates.map(candidate => (
              <li key={candidate.id} className={css.candidate}>
                <label className={css.candidateLabel}>
                  <input
                    type="checkbox"
                    checked={picked.has(candidate.id)}
                    disabled={models.some(model => model.id.trim() === candidate.id)}
                    onChange={() => props.onTogglePicked(candidate.id)}
                  />
                  <span className={css.candidateId}>{candidate.alias === candidate.id ? candidate.id : `${candidate.alias}（${candidate.id}）`}</span>
                  {candidate.category !== undefined ? <span className={css.modelBadge}>{t(`channel.category.${candidate.category}`)}</span> : null}
                </label>
              </li>
            ))}
          </ul>
          <div className={css.candidateActions}>
            <button type="button" className={css.discard} onClick={props.onCloseCandidates}>{t('channel.cancel')}</button>
            <button type="button" className={css.save} onClick={props.onAdopt}>
              {tpl(t, 'channel.adoptSelected', { n: Array.from(picked).length })}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function AudioGenSettingsCard(props: AudioGenSettingsCardProps) {
  const { t } = props
  const state = props.useAudioGenSettingsCard(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  const [editor, setEditor] = useState<EditorMode | null>(null)
  const [presets, setPresets] = useState<PresetProviderView[]>([])
  const [presetLoading, setPresetLoading] = useState(false)
  const [presetError, setPresetError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const channels = state.channels.channels
  const editingChannel = editor !== null && editor.kind === 'edit'
    ? channels.find(channel => channel.id === editor.channelId)
    : undefined

  useEffect(() => {
    if (editor?.kind === 'add-provider' && presets.length === 0 && presetError === null && !presetLoading) {
      setPresetLoading(true)
      setPresetError(null)
      void fetch(PRESETS_API, { method: 'POST' })
        .then(async response => {
          const body = await response.json() as { ok?: boolean; presets?: PresetProviderView[]; message?: string }
          if (!response.ok || body.ok !== true || body.presets === undefined) throw new Error(body.message ?? `HTTP ${response.status}`)
          setPresets(body.presets)
        })
        .catch(error => setPresetError(error instanceof Error ? error.message : String(error)))
        .finally(() => setPresetLoading(false))
    }
  }, [editor, presets.length, presetError, presetLoading])

  if (!state.available) return null

  const blocked = !state.dirty || state.invalid || state.saving || state.channels.saving

  const closeEditor = (): void => { setEditor(null) }

  const saveEditor = (channel: ChannelDraft, key: string | undefined, isDefault: boolean): void => {
    const exists = channels.some(candidate => candidate.id === channel.id)
    const next = exists
      ? channels.map(candidate => candidate.id === channel.id ? channel : candidate)
      : [...channels, channel]
    props.channels.setChannels(next)
    // key === undefined: no staged change; key === '': clear; otherwise set.
    if (key !== undefined) props.channels.setChannelKey(channel.id, key)
    if (isDefault) props.channels.setDefaultChannel(channel.id)
    closeEditor()
  }

  const removeChannel = (channel: ChannelDraft): void => {
    const isDefault = channel.id === state.channels.defaultChannelId
    const next = channels.filter(candidate => candidate.id !== channel.id)
    props.channels.setChannels(next)
    if (isDefault && next.length > 0) {
      props.channels.setDefaultChannel(next[0]!.id)
    }
    setConfirmDeleteId(null)
    if (editor?.kind === 'edit' && editor.channelId === channel.id) closeEditor()
  }

  const openAddProvider = (): void => {
    setPresetError(null)
    setEditor({ kind: 'add-provider' })
  }

  const openAddCustom = (): void => {
    setPresetError(null)
    setEditor({ kind: 'add-custom' })
  }

  return (
    <li className={css.card}>
      <button
        type="button"
        className={css.header}
        aria-expanded={open}
        aria-label={`${t(open ? 'settings.collapse' : 'settings.expand')}: ${t('settings.title')}`}
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.headText}>
          <span className={css.name}>{t('settings.title')}</span>
          <span className={css.description}>{t('settings.description')}</span>
        </span>
        {state.dirty ? <span className={css.pending}>{t('settings.unsaved')}</span> : null}
        <span className={open ? css.chevronOpen : css.chevron}>▾</span>
      </button>
      {!open ? null : (
        <div className={css.body}>
          {!state.writable ? <p className={css.readOnly} role="status">{t('settings.readOnly')}</p> : null}
          <section className={css.channelSection} aria-label={t('channels.title')}>
            <div className={css.sectionHeader}>
              <div>
                <h3 className={css.sectionTitle}>{t('channels.title')}</h3>
                <p className={css.sectionHint}>{t('channels.hint')}</p>
              </div>
            </div>
            {channels.length === 0 ? <p className={css.channelEmpty}>{t('channels.empty')}</p> : (
              <ul className={css.channelList}>
                {channels.map(channel => {
                  const keyHeld = state.channels.keySet[channel.id] === true
                  const ready = keyHeld && channel.models.length > 0
                  const isDefault = channel.id === state.channels.defaultChannelId
                  if (confirmDeleteId === channel.id) {
                    return (
                      <li key={channel.id} className={css.channelRow} data-action>
                        <span className={css.deleteConfirmText}>{t('channels.confirm')}: {channel.name || t('channels.untitled')}</span>
                        <button type="button" className={css.channelDanger} disabled={!state.writable} onClick={() => removeChannel(channel)}>{t('channels.confirm')}</button>
                        <button type="button" className={css.channelAction} onClick={() => setConfirmDeleteId(null)}>{t('channels.cancel')}</button>
                      </li>
                    )
                  }
                  return (
                    <li key={channel.id} className={css.channelRow}>
                      <span className={ready ? css.channelDotReady : css.channelDotWarn} aria-hidden="true" title={t(ready ? 'channels.statusReady' : 'channels.statusIncomplete')} />
                      <button type="button" className={css.channelMain} disabled={!state.writable} onClick={() => { setEditor({ kind: 'edit', channelId: channel.id }) }}>
                        <span className={css.channelName}>{isDefault ? `★ ${channel.name || t('channels.untitled')}` : (channel.name || t('channels.untitled'))}</span>
                        <span className={css.channelMeta}>
                          <span className={css.channelHost}>{channel.apiUrl || '(no url)'}</span>
                          <span className={css.channelBadge} data-warn={!keyHeld || channel.models.length === 0 ? '' : undefined}>
                            {keyHeld ? t('channels.keySet') : t('channels.keyMissing')}
                            {' · '}
                            {channel.models.length > 0 ? t('channels.modelCount', { n: channel.models.length }) : t('channels.noModels')}
                          </span>
                        </span>
                      </button>
                      <button type="button" className={css.channelAction} onClick={() => { setEditor({ kind: 'edit', channelId: channel.id }) }}>{t('channels.edit')}</button>
                      <button type="button" className={css.channelAction} data-danger onClick={() => setConfirmDeleteId(channel.id)}>{t('channels.delete')}</button>
                    </li>
                  )
                })}
              </ul>
            )}
            {presetError !== null ? <p className={css.failed}>{presetError}</p> : null}
            <div className={css.channelAddRow}>
              <button type="button" className={css.channelAdd} disabled={!state.writable} onClick={openAddProvider}>
                {presetLoading ? t('channels.addProviderLoading') : t('channels.addProvider')}
              </button>
              <button type="button" className={css.channelAdd} disabled={!state.writable} onClick={openAddCustom}>
                {t('channels.addCustom')}
              </button>
            </div>
            {editor !== null ? (
              editor.kind === 'add-provider' && presets.length === 0 && presetError === null ? (
                <p className={css.sectionHint}>{presetLoading ? t('channels.addProviderLoading') : t('channels.addProviderFailed')}</p>
              ) : (
                <div className={css.editorWrap}>
                  <ChannelEditor
                    key={editor.kind === 'edit' ? `edit-${editor.channelId}` : editor.kind}
                    t={t}
                    writable={state.writable}
                    mode={editor}
                    channel={editingChannel}
                    keyHeld={editor.kind === 'edit' ? state.channels.keySet[editor.channelId] === true : false}
                    presets={presets}
                    initiallyDefault={editor.kind === 'edit' ? editor.channelId === state.channels.defaultChannelId : channels.length === 0}
                    onCancel={closeEditor}
                    onSave={saveEditor}
                  />
                </div>
              )
            ) : null}
          </section>

          <div className={css.field}>
            <label className={css.label}>
              <input type="checkbox" checked={state.enabled.text === 'true' || state.enabled.text === ''} disabled={!state.writable} onChange={event => props.edit('enabled', String(event.target.checked))} /> {t('settings.enabled')}
            </label>
          </div>
          <div className={css.field}>
            <label className={css.label}>
              <input type="checkbox" checked={state.announceToAgent.text === 'true' || state.announceToAgent.text === ''} disabled={!state.writable} onChange={event => props.edit('announceToAgent', String(event.target.checked))} /> {t('settings.announceToAgent')}
            </label>
          </div>
          <div className={css.field}>
            <label className={css.label}>
              <input type="checkbox" checked={state.allowAgentAudioGeneration.text === 'true' || state.allowAgentAudioGeneration.text === ''} disabled={!state.writable} onChange={event => props.edit('allowAgentAudioGeneration', String(event.target.checked))} /> {t('settings.allowAgentAudio')}
            </label>
          </div>
          <div className={css.field}>
            <label className={css.label}>
              <input type="checkbox" checked={state.autoSaveToLibrary.text === 'true'} disabled={!state.writable} onChange={event => props.edit('autoSaveToLibrary', String(event.target.checked))} /> {t('settings.autoSaveLibrary')}
            </label>
          </div>
          <div className={css.field}>
            <label className={css.label}>
              <span>{t('settings.maxConcurrent')}</span>
              <input
                type="number"
                min="1"
                max="20"
                className={css.input}
                value={state.maxConcurrentGenerations.text}
                disabled={!state.writable}
                onChange={event => {
                  const raw = event.target.value
                  const parsed = Number(raw)
                  const value = raw === '' || !Number.isFinite(parsed) ? '' : String(Math.max(1, Math.min(20, Math.floor(parsed))))
                  props.edit('maxConcurrentGenerations', value)
                }}
              />
            </label>
          </div>
          <div className={css.footer}>
            {state.failed ? <p className={css.failed}>保存失败</p> : null}
            <button type="button" className={css.discard} disabled={!state.dirty || state.saving} onClick={() => props.discard()}>{t('settings.discard')}</button>
            <button type="button" className={css.save} disabled={blocked} onClick={() => { void props.save(); void props.channels.commit() }}>
              {state.saving ? t('settings.saving') : t('settings.save')}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
