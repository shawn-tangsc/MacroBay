import { describe, expect, it, vi } from 'vitest'

import type { JobDefinition, JobRuntime } from '@platform/jobs'

import { cacheAuditRetentionJobId, registerCacheAuditRetentionJob } from './cacheAuditRetentionJob'

function createFakeJobRuntime(captured: {
  handler?: (payload: unknown, context: { log: (entry: { level: string; message: string }) => Promise<void> }) => Promise<void>
  schedule?: JobDefinition
}): JobRuntime {
  return {
    registerHandler: (handlerId: string, handler: typeof captured.handler) => {
      expect(handlerId).toBe(cacheAuditRetentionJobId)
      captured.handler = handler
    },
    setSchedule: (definition: JobDefinition) => {
      captured.schedule = definition
    },
    removeSchedule: () => undefined
  } as unknown as JobRuntime
}

describe('cache audit retention job', () => {
  it('registers a platform job that runs on the reader time zone', () => {
    const captured: Parameters<typeof createFakeJobRuntime>[0] = {}
    registerCacheAuditRetentionJob(createFakeJobRuntime(captured), {
      audit: () => ({ pruneAudit: async () => ({ removedByAge: 0, removedByCount: 0 }) }),
      timeZone: () => 'Asia/Shanghai'
    })

    expect(captured.schedule?.id).toBe(cacheAuditRetentionJobId)
    expect(captured.schedule?.owner).toBe('platform')
    expect(captured.schedule?.handlerId).toBe(cacheAuditRetentionJobId)
    expect(captured.schedule?.trigger).toEqual({
      kind: 'cron',
      expression: '50 3 * * *',
      timezone: 'Asia/Shanghai'
    })
  })

  it('prunes through the repository and logs both limits separately', async () => {
    // 两组数分开记：只说「删了 900 条」说不清是被时间清掉还是被条数上限挤掉。
    const captured: Parameters<typeof createFakeJobRuntime>[0] = {}
    const pruneAudit = vi.fn(async () => ({ removedByAge: 2, removedByCount: 7 }))
    const log = vi.fn(async () => undefined)

    registerCacheAuditRetentionJob(createFakeJobRuntime(captured), {
      audit: () => ({ pruneAudit }),
      timeZone: () => 'UTC'
    })
    await captured.handler!({}, { log })

    expect(pruneAudit).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledWith({
      level: 'info',
      message: 'Cache audit retention: 2 record(s) removed by age, 7 by count.'
    })
  })

  it('resolves the repository lazily so registration order does not matter', async () => {
    const captured: Parameters<typeof createFakeJobRuntime>[0] = {}
    const audit = vi.fn(() => ({ pruneAudit: async () => ({ removedByAge: 0, removedByCount: 0 }) }))

    registerCacheAuditRetentionJob(createFakeJobRuntime(captured), { audit, timeZone: () => 'UTC' })
    // 注册时不该碰仓储：任务运行时更早创建，仓储在装配阶段才构造。
    expect(audit).not.toHaveBeenCalled()

    await captured.handler!({}, { log: async () => undefined })
    expect(audit).toHaveBeenCalledOnce()
  })
})
