import { describe, expect, it, vi } from 'vitest'

import { narwhalCalendarSweepPolicy, narwhalCalendarTickPolicy } from './narwhalCalendarJob'
import { createNarwhalCalendarScheduler } from './narwhalCalendarScheduler'

const runtime = { run: vi.fn(async () => ({ collector: { state: 'completed', pages: 1, releases: 0 }, firstPublishedCaptured: 0 })) } as never

const schedulerFor = (options: Readonly<{ hasCredential?: boolean; readerEnabled?: () => boolean | undefined }> = {}) => {
  const jobRuntime = { registerHandler: vi.fn(), setSchedule: vi.fn(), removeSchedule: vi.fn(), enqueueDefinition: vi.fn() }
  const scheduler = createNarwhalCalendarScheduler({
    jobRuntime, runtime, now: () => Date.parse('2026-11-13T00:00:00Z'),
    hasCredential: () => options.hasCredential ?? true,
    ...(options.readerEnabled === undefined ? {} : { readerEnabled: options.readerEnabled })
  })
  return { scheduler, jobRuntime }
}

describe('narwhal calendar scheduler', () => {
  it('registers both definitions while the reader switch is still locked (pending)', () => {
    const { scheduler, jobRuntime } = schedulerFor()
    scheduler.initialize()
    const ids = jobRuntime.setSchedule.mock.calls.map(call => (call[0] as { id: string }).id)
    expect(ids).toEqual([narwhalCalendarTickPolicy.definitionId, narwhalCalendarSweepPolicy.definitionId])
    expect(jobRuntime.removeSchedule).not.toHaveBeenCalled()
    // 作业身份来自源自己：payload.sourceId 必须是新 id。
    expect((jobRuntime.setSchedule.mock.calls[0]![0] as { payload: { sourceId: string } }).payload.sourceId).toBe('macro-calendar-narwhal-economic-data')
  })

  it('registers nothing without a credential — no key, no requests, no job', () => {
    const { scheduler, jobRuntime } = schedulerFor({ hasCredential: false })
    scheduler.initialize()
    expect(jobRuntime.setSchedule).not.toHaveBeenCalled()
    expect(jobRuntime.removeSchedule.mock.calls.map(call => call[0])).toEqual([narwhalCalendarTickPolicy.definitionId, narwhalCalendarSweepPolicy.definitionId])
  })

  it('does not look at the reader profile while it is still locked', () => {
    // 锁着的时候 readerEnabled 返回 undefined：不参与判断，作业照注册。
    const { scheduler, jobRuntime } = schedulerFor({ readerEnabled: () => undefined })
    scheduler.initialize()
    expect(jobRuntime.setSchedule).toHaveBeenCalledTimes(2)
  })

  it('honours the reader switch once it is unlocked — turning the source off removes the definitions', () => {
    let readerOn = true
    const { scheduler, jobRuntime } = schedulerFor({ readerEnabled: () => readerOn })
    scheduler.initialize()
    expect(jobRuntime.setSchedule).toHaveBeenCalledTimes(2)

    readerOn = false
    jobRuntime.setSchedule.mockClear()
    jobRuntime.removeSchedule.mockClear()
    scheduler.syncSchedule()
    expect(jobRuntime.setSchedule).not.toHaveBeenCalled()
    expect(jobRuntime.removeSchedule.mock.calls.map(call => call[0])).toEqual([narwhalCalendarTickPolicy.definitionId, narwhalCalendarSweepPolicy.definitionId])
  })

  it('removes both definitions on dispose', () => {
    const { scheduler, jobRuntime } = schedulerFor()
    scheduler.initialize()
    scheduler.dispose()
    expect(jobRuntime.removeSchedule.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
