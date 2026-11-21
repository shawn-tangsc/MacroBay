// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCoalescedRevision } from './useCoalescedRevision'

let root: Root | undefined

beforeEach(() => { vi.useFakeTimers() })
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  vi.useRealTimers()
  document.body.replaceChildren()
  setVisibility('visible')
})

describe('useCoalescedRevision', () => {
  it('collapses three events inside two seconds into one bump', async () => {
    const page = await render(0)
    await act(async () => { page.render(1) })
    await advance(1000)
    await act(async () => { page.render(2) })
    await advance(1000)
    await act(async () => { page.render(3) })
    // 安静窗口还没过去：一次都不许发。
    await advance(4000)
    expect(page.revision()).toBe(0)

    await advance(1000)
    expect(page.revision()).toBe(1)
  })

  it('never lets a continuous burst wait longer than 30 seconds, and lands one tail bump', async () => {
    const page = await render(0)
    // 每 1 秒一条，共 40 秒：尾随窗口永远被下一条推迟，只有 30 秒上限能发第一次。
    for (let source = 1; source <= 40; source += 1) {
      await act(async () => { page.render(source) })
      await advance(1000)
    }
    // 30 秒上限先发一次；连续事件把尾随窗口一直往后推，40 秒内不该再多发。
    const afterBurst = page.revision()
    expect(afterBurst).toBeGreaterThanOrEqual(1)
    expect(afterBurst).toBeLessThanOrEqual(2)

    // 最后一条之后安静 5 秒：尾部再合并一次。整段 40 秒的事件总量只值 2–3 次查询。
    await advance(5000)
    const total = page.revision()
    expect(total).toBe(afterBurst + 1)
    expect(total).toBeGreaterThanOrEqual(2)
    expect(total).toBeLessThanOrEqual(3)
  })

  it('only records pending while hidden, and catches up once when visible again', async () => {
    const page = await render(0)
    setVisibility('hidden')
    for (const value of [1, 2, 3]) {
      await act(async () => { page.render(value) })
    }
    await advance(40_000)
    expect(page.revision()).toBe(0)

    setVisibility('visible')
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(page.revision()).toBe(1)
  })
})

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

async function advance(ms: number): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

async function render(initial: number) {
  const container = document.createElement('div')
  document.body.append(container)
  const localRoot = createRoot(container)
  root = localRoot
  const renderWith = (sourceRevision: number): void => {
    localRoot.render(createElement(Probe, { sourceRevision }))
  }
  await act(async () => renderWith(initial))
  return {
    render: renderWith,
    revision: () => Number(container.querySelector('output')!.dataset.revision)
  }
}

function Probe({ sourceRevision }: { sourceRevision: number }) {
  const revision = useCoalescedRevision(sourceRevision)
  return createElement('output', { 'data-revision': String(revision) })
}
