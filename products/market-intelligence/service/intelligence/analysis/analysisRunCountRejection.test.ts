import { describe, expect, it } from 'vitest'

import type { EventGroup } from '../../../contracts/marketAnalysisContracts'
import { createMarketAnalysisRepository } from '../store/marketAnalysisRepository'
import { countAnalysisRuns } from './analysisRunCounter'
import { createAnalysisRunService } from './analysisRunService'
import { createAnalysisSignificanceGate } from './analysisSignificanceGate'

const groupId = 'mi-eg-count'
const at = '2026-10-09T12:00:00.000Z'

function group(): EventGroup {
  return {
    id: groupId, schemaVersion: 1, status: 'monitoring', groupType: 'macro', mergeKey: 'US.CPI|count',
    firstObservedAt: at, lastObservedAt: at, reviewDeadlineAt: '2026-10-10T00:00:00.000Z',
    eventRefs: ['event-1'], triggerCount: 1, reviewCount: 0, currentSummaryId: null,
    supersededByGroupId: null, revision: 1, createdAt: at, updatedAt: at
  }
}

/**
 * The counting contract, driven end to end: the trigger line writes an attempt row, the gate
 * budgets it, and a refusal rewrites that row instead of adding a second one.
 */
function harness() {
  const repository = createMarketAnalysisRepository({ filePath: ':memory:' })
  repository.appendEventGroup(group())
  let now = at
  let sequence = 0
  const runs = createAnalysisRunService({ repository, now: () => now, idFactory: () => `id-${++sequence}` })
  const gate = createAnalysisSignificanceGate({
    now: () => now,
    queryMacroRoute: async () => ({ official: [], provider: [], months: [], asOf: now }) as never,
    countRuns: (instant, excludedRowId) => countAnalysisRuns(repository, instant, excludedRowId),
    lastAutoRunAt: () => null,
    recordDecision: (decision) => { void runs.recordDecision(decision) },
    updateDecision: (rowId, decision, reasonCode) => repository.updateTriggerLedgerDecision(rowId, decision, reasonCode)
  })
  const advance = (iso: string) => { now = iso }
  /** Writes the attempt row the trigger line writes, then lets the gate budget it. */
  const attempt = async (triggerKey: string, changeHash: string) => {
    const rowId = runs.recordDecision({ eventGroupId: groupId, triggerKey, changeHash, decision: 'queued', reasonCode: 'severity-confirmed' })!
    const outcome = await gate.evaluate({ eventGroupId: groupId, triggerKey, asOf: now, previousSnapshot: null, attemptLedgerId: rowId })
    return { rowId, outcome }
  }
  const rows = () => repository.listTriggerLedger(groupId)
  const counts = (instant = now) => countAnalysisRuns(repository, instant)
  return { repository, advance, attempt, rows, counts, runs }
}

describe('analysis run counting over refused attempts', () => {
  it('charges the day for the twelve allowed calls, not for the refused thirteenth', async () => {
    const { repository, advance, attempt, rows, counts } = harness()
    advance(at)
    for (let index = 1; index <= 12; index += 1) {
      const { outcome } = await attempt('macro.actual.first-confirmed', `a${index}`)
      expect(outcome).toMatchObject({ decision: 'queued' })
    }
    expect(counts()).toMatchObject({ eventRunsToday: 12, eventRunsThisHour: 12, dayRuns: 12 })

    const refused = await attempt('macro.actual.first-confirmed', 'a13')
    expect(refused.outcome).toMatchObject({ decision: 'skipped', reasonCode: 'hour-budget-exhausted' })
    // The refusal rewrote the attempt's own row; a second row would have charged thirteen.
    expect(counts()).toMatchObject({ eventRunsToday: 12, dayRuns: 12 })
    const skipped = rows().filter(row => row.decision === 'skipped')
    expect(skipped).toHaveLength(1)
    expect(skipped[0]).toMatchObject({ id: refused.rowId, reasonCode: 'hour-budget-exhausted' })
    expect(rows()).toHaveLength(13)
    repository.close()
  })

  it('keeps an unspent hour for the next one, up to the line daily quota', async () => {
    const { repository, advance, attempt, counts } = harness()
    const hours = ['2026-10-09T08:05:00.000Z', '2026-10-09T09:05:00.000Z', '2026-10-09T10:05:00.000Z', '2026-10-09T11:05:00.000Z']
    let index = 0
    for (const hour of hours) {
      advance(hour)
      for (let slot = 0; slot < 12; slot += 1) {
        const { outcome } = await attempt('macro.actual.first-confirmed', `h${index++}`)
        expect(outcome).toMatchObject({ decision: 'queued' })
      }
      expect(counts(hour).eventRunsToday % 12).toBe(0)
    }
    expect(counts(hours.at(-1)!).eventRunsToday).toBe(48)

    advance('2026-10-09T12:05:00.000Z')
    const refused = await attempt('macro.actual.first-confirmed', 'day-cap')
    expect(refused.outcome).toMatchObject({ decision: 'skipped', reasonCode: 'day-budget-exhausted' })
    expect(counts().eventRunsToday).toBe(48)
    repository.close()
  })

  it('no longer takes the calendar line quota for the event line', async () => {
    const { repository, advance, attempt, counts, runs } = harness()
    let index = 0
    for (const hour of ['2026-10-09T08:05:00.000Z', '2026-10-09T09:05:00.000Z', '2026-10-09T10:05:00.000Z', '2026-10-09T11:05:00.000Z']) {
      advance(hour)
      for (let slot = 0; slot < 12; slot += 1) await attempt('macro.actual.first-confirmed', `e${index++}`)
    }
    // A full event day: the calendar line has still spent nothing, which is the whole point.
    expect(counts()).toMatchObject({ eventRunsToday: 48, calendarRunsToday: 0 })

    advance('2026-10-09T12:05:00.000Z')
    for (let slot = 0; slot < 9; slot += 1) {
      runs.recordDecision({ eventGroupId: groupId, triggerKey: 'calendar.refresh', changeHash: `c${slot}`, decision: 'queued', reasonCode: 'significance-confirmed' })
    }
    expect(counts().calendarRunsToday).toBe(9)

    advance('2026-10-09T13:05:00.000Z')
    const refused = await attempt('calendar.refresh', 'c9')
    expect(refused.outcome).toMatchObject({ decision: 'skipped', reasonCode: 'day-budget-exhausted' })
    expect(counts().calendarRunsToday).toBe(9)
    repository.close()
  })
})
