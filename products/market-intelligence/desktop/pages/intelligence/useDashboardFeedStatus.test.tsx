// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useDashboardFeedStatus } from './useDashboardFeedStatus'

const available = (sourceId: string) => ({ state: 'available' as const, sources: [{ sourceId, enabled: true, hasCredential: true }] })
const unavailable = { state: 'unavailable' as const }

let root: Root | undefined
afterEach(() => { act(() => root?.unmount()); root = undefined; vi.useRealTimers(); document.body.replaceChildren() })

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
}

/** 一个可控的读口：`next` 决定下一次查询返回什么；`now` 注入时钟。 */
function renderProbe(initial: unknown, clock: { ms: number }) {
  const calls = { reload: undefined as undefined | (() => void), state: undefined as ReturnType<typeof useDashboardFeedStatus> | undefined }
  const next = { value: initial }
  function Probe(): null {
    const state = useDashboardFeedStatus({
      client: { query: async () => next.value as never },
      now: () => clock.ms
    })
    calls.state = state
    calls.reload = state.reload
    return null
  }
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(createElement(Probe)))
  return { calls, next }
}

describe('source status table: last-good degradation window', () => {
  it('keeps the last good table after a failure, and stops after five refresh intervals', async () => {
    const clock = { ms: Date.parse('2026-11-11T08:00:00.000Z') }
    const { calls, next } = renderProbe(available('realmarketapi-market'), clock)
    await flush()
    expect(calls.state!.feedState).toBe('ready')

    // 失败一次：仍用上一次成功的表，并标记偏旧 + 给出成功时刻。
    next.value = unavailable
    act(() => calls.reload!())
    await flush()
    expect(calls.state!.feedState).toBe('failed')
    expect(calls.state!.feedStale).toBe(true)
    expect(calls.state!.feed).toBeDefined()
    expect(calls.state!.feedLastSuccessAtMs).toBe(clock.ms)

    // 超过 5 个刷新周期（refreshMs × 5）：停止沿用，整表按读不到处理。
    clock.ms += 60_000 * 5 + 1
    act(() => calls.reload!())
    await flush()
    expect(calls.state!.feedStale).toBe(false)
    expect(calls.state!.feed).toBeUndefined()

    // 恢复成功：标注消失。
    next.value = available('realmarketapi-market')
    act(() => calls.reload!())
    await flush()
    expect(calls.state!.feedState).toBe('ready')
    expect(calls.state!.feedStale).toBe(false)
  })

  it('never succeeded: no last-good table at all', async () => {
    const clock = { ms: Date.parse('2026-11-11T08:00:00.000Z') }
    const { calls } = renderProbe(unavailable, clock)
    await flush()
    expect(calls.state!.feedState).toBe('failed')
    expect(calls.state!.feedStale).toBe(false)
    expect(calls.state!.feed).toBeUndefined()
  })
})
