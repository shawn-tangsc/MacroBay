import { describe, expect, it, vi } from 'vitest'
import type { JobRuntime } from '@platform/jobs'
import { registerDailyBriefSessionRetentionJob, dailyBriefSessionRetentionJobId } from './registerDailyBriefSessionRetentionJob'

function runtime() {
  let handler: (() => Promise<unknown>) | undefined
  const schedules: Array<Record<string, unknown>> = []
  return {
    runtime: { registerHandler: (_id: string, next: () => Promise<unknown>) => { handler = next }, setSchedule: (definition: Record<string, unknown>) => schedules.push(definition) } as unknown as JobRuntime,
    schedules,
    run: () => handler!()
  }
}

const links = (rows: Array<{ sessionId: string }>) => ({
  find: vi.fn(), put: vi.fn(), list: vi.fn(), remove: vi.fn(async () => undefined), listBefore: vi.fn(async () => rows)
} as never)

describe('daily brief session retention job', () => {
  it('schedules 08:10 local and deletes only the prune result', async () => {
    const { runtime: jobRuntime, schedules, run } = runtime()
    const linkStore = links([{ sessionId: 'old' }])
    const deleteSessions = vi.fn(async () => undefined)
    registerDailyBriefSessionRetentionJob(jobRuntime, { links: linkStore, deleteSessions, today: () => '2026-10-30', timeZone: () => 'Asia/Shanghai' })
    expect(schedules).toEqual([expect.objectContaining({ id: dailyBriefSessionRetentionJobId, trigger: { kind: 'cron', expression: '10 8 * * *', timezone: 'Asia/Shanghai' } })])
    await run()
    expect(deleteSessions).toHaveBeenCalledWith(['old'])
  })

  it('throws when platform deletion fails so the run is visible', async () => {
    const { runtime: jobRuntime, run } = runtime()
    registerDailyBriefSessionRetentionJob(jobRuntime, { links: links([{ sessionId: 'old' }]), deleteSessions: async () => { throw new Error('x') }, today: () => '2026-10-30', timeZone: () => 'Asia/Shanghai' })
    await expect(run()).rejects.toThrow('daily-brief-session-retention-failed')
  })
})
