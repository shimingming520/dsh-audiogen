/**
 * Global generation budget: a FIFO semaphore shared by every upstream audio
 * call (panel routes and the Agent tool). The limit comes from the plugin
 * setting 「最大并发生成数」(default 5): a 3-model compare task takes 3 slots,
 * other tasks queue or run concurrently up to the same cap.
 *
 * Acquire resolves with a release function once a slot is free; aborting the
 * signal while queued rejects immediately (no slot is occupied).
 */

export interface GenerationBudget {
  /** Wait for a free slot; resolves with the release function. */
  acquire(signal?: AbortSignal): Promise<() => void>
}

export function createGenerationBudget(limit: () => number): GenerationBudget {
  let active = 0
  const waiting: Array<{
    resolve: (release: () => void) => void
    reject: (reason: unknown) => void
    signal?: AbortSignal
    cleanup?: () => void
  }> = []

  const clampLimit = (): number => {
    const raw = Number(limit())
    if (!Number.isFinite(raw) || raw < 1) return 5
    return Math.min(20, Math.floor(raw))
  }

  const pump = (): void => {
    const max = clampLimit()
    while (active < max && waiting.length > 0) {
      const entry = waiting.shift()!
      if (entry.signal?.aborted === true) {
        entry.reject(new DOMException('The operation was aborted.', 'AbortError'))
        continue
      }
      entry.cleanup?.()
      active += 1
      let released = false
      entry.resolve(() => {
        if (released) return
        released = true
        active = Math.max(0, active - 1)
        pump()
      })
    }
  }

  const acquire = (signal?: AbortSignal): Promise<() => void> => new Promise<() => void>((resolve, reject) => {
    const entry: { resolve: (release: () => void) => void; reject: (reason: unknown) => void; signal?: AbortSignal; cleanup?: () => void } = { resolve, reject, signal }
    const onAbort = (): void => {
      const index = waiting.indexOf(entry)
      if (index < 0) return // 已在运行：由调用方的 signal 中断上游请求
      waiting.splice(index, 1)
      entry.cleanup = undefined
      reject(new DOMException('The operation was aborted.', 'AbortError'))
    }
    entry.cleanup = () => { signal?.removeEventListener('abort', onAbort) }
    if (signal !== undefined) {
      if (signal.aborted === true) {
        reject(new DOMException('The operation was aborted.', 'AbortError'))
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }
    waiting.push(entry)
    pump()
  })

  return { acquire }
}
