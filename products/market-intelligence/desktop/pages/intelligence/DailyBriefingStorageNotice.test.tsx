// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import { DailyBriefingStorageNotice } from './DailyBriefingStorageNotice'

const text = {
  incomplete: '日报数据升级未完成，现在用的是旧数据。其余功能正常，升级完成后新功能会自动可用。',
  retry: '重试升级',
  retrying: '正在重试…'
}

type StorageState = Awaited<ReturnType<DailyBriefingClient['getStorageState']>>

function fakeClient(read: StorageState, retry: StorageState = { state: 'ready' }): Pick<DailyBriefingClient, 'getStorageState' | 'retryUpgrade'> {
  return {
    getStorageState: vi.fn(async () => read),
    retryUpgrade: vi.fn(async () => retry)
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const flush = async (): Promise<void> => {
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
}

describe('daily briefing storage notice', () => {
  it('shows the visible sentence and retries the upgrade without hiding the state', async () => {
    let finishRetry: ((value: StorageState) => void) | undefined
    const client = {
      getStorageState: vi.fn(async (): Promise<StorageState> => ({ state: 'incomplete', reason: 'backup-failed' })),
      retryUpgrade: vi.fn(() => new Promise<StorageState>((resolve) => { finishRetry = resolve }))
    }
    act(() => { root.render(<DailyBriefingStorageNotice text={text} client={client} />) })
    await flush()

    // The sentence is on the page, not behind a help icon, and it says which state this is.
    expect(host.textContent).toContain(text.incomplete)
    expect(host.querySelector('[data-storage-upgrade="incomplete"]')).not.toBeNull()

    const button = [...host.querySelectorAll('button')].find((element) => element.textContent === text.retry)
    expect(button).toBeDefined()
    act(() => { button?.click() })
    await flush()
    // Pressing once says it is retrying and cannot be pressed again.
    expect(host.textContent).toContain(text.retrying)
    expect([...host.querySelectorAll('button')][0]?.disabled).toBe(true)

    act(() => { finishRetry?.({ state: 'ready' }) })
    await flush()
    expect(host.textContent).toBe('')
  })

  it('keeps the notice when a retry comes back without a finished upgrade', async () => {
    const client = fakeClient({ state: 'incomplete', reason: 'migration-failed' }, { state: 'incomplete', reason: 'migration-failed' })
    act(() => { root.render(<DailyBriefingStorageNotice text={text} client={client} />) })
    await flush()
    const button = [...host.querySelectorAll('button')][0]
    act(() => { button?.click() })
    await flush()
    expect(host.textContent).toContain(text.incomplete)
  })

  it('says nothing when the upgrade ran, and nothing when the state could not be read', async () => {
    act(() => { root.render(<DailyBriefingStorageNotice text={text} client={fakeClient({ state: 'ready' })} />) })
    await flush()
    expect(host.textContent).toBe('')

    act(() => { root.render(<DailyBriefingStorageNotice text={text} client={fakeClient({ state: 'unavailable' })} />) })
    await flush()
    expect(host.textContent).toBe('')
  })
})
