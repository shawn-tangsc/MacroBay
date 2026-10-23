import { expect, it } from 'vitest'
import { createMarketAnalysisRepository } from './marketAnalysisRepository'

const asOf = '2026-10-09T12:00:00.000Z'
const eventGroupId = 'mi-eg-ledger'

function repository() {
  const repo = createMarketAnalysisRepository({ filePath: ':memory:' })
  repo.appendEventGroup({
    id: eventGroupId, schemaVersion: 1, status: 'monitoring', groupType: 'macro', mergeKey: 'US.CPI', firstObservedAt: asOf,
    lastObservedAt: asOf, reviewDeadlineAt: '2026-10-09T14:00:00.000Z', eventRefs: ['event-1'], triggerCount: 0, reviewCount: 0,
    currentSummaryId: null, supersededByGroupId: null, revision: 1, createdAt: asOf, updatedAt: asOf
  })
  return repo
}

const ledger = (overrides: Record<string, unknown> = {}) => ({
  id: 'mi-tl-1', eventGroupId, triggerKey: 'calendar.refresh', changeHash: 'hash-1', decision: 'skipped',
  reasonCode: 'interval-active', snapshotHash: null, analysisRunId: null, createdAt: asOf, ...overrides
})

it('keeps the latest decision for the same content instead of dropping it', () => {
  const repo = repository()
  repo.appendTriggerLedger(ledger() as never)
  // The same content 30 minutes later is allowed through; with `do nothing` this queued
  // decision vanished and the panel kept claiming "skipped by interval" for a run that ran.
  repo.appendTriggerLedger(ledger({ id: 'mi-tl-2', decision: 'queued', reasonCode: 'significance-confirmed', snapshotHash: 'snap-1', analysisRunId: null, createdAt: '2026-10-09T12:30:00.000Z' }) as never)
  const rows = repo.listTriggerLedger(eventGroupId)
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ decision: 'queued', reasonCode: 'significance-confirmed', snapshotHash: 'snap-1' })
})

it('leaves created_at alone so the item path cooldown cannot be pushed forward', () => {
  const repo = repository()
  repo.appendTriggerLedger(ledger() as never)
  repo.appendTriggerLedger(ledger({ id: 'mi-tl-2', decision: 'queued', createdAt: '2026-10-09T18:00:00.000Z' }) as never)
  expect(repo.listTriggerLedger(eventGroupId)[0]!.createdAt).toBe(asOf)
})

it('keeps one row per trigger key and content, so different causes do not overwrite each other', () => {
  const repo = repository()
  repo.appendTriggerLedger(ledger() as never)
  repo.appendTriggerLedger(ledger({ id: 'mi-tl-2', triggerKey: 'schedule.asia.open', reasonCode: 'session-slot', decision: 'queued' }) as never)
  repo.appendTriggerLedger(ledger({ id: 'mi-tl-3', changeHash: 'hash-2', reasonCode: 'significance-below-threshold' }) as never)
  expect(repo.listTriggerLedger(eventGroupId)).toHaveLength(3)
})
