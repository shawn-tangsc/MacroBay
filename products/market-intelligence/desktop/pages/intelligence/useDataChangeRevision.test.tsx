// @vitest-environment happy-dom
import { act, createElement, useEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ProductEventSubscribe } from '../../shared/ipc/intelligenceDataChangedClient'
import { dataChangeFallbackIntervalMs, useDataChangeRevision } from './useDataChangeRevision'

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.useRealTimers()
  Reflect.deleteProperty(document, 'visibilityState')
})

type Harness = {
  listeners: Array<(data: unknown) => void>
  subscribe: ProductEventSubscribe
  /** 读口侧「重读了几轮」——按 revision 变化触发，与真宿主里那个 effect 同形。 */
  rounds: () => number
}

async function render(panel: 'dashboard' | 'economic-calendar'): Promise<Harness> {
  vi.useFakeTimers()
  const listeners: Array<(data: unknown) => void> = []
  const subscribe: ProductEventSubscribe = (_productId, _event, listener) => {
    listeners.push(listener)
    return () => { listeners.splice(listeners.indexOf(listener), 1) }
  }
  let rounds = 0

  function Probe(): null {
    const revision = useDataChangeRevision({ panel, subscribe })
    const seen = useRef(revision)
    useEffect(() => {
      // 首次挂载不算一轮重读：与各读口「首读」和「后台重读」的区分一致。
      if (seen.current === revision) return
      seen.current = revision
      rounds += 1
    }, [revision])
    return null
  }

  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => { root!.render(createElement(Probe)) })
  return { listeners, subscribe, rounds: () => rounds }
}

function deliver(harness: Harness, payload: unknown): void {
  act(() => { harness.listeners.forEach(listener => listener(payload)) })
}

describe('useDataChangeRevision', () => {
  it('re-reads once for a dashboard write and ignores the other panel', async () => {
    const harness = await render('dashboard')

    deliver(harness, { panels: ['economic-calendar'], sources: ['macro-calendar-0xrouter-economic-data'] })
    expect(harness.rounds()).toBe(0)

    deliver(harness, { panels: ['dashboard'], sources: ['alternative-fear-greed'] })
    expect(harness.rounds()).toBe(1)
  })

  it('does not start a second round when the same event is delivered twice in one batch', async () => {
    const harness = await render('dashboard')

    // 两次投递同一次渲染：读口只会重读一轮（同一个 revision），不会发起两路并发读。
    act(() => {
      harness.listeners.forEach(listener => listener({ panels: ['dashboard'], sources: ['a'] }))
      harness.listeners.forEach(listener => listener({ panels: ['dashboard'], sources: ['a'] }))
    })

    expect(harness.rounds()).toBe(1)
  })

  it('keeps a five-minute fallback only while the page is visible', async () => {
    let visibility: 'visible' | 'hidden' = 'visible'
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility })
    const harness = await render('dashboard')

    await act(async () => { vi.advanceTimersByTime(dataChangeFallbackIntervalMs) })
    expect(harness.rounds()).toBe(1)

    // 切到后台：连表都停掉，5 分钟过去也不该重读。
    visibility = 'hidden'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { vi.advanceTimersByTime(dataChangeFallbackIntervalMs * 2) })
    expect(harness.rounds()).toBe(1)

    // 回到前台：兜底重新开始走。
    visibility = 'visible'
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { vi.advanceTimersByTime(dataChangeFallbackIntervalMs) })
    expect(harness.rounds()).toBe(2)
  })

  it('stops listening once the page unmounts', async () => {
    const harness = await render('dashboard')
    expect(harness.listeners).toHaveLength(1)

    await act(async () => root?.unmount())
    root = undefined

    expect(harness.listeners).toHaveLength(0)
  })
})
