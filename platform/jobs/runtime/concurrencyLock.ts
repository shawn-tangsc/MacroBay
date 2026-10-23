export type ConcurrencyLock = {
  acquire: (key: string, signal?: AbortSignal) => Promise<() => void>
  isLocked: (key: string) => boolean
}

type LockQueueEntry = {
  resolve: () => void
  reject: (reason?: unknown) => void
  signal?: AbortSignal
}

export function createConcurrencyLock(): ConcurrencyLock {
  const queues = new Map<string, LockQueueEntry[]>()
  const holders = new Set<string>()

  function release(key: string): void {
    const queue = queues.get(key)
    while (queue?.length) {
      const next = queue.shift()
      if (!next) continue
      if (next.signal?.aborted) {
        continue
      }
      next.resolve()
      if (!queue.length) queues.delete(key)
      return
    }

    if (!queue?.length) queues.delete(key)
    holders.delete(key)
  }

  return {
    async acquire(key, signal) {
      if (signal?.aborted) {
        throw signal.reason
      }
      if (!holders.has(key)) {
        holders.add(key)
        return () => release(key)
      }

      await new Promise<void>((resolve, reject) => {
        const queue = queues.get(key) ?? []
        const entry: LockQueueEntry = {
          resolve: () => {
            signal?.removeEventListener('abort', handleAbort)
            resolve()
          },
          reject: (reason) => {
            signal?.removeEventListener('abort', handleAbort)
            reject(reason)
          },
          signal
        }
        const handleAbort = () => {
          signal?.removeEventListener('abort', handleAbort)
          const currentQueue = queues.get(key)
          if (currentQueue) {
            const nextQueue = currentQueue.filter((candidate) => candidate !== entry)
            if (nextQueue.length > 0) {
              queues.set(key, nextQueue)
            } else {
              queues.delete(key)
            }
          }
          entry.reject(signal?.reason)
        }

        queue.push(entry)
        queues.set(key, queue)
        signal?.addEventListener('abort', handleAbort, { once: true })
      })

      if (signal?.aborted) {
        release(key)
        throw signal.reason
      }
      holders.add(key)
      return () => release(key)
    },
    isLocked(key) {
      return holders.has(key)
    }
  }
}
