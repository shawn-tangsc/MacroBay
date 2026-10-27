import { describe, expect, it } from 'vitest'

import type { SampleModeClient, SampleModeState } from '../ipc/sampleModeClient'
import { createSampleModeSessionStore } from './sampleModeSessionStore'

const live: SampleModeState = { active: false, scenarioCount: 1 }
const sample: SampleModeState = {
  active: true,
  scenarioId: 's1',
  scenarioNow: '2026-10-24T20:00:00.000Z',
  locale: 'zh-CN',
  scenarioCount: 1
}

function client(initial: SampleModeState, next: SampleModeState = sample): SampleModeClient & { calls: boolean[] } {
  const calls: boolean[] = []
  return {
    calls,
    getState: async () => initial,
    setActive: async (active) => {
      calls.push(active)
      return active ? next : live
    }
  }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('sampleModeSessionStore', () => {
  it('loads once on the first subscriber', async () => {
    const fake = client(live)
    const store = createSampleModeSessionStore(fake)
    const unsubscribe = store.subscribe(() => undefined)
    await flush()

    expect(fake.calls).toEqual([])
    expect(store.getSnapshot()).toEqual({ view: live, busy: false })

    const second = store.subscribe(() => undefined)
    await flush()
    expect(store.getSnapshot().view).toEqual(live)
    unsubscribe()
    second()
  })

  it('serializes a toggle through the client and exposes busy while in flight', async () => {
    const fake = client(live)
    const store = createSampleModeSessionStore(fake)
    const unsubscribe = store.subscribe(() => undefined)
    await flush()

    const pending = store.setActive(true)
    expect(store.getSnapshot()).toEqual({ view: live, busy: true })
    await pending

    expect(fake.calls).toEqual([true])
    expect(store.getSnapshot()).toEqual({ view: sample, busy: false })
    unsubscribe()
  })

  it('does not optimistically flip on when the client fails', async () => {
    const fake: SampleModeClient = {
      getState: async () => live,
      setActive: async () => { throw new Error('ipc-failed') }
    }
    const store = createSampleModeSessionStore(fake)
    const unsubscribe = store.subscribe(() => undefined)
    await flush()

    await expect(store.setActive(true)).rejects.toThrow('sample-mode-set-active-failed')
    expect(store.getSnapshot()).toEqual({ view: live, busy: false })
    unsubscribe()
  })

  it('keeps the previous view when the client silently returns an inactive empty state', async () => {
    const store = createSampleModeSessionStore({
      getState: async () => live,
      setActive: async () => ({ active: false, scenarioCount: 0 })
    })
    const unsubscribe = store.subscribe(() => undefined)
    await flush()

    await store.setActive(true)
    expect(store.getSnapshot()).toEqual({ view: live, busy: false })
    unsubscribe()
  })
})
