import { describe, expect, it, vi } from 'vitest'

import type { JobRuntime } from '@platform/jobs'

import { eventBusRetentionJobId, registerEventBusRetentionJob } from './eventBusRetentionJob'

type Captured = {
  handler?: (payload: unknown, context: { log: (entry: { level: string; message: string }) => Promise<void> }) => Promise<void>
  definition?: Record<string, unknown>
}

function createFakeJobRuntime(captured: Captured): JobRuntime {
  return {
    registerHandler: (handlerId: string, handler: unknown) => {
      expect(handlerId).toBe(eventBusRetentionJobId)
      captured.handler = handler as Captured['handler']
    },
    setSchedule: (definition: unknown) => {
      captured.definition = definition as Record<string, unknown>
    }
  } as unknown as JobRuntime
}

describe('event bus retention job', () => {
  it('registers a daily internal job in the reader time zone', () => {
    const captured: Captured = {}
    registerEventBusRetentionJob(createFakeJobRuntime(captured), {
      eventBus: () => ({ pruneRetained: async () => ({ removedEvents: 0, removedDeliveries: 0 }) }),
      timeZone: () => 'Asia/Shanghai'
    })

    expect(captured.definition).toMatchObject({
      id: eventBusRetentionJobId,
      owner: 'platform',
      handlerId: eventBusRetentionJobId,
      audience: 'internal',
      trigger: { kind: 'cron', expression: '55 3 * * *', timezone: 'Asia/Shanghai' }
    })
  })

  it('prunes through the runtime thunk lazily and logs both counts separately', async () => {
    const captured: Captured = {}
    const pruneRetained = vi.fn(async () => ({ removedEvents: 12, removedDeliveries: 3 }))
    const eventBus = vi.fn(() => ({ pruneRetained }))
    const log = vi.fn(async () => undefined)

    registerEventBusRetentionJob(createFakeJobRuntime(captured), { eventBus, timeZone: () => 'UTC' })
    // 注册阶段不碰运行时：实例是懒构造的，注册时它可能还不存在。
    expect(eventBus).not.toHaveBeenCalled()

    await captured.handler!({}, { log })

    expect(eventBus).toHaveBeenCalledOnce()
    expect(pruneRetained).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledWith({
      level: 'info',
      message: 'Event bus retention: 12 event(s), 3 delivery record(s) removed.'
    })
  })
})
