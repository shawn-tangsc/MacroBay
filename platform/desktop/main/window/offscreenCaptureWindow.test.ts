import { describe, expect, it, vi } from 'vitest'

import { captureOffscreenWindow, type OffscreenWindow } from './offscreenCaptureWindow'

/** 假窗口：只实现被调用的那一面，并把每次调用记下来（守卫靠「有没有真的拆」而不是靠感觉）。 */
function fakeWindow(input: {
  loadFails?: boolean
  states: readonly (string | null)[]
  details?: readonly (string | null)[]
  measured?: { width: number; height: number } | null
  onCapture?: () => void
}) {
  const calls = { load: [] as string[], sizes: [] as [number, number][], captured: [] as { x: number; y: number; width: number; height: number }[], destroyed: 0, execute: [] as string[] }
  let stateIndex = 0
  let detailIndex = 0
  const window: OffscreenWindow = {
    async loadURL(url) {
      calls.load.push(url)
      if (input.loadFails === true) throw new Error('load')
    },
    async executeJavaScript<T>(code: string): Promise<T> {
      calls.execute.push(code)
      if (code.includes('getBoundingClientRect')) return (input.measured ?? null) as T
      if (code.includes('Error') || code.includes('errorAttributeTest')) {
        const value = input.details?.[detailIndex] ?? null
        detailIndex += 1
        return value as T
      }
      const value = input.states[Math.min(stateIndex, input.states.length - 1)] ?? null
      stateIndex += 1
      return value as T
    },
    setContentSize(width, height) {
      calls.sizes.push([width, height])
    },
    async capturePage(rect) {
      input.onCapture?.()
      calls.captured.push(rect)
      return { toPNG: () => new Uint8Array([137, 80, 78, 71]) }
    },
    destroy() {
      calls.destroyed += 1
    }
  }
  return { window, calls }
}

function base(input: { window: OffscreenWindow; budgetMs?: number; now?: () => number }) {
  return {
    createWindow: () => input.window,
    entryUrl: 'file:///app/index.html',
    query: { window: 'poster', date: '2026-11-20' },
    stateAttribute: 'posterState',
    errorAttribute: 'posterError',
    selector: '.mi-brief-poster',
    expectedWidth: 1080,
    pollMs: 1,
    wait: async () => undefined,
    ...(input.budgetMs === undefined ? {} : { budgetMs: input.budgetMs }),
    ...(input.now === undefined ? {} : { now: input.now })
  }
}

describe('offscreen capture window', () => {
  it('waits for the page to declare itself ready, then captures exactly the measured box', async () => {
    const { window, calls } = fakeWindow({
      states: [null, null, 'ready'],
      measured: { width: 1080, height: 1440 }
    })

    const outcome = await captureOffscreenWindow(base({ window }))

    expect(outcome).toMatchObject({ ok: true, width: 1080, height: 1440 })
    expect(calls.load[0]).toContain('window=poster')
    expect(calls.load[0]).toContain('date=2026-11-20')
    // 截图先改窗口尺寸（不然截到的是旧帧），再按量出来的框截。
    expect(calls.sizes).toEqual([[1080, 1440]])
    expect(calls.captured).toEqual([{ x: 0, y: 0, width: 1080, height: 1440 }])
    // 成功也要拆窗口：不拆就是一个看不见的泄漏。
    expect(calls.destroyed).toBe(1)
  })

  it('gives up at the budget and still destroys the window', async () => {
    let clock = 0
    const { window, calls } = fakeWindow({ states: [null] })

    const outcome = await captureOffscreenWindow(base({
      window,
      budgetMs: 15_000,
      now: () => { clock += 4_000; return clock }
    }))

    expect(outcome).toEqual({ ok: false, reason: 'timeout' })
    expect(calls.captured).toEqual([])
    expect(calls.destroyed).toBe(1)
  })

  it('takes the page\'s own failure reason instead of guessing', async () => {
    const { window, calls } = fakeWindow({ states: ['failed'], details: ['edition-missing'] })

    const outcome = await captureOffscreenWindow(base({ window }))

    expect(outcome).toEqual({ ok: false, reason: 'render-failed', detail: 'edition-missing' })
    expect(calls.captured).toEqual([])
    expect(calls.destroyed).toBe(1)
  })

  it('refuses to capture a page that laid out at the wrong width', async () => {
    const captureSpy = vi.fn()
    const { window, calls } = fakeWindow({
      states: ['ready'],
      measured: { width: 900, height: 1400 },
      onCapture: captureSpy
    })

    const outcome = await captureOffscreenWindow(base({ window }))

    expect(outcome).toEqual({ ok: false, reason: 'render-failed', detail: 'size-900x1400' })
    expect(captureSpy).not.toHaveBeenCalled()
    expect(calls.destroyed).toBe(1)
  })

  it('reports a load failure without capturing', async () => {
    const { window, calls } = fakeWindow({ loadFails: true, states: ['ready'] })

    const outcome = await captureOffscreenWindow(base({ window }))

    expect(outcome).toEqual({ ok: false, reason: 'load-failed' })
    expect(calls.captured).toEqual([])
    expect(calls.destroyed).toBe(1)
  })
})