import { describe, expect, it } from 'vitest'

import { createConcurrencyLock } from './concurrencyLock'

describe('concurrencyLock', () => {
  it('allows only one holder per key at a time', async () => {
    const lock = createConcurrencyLock()
    const order: string[] = []

    const first = lock.acquire('sync-key').then(async (release) => {
      order.push('first-start')
      await delay(30)
      order.push('first-end')
      release()
    })

    const second = lock.acquire('sync-key').then(async (release) => {
      order.push('second-start')
      release()
    })

    await Promise.all([first, second])
    expect(order).toEqual(['first-start', 'first-end', 'second-start'])
  })

  it('allows concurrent holders for different keys', async () => {
    const lock = createConcurrencyLock()
    const active = new Set<string>()

    const hold = async (key: string) => {
      const release = await lock.acquire(key)
      active.add(key)
      await delay(20)
      active.delete(key)
      release()
    }

    await Promise.all([hold('a'), hold('b')])
    expect(active.size).toBe(0)
  })

  it('reports whether a key is locked', async () => {
    const lock = createConcurrencyLock()
    const release = await lock.acquire('key')
    expect(lock.isLocked('key')).toBe(true)
    release()
    expect(lock.isLocked('key')).toBe(false)
  })

  it('rejects a queued acquire when the waiting signal aborts', async () => {
    const lock = createConcurrencyLock()
    const release = await lock.acquire('key')
    const controller = new AbortController()
    const acquireWithSignal = lock.acquire as unknown as (
      key: string,
      signal?: AbortSignal
    ) => Promise<() => void>

    let settled: 'resolved' | 'rejected' | null = null
    void acquireWithSignal('key', controller.signal).then(
      () => {
        settled = 'resolved'
      },
      () => {
        settled = 'rejected'
      }
    )

    controller.abort(new Error('Cancelled while waiting.'))
    await Promise.resolve()
    await Promise.resolve()

    expect(settled).toBe('rejected')
    release()
  })
})

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
