/**
 * Audio panel controller: the single owner of the panel's open/closed state.
 * Framework-free so the DOM mounts and the React panel share one tiny
 * subscription surface.
 */

export interface AudioGenControllerSnapshot {
  panelOpen: boolean
}

export class AudioGenController {
  private panelOpen = false
  private listeners = new Set<() => void>()

  getSnapshot(): AudioGenControllerSnapshot {
    return { panelOpen: this.panelOpen }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  open(): void {
    if (this.panelOpen) return
    this.panelOpen = true
    this.notify()
  }

  close(): void {
    if (!this.panelOpen) return
    this.panelOpen = false
    this.notify()
  }

  toggle(): void {
    if (this.panelOpen) this.close()
    else this.open()
  }

  private notify(): void {
    for (const fn of [...this.listeners]) fn()
  }
}
