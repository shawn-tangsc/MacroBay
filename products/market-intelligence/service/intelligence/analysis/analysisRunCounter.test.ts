import { expect, it } from 'vitest'
import { analysisRunCounterPolicy, countAnalysisRuns, lastAutoRunAt } from './analysisRunCounter'

const now = '2026-10-09T12:00:00.000Z'
const row = (overrides: Record<string, unknown> = {}) => ({
  triggerKey: 'calendar.refresh', reasonCode: 'significance-confirmed', decision: 'queued', createdAt: now, ...overrides
})
const repository = (groups: Record<string, readonly ReturnType<typeof row>[]>) => ({
  listEventGroups: () => Object.keys(groups).map(id => ({ id })),
  listTriggerLedger: (eventGroupId: string) => groups[eventGroupId] ?? []
})

it('states its version and how compensation is recognised', () => {
  expect(analysisRunCounterPolicy.version).toBe('marketAnalysisRunCounterPolicy.v1')
  expect(analysisRunCounterPolicy.restartReasonPrefix).toBe('restart-')
  expect(Object.isFrozen(analysisRunCounterPolicy)).toBe(true)
})

it('counts delivered runs across every group, not per group', () => {
  const counts = countAnalysisRuns(repository({
    a: [row(), row({ createdAt: '2026-10-09T11:00:00.000Z' })],
    b: [row({ triggerKey: 'schedule.asia.open', reasonCode: 'session-slot' })]
  }), now)
  expect(counts).toEqual({ hourRuns: 2, dayRuns: 3, eventRunsToday: 2, scheduledRunsToday: 1 })
})

it('ignores skips, other days, and restart compensation', () => {
  const counts = countAnalysisRuns(repository({
    a: [
      row({ decision: 'skipped', reasonCode: 'interval-active' }),
      row({ createdAt: '2026-10-08T12:00:00.000Z' }),
      row({ reasonCode: 'restart-initial-compensated' }),
      row({ reasonCode: 'restart-review-compensated', triggerKey: 'market-reaction.15m' }),
      row({ createdAt: '2026-10-09T13:00:00.000Z' })
    ]
  }), now)
  expect(counts).toEqual({ hourRuns: 1, dayRuns: 1, eventRunsToday: 1, scheduledRunsToday: 0 })
})

it('counts only the last hour for the hourly gate', () => {
  const counts = countAnalysisRuns(repository({ a: [
    row({ createdAt: '2026-10-09T11:00:01.000Z' }),
    row({ createdAt: '2026-10-09T11:00:00.000Z' }),
    row({ createdAt: '2026-10-09T10:59:59.000Z' })
  ] }), now)
  // One millisecond inside the hour counts; exactly one hour ago has elapsed.
  expect(counts.hourRuns).toBe(1)
  expect(counts.dayRuns).toBe(3)
})

it('reports the group baseline from its latest delivered run', () => {
  const repo = repository({ a: [row({ createdAt: '2026-10-09T11:00:00.000Z' }), row({ createdAt: '2026-10-09T11:30:00.000Z' })] })
  expect(lastAutoRunAt(repo, 'a', now)).toBe('2026-10-09T11:30:00.000Z')
  // A skip is not a run: it must not open the coalescing window.
  expect(lastAutoRunAt(repository({ a: [row({ decision: 'skipped', createdAt: '2026-10-09T11:59:00.000Z' })] }), 'a', now)).toBeNull()
  expect(lastAutoRunAt(repo, 'missing', now)).toBeNull()
})

it('tolerates a repository without the optional readers', () => {
  expect(countAnalysisRuns({}, now)).toEqual({ hourRuns: 0, dayRuns: 0, eventRunsToday: 0, scheduledRunsToday: 0 })
  expect(lastAutoRunAt({}, 'a', now)).toBeNull()
})
