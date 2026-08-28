/**
 * The AI 音频 panel shell: header with 生成 / 资源库 tabs, toast host, and
 * cross-tab hooks (library refresh after saves, «use this voice» reuse).
 */

import { useRef, useState } from 'react'
import type { AudiogenApi } from './api.ts'
import type { AudiogenScope } from './settings-scope.ts'
import { tt } from './helpers.ts'
import { GridIcon, ListIcon } from './icons.tsx'
import { StudioView, type StudioReuse } from './studio-view.tsx'
import { LibraryView } from './library-view.tsx'
import css from './audio-panel.module.css'

type Tab = 'studio' | 'library'

export function AudioGenPanel(props: { api: AudiogenApi; scope: AudiogenScope }) {
  const { api, scope } = props
  const [tab, setTab] = useState<Tab>('studio')
  const [libraryRev, setLibraryRev] = useState(0)
  const [reuse, setReuse] = useState<StudioReuse | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const showToast = (text: string): void => {
    setToast(text)
    if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2400)
  }

  return (
    <div className={css.panel}>
      <header className={css.header}>
        <h2 className={css.title}>{tt('panel.title')}</h2>
        <div className={css.tabs} role="tablist" aria-label="AI 音频">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'studio'}
            className={css.tab}
            data-active={tab === 'studio' ? 'true' : 'false'}
            onClick={() => setTab('studio')}
          >
            <GridIcon /> {tt('tab.studio')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'library'}
            className={css.tab}
            data-active={tab === 'library' ? 'true' : 'false'}
            onClick={() => setTab('library')}
          >
            <ListIcon /> {tt('tab.library')}
          </button>
        </div>
      </header>

      {tab === 'studio' ? (
        <StudioView
          api={api}
          scope={scope}
          reuse={reuse}
          onLibraryChanged={() => setLibraryRev(revision => revision + 1)}
          showToast={showToast}
        />
      ) : (
        <LibraryView
          api={api}
          revision={libraryRev}
          showToast={showToast}
          onReuseVoice={payload => {
            setReuse({ nonce: Date.now(), mode: payload.mode, ...(payload.voice === undefined ? {} : { voice: payload.voice }), ...(payload.voiceId === undefined ? {} : { voiceId: payload.voiceId }), ...(payload.model === undefined ? {} : { model: payload.model }) })
            setTab('studio')
          }}
        />
      )}

      {toast !== null ? <div className={css.toast} role="status">{toast}</div> : null}
    </div>
  )
}
