/**
 * The dsh-audiogen settings card.
 *
 * Registers into the official `settings.plugin.item` slot. It manages a list
 * of audio channels (each with API URL, per-channel secret, and model/voice
 * catalog), plus master switches.
 */

import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { CardForm, booleanField, textField, type CardActions, type CardShell, type FieldState as CardFieldState } from './settings-form.ts'
import { ChannelsForm, type ChannelDraft, type ChannelsFormActions, type ChannelsFormState } from './channels-form.ts'
import type { AudiogenScope } from './settings-scope.ts'
import { MODEL_API, PRESETS_API, type DiscoveredAudioModel, type ModelMapping, type PresetProviderView } from '../protocol.ts'
import type { AudioGenKey } from './locales.ts'
import css from './settings-card.module.css'

export interface AudioGenSettings {
  enabled?: boolean
  announceToAgent?: boolean
  allowAgentAudioGeneration?: boolean
  defaultModel?: string
}

export interface AudioGenSettingsCardState extends CardShell {
  channels: ChannelsFormState
  enabled: CardFieldState
  announceToAgent: CardFieldState
  allowAgentAudioGeneration: CardFieldState
  defaultModel: CardFieldState
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

function newChannelDraft(preset: PresetProviderView | undefined, existing: ChannelDraft[]): ChannelDraft {
  const id = `ch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  if (preset === undefined) {
    return { id, preset: '', name: '', apiUrl: '', models: [] }
  }
  return {
    id,
    preset: preset.id,
    name: preset.name,
    apiUrl: preset.apiUrl,
    models: preset.models.map(model => ({ ...model })),
  }
}

function modelsToText(models: ModelMapping[]): string {
  return models.map(model => `${model.alias}=${model.id}${model.category === undefined ? '' : ` @${model.category}`}`).join('\n')
}

function textToModels(text: string): ModelMapping[] {
  return text.split(/\n|,/).map(line => line.trim()).filter(Boolean).map(line => {
    const at = line.lastIndexOf(' @')
    const category = at >= 0 ? line.slice(at + 2).trim() : undefined
    const body = at >= 0 ? line.slice(0, at).trim() : line
    const eq = body.indexOf('=')
    const alias = eq >= 0 ? body.slice(0, eq).trim() : body.trim()
    const id = eq >= 0 ? body.slice(eq + 1).trim() : alias
    return {
      alias,
      id: id === '' ? alias : id,
      ...(category === undefined || category === '' ? {} : { category: category as NonNullable<ModelMapping['category']> }),
    }
  }).filter(model => model.alias !== '')
}

export function AudioGenSettingsCard(props: AudioGenSettingsCardProps) {
  const { t } = props
  const state = props.useAudioGenSettingsCard(snapshot => snapshot)
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [presetPickerOpen, setPresetPickerOpen] = useState(false)
  const [presets, setPresets] = useState<PresetProviderView[]>([])
  const [presetError, setPresetError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [discovering, setDiscovering] = useState(false)
  const [discoverError, setDiscoverError] = useState<string | null>(null)

  const [editName, setEditName] = useState('')
  const [editUrl, setEditUrl] = useState('')
  const [editKey, setEditKey] = useState('')
  const [editModels, setEditModels] = useState('')
  const [editDefault, setEditDefault] = useState(false)

  const channels = state.channels.channels
  const editing = editingId === null ? undefined : channels.find(channel => channel.id === editingId)

  useEffect(() => {
    if (editing === undefined) return
    setEditName(editing.name)
    setEditUrl(editing.apiUrl)
    setEditKey('')
    setEditModels(modelsToText(editing.models))
    setEditDefault(editing.id === state.channels.defaultChannelId)
  }, [editingId, editing?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!state.available) return null

  const blocked = !state.dirty || state.invalid || state.saving || state.channels.saving

  const saveEdit = (): void => {
    if (editingId === null) return
    const existing = channels.find(channel => channel.id === editingId)
    const models = textToModels(editModels)
    const updated: ChannelDraft = {
      id: editingId,
      preset: existing?.preset ?? '',
      name: editName.trim(),
      apiUrl: editUrl.trim(),
      models,
    }
    const next = existing === undefined
      ? [...channels, updated]
      : channels.map(channel => channel.id === editingId ? updated : channel)
    props.channels.setChannels(next)
    if (editKey.trim() !== '') props.channels.setChannelKey(editingId, editKey.trim())
    if (editDefault) props.channels.setDefaultChannel(editingId)
    setEditingId(null)
  }

  const discoverModels = async (): Promise<void> => {
    if (editingId === null) return
    setDiscovering(true)
    setDiscoverError(null)
    try {
      const existing = channels.find(channel => channel.id === editingId)
      const response = await fetch(MODEL_API.discover, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          channelId: editingId,
          ...(editUrl.trim() !== '' ? { apiUrl: editUrl.trim() } : {}),
          ...(editKey.trim() !== '' ? { apiKey: editKey.trim() } : {}),
        }),
      })
      const body = await response.json() as { ok?: boolean; models?: DiscoveredAudioModel[]; message?: string; source?: string }
      if (body.ok !== true || body.models === undefined) {
        throw new Error(body.message ?? `HTTP ${response.status}`)
      }
      setEditModels(modelsToText([
        ...body.models,
        ...textToModels(editModels).filter(existingModel => !body.models!.some(model => model.id === existingModel.id)),
      ]))
      void existing
    } catch (error) {
      setDiscoverError(error instanceof Error ? error.message : String(error))
    } finally {
      setDiscovering(false)
    }
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
                        <button type="button" className={css.channelDanger} disabled={!state.writable} onClick={() => {
                          props.channels.setChannels(channels.filter(candidate => candidate.id !== channel.id))
                          if (isDefault && channels.length > 1) {
                            const next = channels.find(candidate => candidate.id !== channel.id)
                            if (next !== undefined) props.channels.setDefaultChannel(next.id)
                          }
                          setConfirmDeleteId(null)
                          if (editingId === channel.id) setEditingId(null)
                        }}>{t('channels.confirm')}</button>
                        <button type="button" className={css.channelAction} onClick={() => setConfirmDeleteId(null)}>{t('channels.cancel')}</button>
                      </li>
                    )
                  }
                  return (
                    <li key={channel.id} className={css.channelRow}>
                      <span className={ready ? css.channelDotReady : css.channelDotWarn} aria-hidden="true" title={t(ready ? 'channels.statusReady' : 'channels.statusIncomplete')} />
                      <button type="button" className={css.channelMain} disabled={!state.writable} onClick={() => setEditingId(channel.id)}>
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
                      <button type="button" className={css.channelAction} onClick={() => setEditingId(channel.id)}>{t('channels.edit')}</button>
                      <button type="button" className={css.channelAction} data-danger onClick={() => setConfirmDeleteId(channel.id)}>{t('channels.delete')}</button>
                    </li>
                  )
                })}
              </ul>
            )}
            {presetPickerOpen ? (
              <div className={css.channelControls}>
                <p className={css.sectionHint}>{t('presets.title')}</p>
                {presetError !== null ? <p className={css.failed}>{presetError}</p> : null}
                <div className={css.channelAddRow}>
                  <button type="button" className={css.channelAdd} onClick={() => {
                    setPresets([])
                    setPresetError(null)
                    void fetch(PRESETS_API, { method: 'POST' })
                      .then(async response => {
                        const body = await response.json() as { ok?: boolean; presets?: PresetProviderView[]; message?: string }
                        if (!response.ok || body.ok !== true || body.presets === undefined) throw new Error(body.message ?? `HTTP ${response.status}`)
                        setPresets(body.presets)
                      })
                      .catch(error => setPresetError(error instanceof Error ? error.message : String(error)))
                  }}>{t('channels.addProvider')}</button>
                  <button type="button" className={css.channelAdd} onClick={() => {
                    const draft = newChannelDraft(undefined, channels)
                    props.channels.setChannels([...channels, draft])
                    setPresetPickerOpen(false)
                    setEditingId(draft.id)
                  }}>{t('channels.addCustom')}</button>
                  <button type="button" className={css.channelAction} onClick={() => setPresetPickerOpen(false)}>×</button>
                </div>
                {presets.map(preset => (
                  <button key={preset.id} type="button" className={css.channelAdd} onClick={() => {
                    const draft = newChannelDraft(preset, channels)
                    props.channels.setChannels([...channels, draft])
                    setPresetPickerOpen(false)
                    setEditingId(draft.id)
                  }}>
                    {preset.name} — {preset.hint}
                  </button>
                ))}
              </div>
            ) : (
              <div className={css.channelAddRow}>
                <button type="button" className={css.channelAdd} disabled={!state.writable} onClick={() => { setPresetError(null); setPresetPickerOpen(true) }}>{t('channels.addProvider')}</button>
                <button type="button" className={css.channelAdd} disabled={!state.writable} onClick={() => {
                  const draft = newChannelDraft(undefined, channels)
                  props.channels.setChannels([...channels, draft])
                  setEditingId(draft.id)
                }}>{t('channels.addCustom')}</button>
              </div>
            )}
          </section>

          {editing !== undefined ? (
            <div className={css.body}>
              <div className={css.field}>
                <label className={css.label} htmlFor={`audiogen-name-${editing.id}`}>{t('channel.name')}</label>
                <input id={`audiogen-name-${editing.id}`} className={css.input} value={editName} onChange={event => setEditName(event.target.value)} />
              </div>
              <div className={css.field}>
                <label className={css.label} htmlFor={`audiogen-url-${editing.id}`}>{t('channel.apiUrl')}</label>
                <input id={`audiogen-url-${editing.id}`} className={css.input} value={editUrl} onChange={event => setEditUrl(event.target.value)} placeholder="https://…" />
              </div>
              <div className={css.field}>
                <label className={css.label} htmlFor={`audiogen-key-${editing.id}`}>{t('channel.apiKey')}</label>
                <input id={`audiogen-key-${editing.id}`} className={css.input} type="password" value={editKey} onChange={event => setEditKey(event.target.value)} placeholder={state.channels.keySet[editing.id] ? '••••••' : ''} />
                <p className={css.sectionHint}>{t('channel.apiKeyHint')}</p>
              </div>
              <div className={css.field}>
                <label className={css.label} htmlFor={`audiogen-models-${editing.id}`}>{t('channel.models')}</label>
                <textarea id={`audiogen-models-${editing.id}`} className={css.textarea} value={editModels} onChange={event => setEditModels(event.target.value)} />
                <p className={css.sectionHint}>{t('channel.modelsHint')}</p>
                <div className={css.channelAddRow}>
                  <button type="button" className={css.channelAdd} disabled={discovering || !state.writable} onClick={() => void discoverModels()}>
                    {discovering ? '获取中…' : '获取可用模型'}
                  </button>
                </div>
                {discoverError !== null ? <p className={css.failed}>{discoverError}</p> : null}
              </div>
              <label className={css.label}>
                <input type="checkbox" checked={editDefault} onChange={event => setEditDefault(event.target.checked)} /> {t('channel.default')}
              </label>
              <div className={css.footer}>
                <button type="button" className={css.discard} onClick={() => setEditingId(null)}>{t('channel.cancel')}</button>
                <button type="button" className={css.save} onClick={saveEdit}>{t('channel.save')}</button>
              </div>
            </div>
          ) : null}

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
