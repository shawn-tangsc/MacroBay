import { describe, expect, it, vi } from 'vitest'

import { createQuitOrchestrator, createRuntimeDisposer, QUIT_DISPOSE_BUDGET_MS } from './quit'

function fakeClock() {
  let now = 0
  const timers: Array<{ at: number; callback: () => void; id: number }> = []
  let nextId = 1
  return {
    setTimeout: (callback: () => void, ms: number) => {
      const id = nextId++
      timers.push({ at: now + ms, callback, id })
      return id
    },
    clearTimeout: (handle: unknown) => {
      const index = timers.findIndex((timer) => timer.id === handle)
      if (index >= 0) timers.splice(index, 1)
    },
    advance: (ms: number) => {
      now += ms
      for (const timer of [...timers].filter((entry) => entry.at <= now)) {
        timers.splice(timers.indexOf(timer), 1)
        timer.callback()
      }
    },
    pending: () => timers.length
  }
}

describe('quit orchestrator', () => {
  it('suspends the first quit, releases exactly one more, and prevents the default once per event', async () => {
    const clock = fakeClock()
    const quit = vi.fn()
    const dispose = vi.fn(async () => undefined)
    const orchestrator = createQuitOrchestrator({ dispose, quit, ...clock })
    const preventDefault = vi.fn()

    orchestrator.handleBeforeQuit({ preventDefault })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(quit).toHaveBeenCalledTimes(1)
    expect(orchestrator.isQuitting()).toBe(true)
    expect(orchestrator.isSettled()).toBe(true)
    expect(clock.pending()).toBe(0)
  })

  it('does not start a second cleanup chain on a repeated before-quit', async () => {
    const clock = fakeClock()
    const quit = vi.fn()
    let finish: () => void = () => undefined
    const dispose = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const orchestrator = createQuitOrchestrator({ dispose, quit, ...clock })
    const preventDefault = vi.fn()

    orchestrator.handleBeforeQuit({ preventDefault })
    orchestrator.handleBeforeQuit({ preventDefault })

    // 每次「当前这轮退出」都必须被挂起，否则清理未完成就真退了；链本身只起一条。
    expect(preventDefault).toHaveBeenCalledTimes(2)
    expect(dispose).toHaveBeenCalledTimes(1)
    finish()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(quit).toHaveBeenCalledTimes(1)

    // 放行之后再来的 before-quit 不再挂起（此时已无清理可等）。
    orchestrator.handleBeforeQuit({ preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(2)
  })

  it('escapes on the budget even when cleanup never settles, and cancels the escape on normal completion', async () => {
    const clock = fakeClock()
    const quit = vi.fn()
    const dispose = vi.fn(() => new Promise<void>(() => undefined))
    const orchestrator = createQuitOrchestrator({ dispose, quit, ...clock })

    orchestrator.handleBeforeQuit({ preventDefault: () => undefined })
    clock.advance(QUIT_DISPOSE_BUDGET_MS - 1)
    expect(quit).not.toHaveBeenCalled()
    clock.advance(1)
    expect(quit).toHaveBeenCalledTimes(1)

    const normalClock = fakeClock()
    const normalQuit = vi.fn()
    const normal = createQuitOrchestrator({ dispose: async () => undefined, quit: normalQuit, ...normalClock })
    normal.handleBeforeQuit({ preventDefault: () => undefined })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(normalClock.pending()).toBe(0)
    expect(normalQuit).toHaveBeenCalledTimes(1)
  })

  it('still quits exactly once when cleanup throws, without a second quit', async () => {
    const clock = fakeClock()
    const quit = vi.fn()
    const dispose = vi.fn(async () => {
      throw new Error('dispose-failed')
    })
    const orchestrator = createQuitOrchestrator({ dispose, quit, ...clock })

    orchestrator.handleBeforeQuit({ preventDefault: () => undefined })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(quit).toHaveBeenCalledTimes(1)
    expect(clock.pending()).toBe(0)
  })
})

describe('runtime disposer order', () => {
  it('keeps the shutdown chain ordered: mark closed, flush, timers, adapters, fence, jobs', async () => {
    const steps: string[] = []
    const disposer = createRuntimeDisposer({
      markProductIpcClosed: () => steps.push('mark-closed'),
      flushPanelWorkspaceLayout: async () => { steps.push('flush') },
      disposeMaintenanceTimers: [
        () => steps.push('timer-1'),
        () => steps.push('timer-2'),
        () => steps.push('timer-3')
      ],
      disposeAdapters: [
        async () => { steps.push('adapter-1') },
        async () => { steps.push('adapter-2') },
        async () => { steps.push('adapter-3') },
        async () => { steps.push('adapter-4') },
        async () => { steps.push('adapter-5') },
        async () => { steps.push('adapter-6') }
      ],
      fenceChannels: () => steps.push('fence'),
      stopTaskScheduler: () => steps.push('scheduler-stop'),
      stopJobs: () => steps.push('jobs-stop'),
      disposeProductServices: async () => { steps.push('product-disposers') },
      disposeAgentRuntimes: [async () => { steps.push('agent-runtime') }],
      disposeWorkspace: async () => ({ report: true }),
      reportWorkspaceDispose: () => steps.push('workspace-report'),
      closeJobRunStore: () => steps.push('close-store')
    })

    await disposer.dispose()

    expect(steps).toEqual([
      'mark-closed',
      'flush',
      'timer-1',
      'timer-2',
      'timer-3',
      'adapter-1',
      'adapter-2',
      'adapter-3',
      'adapter-4',
      'adapter-5',
      'adapter-6',
      'fence',
      'scheduler-stop',
      'jobs-stop',
      'product-disposers',
      'agent-runtime',
      'workspace-report',
      'close-store'
    ])
  })

  it('runs the cleanup once even when dispose is called twice', async () => {
    const closeJobRunStore = vi.fn()
    const disposer = createRuntimeDisposer({
      markProductIpcClosed: () => undefined,
      flushPanelWorkspaceLayout: async () => undefined,
      disposeMaintenanceTimers: [],
      disposeAdapters: [],
      fenceChannels: () => undefined,
      stopTaskScheduler: () => undefined,
      stopJobs: () => undefined,
      disposeProductServices: async () => undefined,
      disposeAgentRuntimes: [],
      disposeWorkspace: async () => undefined,
      reportWorkspaceDispose: () => undefined,
      closeJobRunStore
    })

    await Promise.all([disposer.dispose(), disposer.dispose()])

    expect(closeJobRunStore).toHaveBeenCalledTimes(1)
    expect(disposer.isDisposed()).toBe(true)
  })
})
