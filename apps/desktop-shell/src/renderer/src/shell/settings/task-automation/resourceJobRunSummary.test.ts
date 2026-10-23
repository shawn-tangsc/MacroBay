import { describe, expect, it } from 'vitest'

import type { JobScheduleView } from '@platform/jobs'

import { summarizeResourceJobRuns } from './resourceJobRunSummary'

describe('summarizeResourceJobRuns', () => {
  it('aggregates the projected last outcome of 18 jobs without mixing delivery counts', () => {
    const jobs: Array<Pick<JobScheduleView, 'lastOutcome' | 'lastRunAt'>> = [
      ...Array.from({ length: 14 }, (_, index) => job('success', `2026-07-17T0${index % 10}:00:00.000Z`)),
      ...Array.from({ length: 2 }, () => job('failed', '2026-07-17T08:30:00.000Z')),
      ...Array.from({ length: 2 }, () => job('never', null))
    ]

    expect(summarizeResourceJobRuns(jobs)).toEqual({
      total: 18,
      succeeded: 14,
      failed: 2,
      skipped: 0,
      never: 2,
      latestRunAt: '2026-07-17T09:00:00.000Z'
    })
  })

  it('reports no last update when every job never ran', () => {
    const jobs = [job('never', null), job('never', null)]

    expect(summarizeResourceJobRuns(jobs)).toEqual({
      total: 2,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      never: 2,
      latestRunAt: null
    })
  })

  it('returns four zero counts and no last update for an empty projection', () => {
    expect(summarizeResourceJobRuns([])).toEqual({
      total: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      never: 0,
      latestRunAt: null
    })
  })

  it('counts skipped runs and treats a job without a last run timestamp as never run', () => {
    const jobs = [
      job('skipped', '2026-07-17T07:00:00.000Z'),
      job('success', null),
      job('failed', 'not-a-date')
    ]

    expect(summarizeResourceJobRuns(jobs)).toEqual({
      total: 3,
      succeeded: 0,
      failed: 0,
      skipped: 1,
      never: 2,
      latestRunAt: '2026-07-17T07:00:00.000Z'
    })
  })
})

function job(
  lastOutcome: JobScheduleView['lastOutcome'],
  lastRunAt: string | null
): Pick<JobScheduleView, 'lastOutcome' | 'lastRunAt'> {
  return { lastOutcome, lastRunAt }
}
