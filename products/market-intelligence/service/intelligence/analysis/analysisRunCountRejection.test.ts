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
    firstObservedAt: at, lastObservedAt: at, reviewDeadlineAt: '2026-10-09T13:00:00.000Z',
    eventRefs: ['event-1'], triggerCount: 1, reviewCount: 0, currentSummaryId: null,
    supersededByGroupId: null, revision: 1, createdAt: at, updatedAt: at
  }
}

/**
 * The counting contract, driven end to end: the trigger line writes an attempt row, the gate
 * refuses it, and the day's number must not change.
 *
 * Allowed attempts use an item key, which the gate passes through untouched — exactly how the
 * trigger line's own deliveries behave today. Refused attempts use the calendar key, whose budget
 * is what refuses them; the counting formula is key-agnostic, so this is the same arithmetic the
 * item line will use once it is budgeted.
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
    countRuns: (instant) => countAnalysisRuns(repository, instant),
    lastAutoRunAt: () => null,
    recordDecision: (decision) => { void runs.recordDecision(decision) },
    updateDecision: (rowId, decision, reasonCode) => repository.updateTriggerLedgerDecision(rowId, decision, reasonCode)
  })
  const advance = (iso: string) => { now = iso }
  /** Writes the attempt row the trigger line writes, then lets the gate judge it. */
  const attempt = async (triggerKey: string, changeHash: string) => {
    const rowId = runs.recordDecision({ eventGroupId: groupId, triggerKey, changeHash, decision: 'queued', reasonCode: 'severity-confirmed' })!
    const outcome = await gate.evaluate({ eventGroupId: groupId, triggerKey, asOf: now, previousSnapshot: null, attemptLedgerId: rowId })
    return { rowId, outcome }
  }
  const allow = (triggerKey: string, changeHash: string) => runs.recordDecision({ eventGroupId: groupId, triggerKey, changeHash, decision: 'queued', reasonCode: 'severity-confirmed' })!
  const rows = () => repository.listTriggerLedger(groupId)
  return { repository, runs, gate, advance, attempt, allow, rows }
}

describe('analysis run counting over refused attempts', () => {
  it('charges the day for the three allowed calls, not for the nine the hourly gate refused', async () => {
    const { repository, advance, attempt, allow, rows } = harness()
    advance(at)
    for (const hash of ['a1', 'a2', 'a3']) {
      allow('macro.actual.first-confirmed', hash)
    }
    expect(countAnalysisRuns(repository, at).dayRuns).toBe(3)

    const refusals = []
    for (let index = 0; index < 9; index += 1) {
      refusals.push(await attempt('calendar.refresh', `r${index}`))
    }
    for (const refusal of refusals) expect(refusal.outcome).toMatchObject({ decision: 'skipped', reasonCode: 'hour-budget-exhausted' })

    // Before the fix each refusal also left its trigger row saying "queued": twelve attempts, twelve
    // charged calls, none of the nine ever ran.
    expect(countAnalysisRuns(repository, at)).toMatchObject({ dayRuns: 3, hourRuns: 3 })
    const ledger = rows()
    expect(ledger).toHaveLength(12)
    const refused = ledger.filter(row => row.decision === 'skipped')
    expect(refused).toHaveLength(9)
    expect(refused.every(row => row.reasonCode === 'hour-budget-exhausted')).toBe(true)
    repository.close()
  })

  it('carries the unspent allowance into the next hour instead of losing the day', async () => {
    const { repository, advance, attempt, allow } = harness()
    advance(at)
    for (const hash of ['a1', 'a2', 'a3']) allow('macro.actual.first-confirmed', hash)
    for (let index = 0; index < 3; index += 1) await attempt('calendar.refresh', `r${index}`)
    expect(countAnalysisRuns(repository, at).dayRuns).toBe(3)

    advance('2026-10-09T13:05:00.000Z')
    for (const hash of ['b1', 'b2', 'b3']) allow('macro.actual.first-confirmed', hash)
    expect(countAnalysisRuns(repository, '2026-10-09T13:05:00.000Z')).toMatchObject({ dayRuns: 6, hourRuns: 3 })
    repository.close()
  })

  it('lets the twelfth call through and refuses the thirteenth with the day budget', async () => {
    const { repository, advance, attempt, allow } = harness()
    const hours = ['2026-10-09T08:05:00.000Z', '2026-10-09T09:05:00.000Z', '2026-10-09T10:05:00.000Z', '2026-10-09T11:05:00.000Z']
    let index = 0
    for (const hour of hours) {
      advance(hour)
      for (let slot = 0; slot < 3; slot += 1) allow('macro.actual.first-confirmed', `h${index++}`)
      expect(countAnalysisRuns(repository, hour).dayRuns % 3).toBe(0)
    }
    expect(countAnalysisRuns(repository, hours.at(-1)!).dayRuns).toBe(12)

    advance('2026-10-09T12:05:00.000Z')
    const thirteenth = await attempt('calendar.refresh', 'day-cap')
    expect(thirteenth.outcome).toMatchObject({ decision: 'skipped', reasonCode: 'day-budget-exhausted' })
    expect(countAnalysisRuns(repository, '2026-10-09T12:05:00.000Z').dayRuns).toBe(12)
    repository.close()
  })
})
