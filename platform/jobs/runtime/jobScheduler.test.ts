import { describe, expect, it, vi } from 'vitest'

import type { JobDefinition } from '../contracts/jobTypes'
import { createJobScheduler } from './jobScheduler'
import { computeNextCronRunAt } from './jobCronSchedule'

describe('jobScheduler', () => {
  it('fails cron calculation fast for invalid timezone and start values', () => {
    expect(computeNextCronRunAt('0 9 * * *', 'Bad/Zone', Date.UTC(2026, 0, 1))).toBeNull()
    for (const startMs of [Number.NaN, Infinity, Number.MAX_SAFE_INTEGER, 8_640_000_000_000_001]) {
      expect(computeNextCronRunAt('0 9 * * *', 'UTC', startMs)).toBeNull()
    }
  })
  it('enqueues manual jobs immediately', async () => {
    const enqueue = vi.fn()
    const scheduler = createJobScheduler({ enqueue })

    const definition = createDefinition({ id: 'manual-1', trigger: { kind: 'manual' } })
    scheduler.setSchedule(definition)

    await scheduler.triggerManual('manual-1')
    expect(enqueue).toHaveBeenCalledWith(definition)
  })

  it('skips interval ticks while the concurrency key is locked', async () => {
    vi.useFakeTimers()
    const enqueue = vi.fn()
    const isLocked = vi.fn(() => true)
    const scheduler = createJobScheduler({ enqueue, isLocked })

    const definition = createDefinition({
      id: 'interval-1',
      trigger: { kind: 'interval', intervalMs: 1000, anchor: 'lastComplete' },
      concurrencyKey: 'lock-1'
    })
    scheduler.setSchedule(definition)

    vi.advanceTimersByTime(1000)
    expect(enqueue).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('fires interval jobs after the configured delay for lastStart anchor', async () => {
    vi.useFakeTimers()
    const enqueue = vi.fn()
    const scheduler = createJobScheduler({ enqueue, isLocked: () => false })

    const definition = createDefinition({
      id: 'interval-2',
      trigger: { kind: 'interval', intervalMs: 2000, anchor: 'lastStart' }
    })
    scheduler.setSchedule(definition)

    vi.advanceTimersByTime(1999)
    expect(enqueue).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(enqueue).toHaveBeenCalledWith(definition)

    vi.useRealTimers()
  })

  it('schedules the next lastComplete interval after run completion', async () => {
    vi.useFakeTimers()
    const enqueue = vi.fn()
    const scheduler = createJobScheduler({ enqueue, isLocked: () => false })

    const definition = createDefinition({
      id: 'interval-last-complete',
      trigger: { kind: 'interval', intervalMs: 2000, anchor: 'lastComplete' }
    })
    scheduler.setSchedule(definition)
    scheduler.notifyRunCompleted('interval-last-complete')

    vi.advanceTimersByTime(1999)
    expect(enqueue).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(enqueue).toHaveBeenCalledWith(definition)

    vi.useRealTimers()
  })

  it('fires cron jobs at the next matching minute and reschedules the following match', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T10:10:30.000Z'))
    const enqueue = vi.fn()
    const scheduler = createJobScheduler({ enqueue, isLocked: () => false })

    const definition = createDefinition({
      id: 'cron-1',
      trigger: { kind: 'cron', expression: '15 * * * *' }
    })
    scheduler.setSchedule(definition)

    await vi.advanceTimersByTimeAsync(269_000)
    expect(enqueue).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenLastCalledWith(definition)

    await vi.advanceTimersByTimeAsync(3_599_000)
    expect(enqueue).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(enqueue).toHaveBeenCalledTimes(2)
    expect(enqueue).toHaveBeenLastCalledWith(definition)

    vi.useRealTimers()
  })

  it('fires cron jobs using the configured timezone instead of raw UTC fields', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T10:10:30.000Z'))
    const enqueue = vi.fn()
    const scheduler = createJobScheduler({ enqueue, isLocked: () => false })

    const definition = createDefinition({
      id: 'cron-timezone',
      trigger: { kind: 'cron', expression: '15 5 * * *', timezone: 'America/New_York' }
    })
    scheduler.setSchedule(definition)

    await vi.advanceTimersByTimeAsync(269_000)
    expect(enqueue).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenLastCalledWith(definition)

    vi.useRealTimers()
  })

  it('skips locked cron slots and retries on the next matching minute', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T10:14:30.000Z'))
    const enqueue = vi.fn()
    let locked = true
    const scheduler = createJobScheduler({
      enqueue,
      isLocked: () => locked
    })

    const definition = createDefinition({
      id: 'cron-locked',
      trigger: { kind: 'cron', expression: '* * * * *' },
      concurrencyKey: 'lock-1'
    })
    scheduler.setSchedule(definition)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(enqueue).not.toHaveBeenCalled()

    locked = false
    await vi.advanceTimersByTimeAsync(60_000)
    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(enqueue).toHaveBeenLastCalledWith(definition)

    vi.useRealTimers()
  })

  it('clears schedules when removed', async () => {
    vi.useFakeTimers()
    const enqueue = vi.fn()
    const scheduler = createJobScheduler({ enqueue, isLocked: () => false })

    const definition = createDefinition({
      id: 'interval-3',
      trigger: { kind: 'interval', intervalMs: 1000, anchor: 'lastStart' }
    })
    scheduler.setSchedule(definition)
    scheduler.removeSchedule('interval-3')

    vi.advanceTimersByTime(2000)
    expect(enqueue).not.toHaveBeenCalled()

    vi.useRealTimers()
  })
})

function createDefinition(overrides: Partial<JobDefinition>): JobDefinition {
  return {
    id: 'job-default',
    owner: 'product',
    productId: 'sample-product',
    handlerId: 'handler',
    title: 'Job',
    trigger: { kind: 'manual' },
    payload: {},
    ...overrides
  }
}
