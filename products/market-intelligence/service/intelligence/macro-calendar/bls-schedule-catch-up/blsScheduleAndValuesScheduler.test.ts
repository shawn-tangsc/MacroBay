import { afterEach, describe, expect, it, vi } from 'vitest'

import { createJobScheduler } from '@platform/jobs/runtime/jobScheduler'
import type { JobDefinition } from '@platform/jobs'

import { createBlsScheduleAndValuesScheduler, blsScheduleAndValuesSchedulerPolicy } from './blsScheduleAndValuesScheduler'

afterEach(() => { vi.useRealTimers() })

const completed = { state: 'completed', schedule: 'updated', values: { cpi: 'updated', employment: 'current' } }

function harness(sync = vi.fn(async () => completed), now = () => new Date('2026-10-07T09:00:00.000Z'), readEnabled: () => boolean | Promise<boolean> = () => true) {
  const handlers = new Map<string, () => Promise<void>>()
  const schedules: unknown[] = []
  const removed: string[] = []
  const scheduler = createBlsScheduleAndValuesScheduler({
    jobRuntime: {
      registerHandler: ((id: string, handler: () => Promise<void>) => { handlers.set(id, handler) }) as never,
      setSchedule: ((definition: unknown) => { schedules.push(definition) }) as never,
      removeSchedule: ((id: string) => { removed.push(id) }) as never,
      // The scheduler refreshes once at startup; this harness only records it.
      enqueueDefinition: (async () => ({})) as never
    },
    workflow: { sync: sync as never },
    readEnabled,
    now
  })
  return { scheduler, handlers, schedules, removed, sync }
}

describe('blsScheduleAndValuesScheduler', () => {
  it('actually enqueues a tick on its interval through the real platform scheduler', async () => {
    // A `lastComplete` anchor never arms a fresh schedule, so this drives the real
    // scheduler: the earlier definition assertion passed while nothing ever ran.
    vi.useFakeTimers()
    const enqueued: JobDefinition[] = []
    const platformScheduler = createJobScheduler({ enqueue: async (definition) => { enqueued.push(definition) } })
    const handlers = new Map<string, () => Promise<void>>()
    const scheduler = createBlsScheduleAndValuesScheduler({
      jobRuntime: {
        registerHandler: ((id: string, handler: () => Promise<void>) => { handlers.set(id, handler) }) as never,
        setSchedule: ((definition: JobDefinition) => platformScheduler.setSchedule(definition)) as never,
        removeSchedule: ((id: string) => platformScheduler.removeSchedule(id)) as never,
        enqueueDefinition: (async () => ({})) as never
      },
      workflow: { sync: vi.fn(async () => completed) as never },
      readEnabled: () => true,
      now: () => new Date('2026-10-07T09:00:00.000Z')
    })
    scheduler.initialize()
    expect(enqueued).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(blsScheduleAndValuesSchedulerPolicy.intervalMs + 1)
    expect(enqueued.length).toBeGreaterThan(0)
    expect(enqueued[0]?.id).toBe(blsScheduleAndValuesSchedulerPolicy.definitionId)
    scheduler.dispose()
  })

  it('refreshes once on startup and then keeps the interval armed', async () => {
    vi.useFakeTimers()
    const enqueued: JobDefinition[] = []
    const started: JobDefinition[] = []
    const platformScheduler = createJobScheduler({ enqueue: async (definition) => { enqueued.push(definition) } })
    const scheduler = createBlsScheduleAndValuesScheduler({
      jobRuntime: {
        registerHandler: (() => undefined) as never,
        setSchedule: ((definition: JobDefinition) => platformScheduler.setSchedule(definition)) as never,
        removeSchedule: ((id: string) => platformScheduler.removeSchedule(id)) as never,
        enqueueDefinition: (async (definition: JobDefinition) => { started.push(definition); return {} }) as never
      },
      workflow: { sync: vi.fn(async () => completed) as never },
      readEnabled: () => true,
      now: () => new Date('2026-10-07T09:00:00.000Z')
    })
    scheduler.initialize()

    expect(started).toHaveLength(1)
    expect(started[0]).toMatchObject({ id: blsScheduleAndValuesSchedulerPolicy.definitionId, trigger: { kind: 'startup' } })
    await vi.advanceTimersByTimeAsync(blsScheduleAndValuesSchedulerPolicy.intervalMs + 1)
    expect(enqueued.length).toBeGreaterThan(0)
    scheduler.dispose()
  })

  it('derives the year per tick instead of capturing it at registration', async () => {
    const sync = vi.fn(async () => completed)
    const { scheduler, handlers } = harness(sync, () => new Date('2027-01-02T00:00:00.000Z'))
    scheduler.initialize()
    await handlers.get(blsScheduleAndValuesSchedulerPolicy.handlerId)?.()
    expect(sync).toHaveBeenCalledWith({ year: '2027' })
  })

  it('treats a completed catch-up as success, including when nothing was required', async () => {
    const sync = vi.fn(async () => ({ state: 'completed', schedule: 'unchanged', values: { cpi: 'not-required', employment: 'not-required' } }))
    const { scheduler, handlers } = harness(sync)
    scheduler.initialize()
    await expect(handlers.get(blsScheduleAndValuesSchedulerPolicy.handlerId)?.()).resolves.toBeUndefined()
  })

  it('fails the job run when the sync is unavailable', async () => {
    const { scheduler, handlers } = harness(vi.fn(async () => ({ state: 'unavailable' })))
    scheduler.initialize()
    await expect(handlers.get(blsScheduleAndValuesSchedulerPolicy.handlerId)?.()).rejects.toThrow()
  })

  it('spends no request while the BLS provider is disabled', async () => {
    const { scheduler, handlers, sync } = harness(vi.fn(async () => completed), undefined, () => false)
    scheduler.initialize()
    await handlers.get(blsScheduleAndValuesSchedulerPolicy.handlerId)?.()
    expect(sync).not.toHaveBeenCalled()
  })

  it('spends no request when the enabled gate cannot be read', async () => {
    const { scheduler, handlers, sync } = harness(vi.fn(async () => completed), undefined, () => { throw new Error('profiles unreadable') })
    scheduler.initialize()
    await handlers.get(blsScheduleAndValuesSchedulerPolicy.handlerId)?.()
    expect(sync).not.toHaveBeenCalled()
  })

  it('removes the schedule on dispose and stops syncing afterwards', async () => {
    const { scheduler, handlers, removed, sync } = harness()
    scheduler.initialize()
    scheduler.dispose()
    expect(removed).toEqual([blsScheduleAndValuesSchedulerPolicy.definitionId])
    await handlers.get(blsScheduleAndValuesSchedulerPolicy.handlerId)?.()
    expect(sync).not.toHaveBeenCalled()
  })
})
