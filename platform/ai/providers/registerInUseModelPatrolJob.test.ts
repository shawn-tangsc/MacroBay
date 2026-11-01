import { describe, expect, it, vi } from 'vitest'

import {
  inUseModelPatrolJobId,
  registerInUseModelPatrolHandler,
  syncInUseModelPatrolSchedule
} from './registerInUseModelPatrolJob'

function stubRuntime() {
  return {
    setSchedule: vi.fn(),
    removeSchedule: vi.fn(),
    registerHandler: vi.fn()
  }
}

describe('in-use model patrol job', () => {
  it('registers the schedule only while there is something to probe', async () => {
    const runtime = stubRuntime()
    let ready = false

    await syncInUseModelPatrolSchedule(runtime as never, { isReady: async () => ready })
    expect(runtime.removeSchedule).toHaveBeenCalledWith(inUseModelPatrolJobId)
    expect(runtime.setSchedule).not.toHaveBeenCalled()

    ready = true
    await syncInUseModelPatrolSchedule(runtime as never, { isReady: async () => ready })
    expect(runtime.setSchedule).toHaveBeenCalledTimes(1)
    expect(runtime.setSchedule.mock.calls[0]?.[0]).toMatchObject({
      id: inUseModelPatrolJobId,
      trigger: { kind: 'cron' }
    })
  })

  it('removes the schedule when readiness goes away', async () => {
    const runtime = stubRuntime()
    await syncInUseModelPatrolSchedule(runtime as never, { isReady: async () => false })

    // 「永久注册 + handler 过滤」是被禁止的形状：没有目标时排期本身必须消失。
    expect(runtime.removeSchedule).toHaveBeenCalledWith(inUseModelPatrolJobId)
    expect(runtime.setSchedule).not.toHaveBeenCalled()
  })

  it('runs the patrol from the handler and logs the outcome', async () => {
    const runtime = stubRuntime()
    const runOnce = vi.fn(async () => [])
    registerInUseModelPatrolHandler(runtime as never, { patrol: { runOnce } })

    const handler = runtime.registerHandler.mock.calls[0]?.[1] as (
      payload: unknown,
      context: { log: (entry: unknown) => Promise<void> }
    ) => Promise<void>
    const log = vi.fn(async () => undefined)
    await handler({}, { log })

    expect(runOnce).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalled()
  })
})
