import { describe, expect, it, vi } from 'vitest'

import type { JobDefinition, JobRuntime } from '@platform/jobs'

import { notificationRetentionJobId, registerNotificationRetentionJob } from './notificationRetentionJob'

function createFakeJobRuntime(captured: {
  handler?: (payload: unknown, context: { log: (entry: { level: string; message: string }) => Promise<void> }) => Promise<void>
  schedule?: JobDefinition
}): JobRuntime {
  const runtime = {
    registerHandler: (handlerId: string, handler: typeof captured.handler) => {
      expect(handlerId).toBe(notificationRetentionJobId)
      captured.handler = handler
    },
    setSchedule: (definition: JobDefinition) => {
      captured.schedule = definition
    },
    removeSchedule: () => undefined
  }
  return runtime as unknown as JobRuntime
}

describe('notification retention job', () => {
  it('registers a platform job that runs on the reader time zone', () => {
    const captured: Parameters<typeof createFakeJobRuntime>[0] = {}
    registerNotificationRetentionJob(createFakeJobRuntime(captured), {
      runtime: () => ({ prune: async () => ({ removedRecords: 0 }) }),
      timeZone: () => 'Asia/Shanghai'
    })

    expect(captured.schedule?.id).toBe(notificationRetentionJobId)
    expect(captured.schedule?.owner).toBe('platform')
    expect(captured.schedule?.trigger).toEqual({
      kind: 'cron',
      expression: '40 3 * * *',
      timezone: 'Asia/Shanghai'
    })
  })

  it('prunes through the runtime and logs how many records went away', async () => {
    const captured: Parameters<typeof createFakeJobRuntime>[0] = {}
    const prune = vi.fn(async () => ({ removedRecords: 3 }))
    const log = vi.fn(async () => undefined)

    registerNotificationRetentionJob(createFakeJobRuntime(captured), {
      runtime: () => ({ prune }),
      timeZone: () => 'UTC'
    })
    await captured.handler!({}, { log })

    expect(prune).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledWith({ level: 'info', message: 'Notification retention: 3 record(s) removed.' })
  })

  it('resolves the runtime lazily so registration order does not matter', async () => {
    const captured: Parameters<typeof createFakeJobRuntime>[0] = {}
    const runtime = vi.fn(() => ({ prune: async () => ({ removedRecords: 0 }) }))

    registerNotificationRetentionJob(createFakeJobRuntime(captured), { runtime, timeZone: () => 'UTC' })
    expect(runtime).not.toHaveBeenCalled()

    await captured.handler!({}, { log: async () => undefined })
    expect(runtime).toHaveBeenCalledOnce()
  })
})
