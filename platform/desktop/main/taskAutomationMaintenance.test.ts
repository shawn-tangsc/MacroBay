import { describe, expect, it, vi } from 'vitest'

import { createTaskAutomationMaintenance, scheduleTaskAutomationMaintenance } from './taskAutomationMaintenance'

describe('task automation maintenance', () => {
  it('marks pending delivery attempts unknown at startup without retrying any external send', () => {
    const markPendingUnknown = vi.fn(() => 2)
    const maintenance = createTaskAutomationMaintenance({
      attempts: { markPendingUnknown, deleteOlderThan: () => 0 },
      runs: { deleteOlderThan: () => ({ deletedRuns: 0, deletedAttempts: 0 }) },
      audits: { deleteOlderThan: () => 0 },
      checkpoints: { set: () => undefined },
      now: () => '2026-07-16T12:00:00.000Z'
    })

    expect(maintenance.recoverAfterRestart()).toEqual({ unknownAttempts: 2 })
    expect(markPendingUnknown).toHaveBeenCalledWith('2026-07-16T12:00:00.000Z')
  })

  it('runs bounded daily retention and records its durable checkpoint', () => {
    const deleteOlderThan = vi.fn(() => ({ deletedRuns: 2, deletedAttempts: 3 }))
    const deleteOldAttempts = vi.fn(() => 4)
    const deleteOldAudits = vi.fn(() => 5)
    const set = vi.fn()
    const maintenance = createTaskAutomationMaintenance({
      attempts: { markPendingUnknown: () => 0, deleteOlderThan: deleteOldAttempts },
      runs: { deleteOlderThan },
      audits: { deleteOlderThan: deleteOldAudits },
      checkpoints: { set },
      now: () => '2026-07-16T12:00:00.000Z'
    })

    expect(maintenance.runDailyRetention()).toEqual({ deletedRuns: 2, deletedAttempts: 7, deletedAudits: 5 })
    expect(deleteOldAttempts).toHaveBeenCalledWith('2026-01-17T12:00:00.000Z', 500)
    expect(deleteOlderThan).toHaveBeenCalledWith('2025-07-16T12:00:00.000Z', 500)
    expect(deleteOldAudits).toHaveBeenCalledWith('2025-07-16T12:00:00.000Z', 500)
    expect(set).toHaveBeenCalledWith(
      'task-delivery-retention',
      { deletedRuns: 2, deletedAttempts: 7, deletedAudits: 5 },
      '2026-07-16T12:00:00.000Z'
    )
  })

  it('runs bounded retention immediately and on a daily scheduler, then disposes its timer', () => {
    const runDailyRetention = vi.fn(() => ({ deletedRuns: 0, deletedAttempts: 0, deletedAudits: 0 }))
    const setIntervalFn = vi.fn(() => 42 as unknown as ReturnType<typeof setInterval>)
    const clearIntervalFn = vi.fn()

    const dispose = scheduleTaskAutomationMaintenance(
      { runDailyRetention },
      { setInterval: setIntervalFn, clearInterval: clearIntervalFn }
    )

    expect(runDailyRetention).toHaveBeenCalledOnce()
    expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 24 * 60 * 60_000)
    dispose()
    expect(clearIntervalFn).toHaveBeenCalledWith(42)
  })
})
