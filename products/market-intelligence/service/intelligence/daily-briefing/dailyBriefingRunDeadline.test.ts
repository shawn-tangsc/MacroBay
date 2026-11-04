import { describe, expect, it, vi } from 'vitest'

import { DAILY_BRIEF_RUN_DEADLINE_MS, withRunDeadline } from './dailyBriefingRunDeadline'
import type { DailyBriefingTodayResult } from './dailyBriefingService'

/**
 * The caller's own bound on one manual run.
 *
 * Every part of a run has a budget; the caller had none. A promise that neither resolves nor rejects
 * therefore left the reader with a spinner and no answer, which is indistinguishable from a run that
 * is still working — the worst of both, because nothing on screen can be trusted.
 */
const done: DailyBriefingTodayResult = Object.freeze({ state: 'unavailable', failureCode: 'not-generated' })

describe('one run has a caller deadline', () => {
  it('passes a run’s own answer through untouched', async () => {
    await expect(withRunDeadline(Promise.resolve(done))).resolves.toBe(done)
  })

  it('answers with run-timeout when the run never settles', async () => {
    vi.useFakeTimers()
    try {
      const never = new Promise<DailyBriefingTodayResult>(() => undefined)
      const answered = withRunDeadline(never, 5_000)
      await vi.advanceTimersByTimeAsync(5_001)
      await expect(answered).resolves.toEqual({ state: 'unavailable', failureCode: 'run-timeout' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds the wait above the sum of the parts it covers', () => {
    // Fifteen minutes of readiness plus five of generation plus a minute of margin: the deadline may
    // only fire when every part has already passed its own budget.
    expect(DAILY_BRIEF_RUN_DEADLINE_MS).toBe(900_000 + 300_000 + 60_000)
  })
})
