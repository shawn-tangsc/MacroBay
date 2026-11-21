// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useDashboardSentimentOptionsCard } from './useDashboardSentimentOptionsCard'

/** 看板上恐惧贪婪的读门在合并卡之后只剩这一条复合查询；旧快照 hook 的六条行为挪到这里。 */
const asOf = '2026-08-06T00:00:00.000Z'
const timeZone = 'Asia/Shanghai'
let root: Root | undefined

afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren() })

describe('useDashboardSentimentOptionsCard', () => {
  it('re-asks the composite query when the reader retries, instead of reloading the page', async () => {
    const query = vi.fn()
      .mockRejectedValueOnce(new Error('request failed'))
      .mockResolvedValueOnce(card({ score: 30, bucket: 'fear' }))
    let reload: (() => void) | undefined
    const page = await renderHook(query, () => new Date(asOf), value => { reload = value })
    await flush()
    expect(page.state()).toBe('unavailable')

    await act(async () => { reload!() })
    await flush()
    expect(query).toHaveBeenCalledTimes(2)
    expect(page.state()).toBe('available')
  })

  it('captures one mount as-of and asks once for both halves', async () => {
    const query = vi.fn(async () => card({ score: 22, bucket: 'extreme-fear' }))
    const page = await renderHook(query, () => new Date(asOf))
    await flush()

    expect(query).toHaveBeenCalledWith({ asOf, timeZone, windowDays: 30 })
    expect(query).toHaveBeenCalledTimes(1)
    expect(page.state()).toBe('available')
  })

  it.each([
    ['throwing clock', () => { throw new Error('unsafe') }],
    ['invalid clock', () => new Date('invalid')]
  ])('fails closed with zero queries for a %s', async (_name, now) => {
    const query = vi.fn()
    const page = await renderHook(query, now as never)
    await flush()
    expect(query).not.toHaveBeenCalled()
    expect(page.state()).toBe('unavailable')
  })

  it('does not send a request at all while disabled, and reads once enabled', async () => {
    const query = vi.fn(async () => card({ score: 22, bucket: 'fear' }))
    const page = await renderHook(query, () => new Date(asOf), undefined, true)
    await flush()
    expect(query).not.toHaveBeenCalled()

    await act(async () => page.root.render(createElement(Harness, { client: { query }, now: () => new Date(asOf), disabled: false })))
    await flush()
    expect(query).toHaveBeenCalledTimes(1)
    expect(page.state()).toBe('available')
  })

  it('does not update after unmount', async () => {
    let resolve!: (value: unknown) => void
    const query = vi.fn(() => new Promise((done) => { resolve = done }))
    const page = await renderHook(query, () => new Date(asOf))
    await act(async () => page.root.unmount())
    resolve(card({ score: 22, bucket: 'extreme-fear' }))
    await flush()
    expect(page.container.textContent).toBe('')
  })

  it('does not recapture the clock or requery after a parent rerender', async () => {
    const query = vi.fn(async () => card())
    const initialNow = vi.fn(() => new Date(asOf))
    const page = await renderHook(query, initialNow)
    await flush()
    const replacementNow = vi.fn(() => new Date('2026-09-01T00:00:00.000Z'))
    await act(async () => page.root.render(createElement(Harness, { client: { query }, now: replacementNow, revision: 0 })))
    await flush()

    expect(initialNow).toHaveBeenCalledTimes(1)
    expect(replacementNow).not.toHaveBeenCalled()
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('keeps one request in flight and re-reads exactly once after it settles', async () => {
    let resolve!: (value: unknown) => void
    const query = vi.fn(() => new Promise((done) => { resolve = done }))
    const page = await renderHook(query, () => new Date(asOf))
    expect(query).toHaveBeenCalledTimes(1)

    // 首帧还在飞，这时来两条「数据变了」：并发度仍是 1，不多发。
    await act(async () => page.root.render(createElement(Harness, { client: { query }, now: () => new Date(asOf), revision: 1 })))
    await act(async () => page.root.render(createElement(Harness, { client: { query }, now: () => new Date(asOf), revision: 2 })))
    expect(query).toHaveBeenCalledTimes(1)

    await act(async () => { resolve(card({ score: 22, bucket: 'fear' })); await Promise.resolve() })
    await flush()
    // 挂起落地后只补一次，不按事件条数累加。
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('keeps the last reading when a background re-read fails, without loading or retrying', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce(card({ score: 22, bucket: 'fear' }))
      .mockRejectedValueOnce(new Error('request failed'))
    const page = await renderHook(query, () => new Date(asOf))
    await flush()
    expect(page.state()).toBe('available')

    await act(async () => page.root.render(createElement(Harness, { client: { query }, now: () => new Date(asOf), revision: 1 })))
    await flush()
    expect(page.state()).toBe('available')
    expect(query).toHaveBeenCalledTimes(2)
    // 不自动重试：再给一轮时间，调用次数不变。
    await flush()
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('fails closed when the client throws', async () => {
    const page = await renderHook(async () => { throw new Error('secret failure') }, () => new Date(asOf))
    await flush()
    expect(page.state()).toBe('unavailable')
  })
})

function card(overrides: { score?: number; bucket?: 'extreme-fear' | 'fear' | 'neutral' | 'greed' | 'extreme-greed' } = {}) {
  return {
    asOf, windowDays: 30, timeZone,
    fearGreed: {
      state: 'available', score: overrides.score ?? 22, bucket: overrides.bucket ?? 'neutral',
      observedAt: '2026-08-06T10:00:00.000Z', latestDay: '2026-08-05', daysAgo: 1, stale: false,
      seriesStart: '2025-08-06', points: []
    },
    optionSkew: { state: 'not-connected' }
  }
}

async function renderHook(
  query: (input: { asOf: string; timeZone: string; windowDays: number }) => Promise<unknown>,
  now: () => Date,
  onReady?: (reload: () => void) => void,
  disabled = false,
  revision = 0
) {
  const container = document.createElement('div'); document.body.append(container)
  const localRoot = createRoot(container); root = localRoot
  await act(async () => localRoot.render(createElement(Harness, { client: { query }, now, onReady, disabled, revision })))
  return { root: localRoot, container, state: () => container.querySelector('output')!.dataset.state! }
}

function Harness({ client, now, onReady, disabled = false, revision }: {
  client: { query: (input: { asOf: string; timeZone: string; windowDays: number }) => Promise<unknown> }
  now: () => Date
  onReady?: (reload: () => void) => void
  disabled?: boolean
  revision?: number
}) {
  const { state, reload } = useDashboardSentimentOptionsCard({ client: client as never, now, timeZone, disabled, revision })
  onReady?.(reload)
  return createElement('output', { 'data-state': state.state })
}

async function flush(): Promise<void> { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }) }
