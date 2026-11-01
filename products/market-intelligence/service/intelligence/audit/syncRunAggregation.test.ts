import { describe, expect, it } from 'vitest'

import { syncRunAggregateDayWindow } from '../../../contracts/syncRunRecords'
import { projectDailyAggregates } from './syncRunAggregation'

const DAY_MS = 86_400_000
const NOW = Date.parse('2026-11-01T16:00:00.000Z')

describe('daily run aggregates', () => {
  it('names a definition through the same catalogue the table uses', () => {
    const result = projectDailyAggregates({
      state: 'available',
      rows: [{ day: '2026-09-30', definitionId: 'market-intelligence.collectSource', runs: 6, failures: 1 }]
    })

    expect(result).toEqual({
      state: 'available',
      rows: [{
        day: '2026-09-30',
        handlerId: 'market-intelligence.collectSource',
        taskLabel: '情报源采集',
        runs: 6,
        failures: 1
      }]
    })
  })

  it('keeps an unknown definition id visible instead of inventing a name', () => {
    const result = projectDailyAggregates({
      state: 'available',
      rows: [{ day: '2026-09-30', definitionId: 'market-intelligence.someNewJob', runs: 1, failures: 0 }]
    })

    expect(result.state).toBe('available')
    expect(result.rows[0]?.taskLabel).toBe('market-intelligence.someNewJob')
  })

  it('passes an unavailable store through with its reason, never as an empty history', () => {
    const result = projectDailyAggregates({ state: 'unavailable', reason: 'memory-store-has-no-aggregates', rows: [] })

    expect(result).toEqual({ state: 'unavailable', reason: 'memory-store-has-no-aggregates', rows: [] })
  })

  it('names any other reason with the product’s own code so the page can always render one', () => {
    const result = projectDailyAggregates({ state: 'unavailable', reason: 'disk-on-fire' as never, rows: [] })

    expect(result.state === 'unavailable' && result.reason).toBe('aggregates-unavailable')
  })

  it('asks for a window that still covers the day 31 days ago', () => {
    const { fromDay, toDay } = syncRunAggregateDayWindow(NOW)
    const thirtyOneDaysAgo = new Date(NOW - 31 * DAY_MS).toISOString().slice(0, 10)

    expect(fromDay <= thirtyOneDaysAgo).toBe(true)
    // Half-open: today is included, so the exclusive end is tomorrow.
    expect(toDay).toBe('2026-11-02')
  })
})
