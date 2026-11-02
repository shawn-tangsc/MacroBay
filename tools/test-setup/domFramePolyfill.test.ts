import { describe, expect, it, vi } from 'vitest'

import { ensureAnimationFrame, type AnimationFrameScope } from './domFramePolyfill'

/** 只做一次「空环境」的搭建，避免动到真正运行的 globalThis。 */
function emptyScope(): AnimationFrameScope & { timers: Map<number, () => void> } {
  const timers = new Map<number, () => void>()
  let nextTimer = 1
  return {
    timers,
    setTimeout: (handler) => {
      const handle = nextTimer
      nextTimer += 1
      // 真的 setTimeout 触发后自己就没了；假定时器也要照这个行为，否则测的是假环境。
      timers.set(handle, () => {
        timers.delete(handle)
        handler()
      })
      return handle
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number)
    }
  }
}

/** 触发所有到期定时器（快照后执行：伪造的定时器会在触发时把自己删掉）。 */
function runTimers(scope: { timers: Map<number, () => void> }): void {
  for (const run of [...scope.timers.values()]) run()
}

describe('ensureAnimationFrame', () => {
  it('installs a frame loop where the environment has none', () => {
    const scope = emptyScope()

    expect(ensureAnimationFrame(scope)).toBe(true)
    expect(typeof scope.requestAnimationFrame).toBe('function')
    expect(typeof scope.cancelAnimationFrame).toBe('function')
  })

  it('runs the callback on the next tick and passes a timestamp', () => {
    const scope = emptyScope()
    ensureAnimationFrame(scope)
    const callback = vi.fn()

    const handle = scope.requestAnimationFrame!(callback)

    expect(callback).not.toHaveBeenCalled()
    runTimers(scope)
    expect(callback).toHaveBeenCalledTimes(1)
    expect(typeof callback.mock.calls[0]![0]).toBe('number')
    expect(scope.timers.size).toBe(0)
    // 句柄仍然可被取消，且取消一个已完成的帧不会抛错。
    expect(() => scope.cancelAnimationFrame!(handle)).not.toThrow()
  })

  it('cancels a pending frame and never calls its callback', () => {
    const scope = emptyScope()
    ensureAnimationFrame(scope)
    const callback = vi.fn()

    const handle = scope.requestAnimationFrame!(callback)
    scope.cancelAnimationFrame!(handle)
    runTimers(scope)

    expect(callback).not.toHaveBeenCalled()
    expect(scope.timers.size).toBe(0)
  })

  it('leaves an environment that already has one completely alone', () => {
    // 浏览器 / happy-dom / jsdom 自己就有实现：替换成 setTimeout 会把别人的时序改成另一种行为。
    const existingRequest = vi.fn(() => 7)
    const existingCancel = vi.fn()
    const scope = { ...emptyScope(), requestAnimationFrame: existingRequest, cancelAnimationFrame: existingCancel }

    expect(ensureAnimationFrame(scope)).toBe(false)
    expect(scope.requestAnimationFrame).toBe(existingRequest)
    expect(scope.cancelAnimationFrame).toBe(existingCancel)
  })
})
