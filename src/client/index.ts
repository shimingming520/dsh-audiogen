/**
 * Browser-half entry for dsh-audiogen.
 *
 * Registers locale dictionaries, the settings card (Settings → Plugins → AI
 * 音频), and mounts the sidebar entry + generation panel. DOM mounting
 * failures are logged, never thrown.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { AudiogenApi } from './api.ts'
import { AudioGenController } from './controller.ts'
import { tt } from './helpers.ts'
import { en, zh, type AudioGenKey } from './locales.ts'
import { mountPanel } from './mount.tsx'
import { mountSidebarEntry } from './sidebar-entry.ts'
import { AudioGenSettingsCard, AudioGenSettingsCardController } from './SettingsCard.tsx'
import { bindAudiogenScope, type AudiogenScope } from './settings-scope.ts'
import { registerAudioToolviews } from './audio-toolview.tsx'

const NS = 'dsh-audiogen'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dsh-audiogen': AudioGenKey
  }
}

export const inject = ['slots', 'locale', 'connection', 'sessions']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-audiogen: dictionaries')
  registerAudioToolviews(ctx)

  const connection = ctx.get('connection') as ConnectionHandle | undefined
  const loopback = connection?.isLoopback === true
  const scope: AudiogenScope = bindAudiogenScope(loopback
    ? (input, init) => fetch(input, init)
    : () => { throw new Error('settings bridge is loopback-only') })

  ctx.effect(() => {
    const disposers = [
      ctx.on('connection/reset', () => { void scope.load() }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'dsh-audiogen: settings scope invalidation')

  const settingsCard = new AudioGenSettingsCardController(scope)
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: 'dsh-audiogen',
    locale: NS,
    inject: () => settingsCard.inject(),
  }, AudioGenSettingsCard))

  let uiDisposer: (() => void) | undefined
  const mountUi = (): void => {
    if (uiDisposer !== undefined) return
    const controller = new AudioGenController()
    const api = new AudiogenApi()
    const disposers: Array<() => void> = []
    try {
      disposers.push(mountSidebarEntry(controller, tt('entry.label'), tt('entry.tooltip')))
      disposers.push(mountPanel(controller, api, scope))
    } catch (error) {
      console.warn('[dsh-audiogen] mount failed:', error)
    }
    uiDisposer = () => {
      for (const dispose of disposers.splice(0)) dispose()
      uiDisposer = undefined
    }
  }
  const syncEnabled = (): void => {
    const snapshot = scope.getSnapshot()
    const enabled = snapshot.status === 'ready'
      ? snapshot.value?.enabled ?? true
      : snapshot.status === 'unavailable'
    if (enabled) mountUi()
    else uiDisposer?.()
  }
  scope.subscribe(syncEnabled)
  syncEnabled()
}
