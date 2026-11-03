import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { moduleSignalPolicy, signalWindow, type ModuleSignal } from '../../../contracts/moduleSignal'
import { parseSignalEvidence, queuedSignalEvidence, skippedSignalEvidence } from '../../../contracts/moduleSignalEvidence'
import { countAnalysisRuns } from '../analysis/analysisRunCounter'
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

const signal = (overrides: Partial<ModuleSignal> = {}): ModuleSignal => ({
  version: moduleSignalPolicy.version, moduleId: 'open-interest', ruleId: 'oi-liquidation-proxy', asset: 'btc',
  severity: 'high', observedAt: '2026-10-09T12:00:00.000Z', cadence: { kind: 'intraday', bucketMs: 15 * 60_000 },
  values: { dropPct: -1.9, volumeMultiple: 3.4 },
  dedupeKey: 'open-interest:oi-liquidation-proxy:btc:2026-10-09T12:00:00.000Z', readiness: 'available',
  triggerOwner: 'module-signal', ...overrides
})
const withWindow = (value: ModuleSignal) => ({ signal: value, window: signalWindow(value.cadence, 1)! })

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

it('stores the reading a refused signal was judged on, and reads it back by its decision', () => {
  const repo = repository()
  const skipped = skippedSignalEvidence(withWindow(signal()))
  repo.appendTriggerLedger(ledger({ evidence: skipped }))
  const [row] = repo.listTriggerLedger(eventGroupId)
  expect(row!.evidenceJson).toBeTruthy()
  expect(parseSignalEvidence(row!.decision, row!.evidenceJson)).toEqual(skipped)
  // The same stored JSON read as the other shape is not a reading: the decision picks the shape.
  expect(parseSignalEvidence('queued', row!.evidenceJson)).toBeNull()
})

it('keeps one run one row: three signals in one queued line count as a single analysis', () => {
  const repo = repository()
  const queued = queuedSignalEvidence([
    withWindow(signal()),
    withWindow(signal({ severity: 'medium', observedAt: '2026-10-09T12:15:00.000Z', ruleId: 'oi-second' })),
    withWindow(signal({ severity: 'low', observedAt: '2026-10-09T12:30:00.000Z', ruleId: 'oi-third' }))
  ])
  repo.appendTriggerLedger(ledger({
    triggerKey: 'signal.open-interest.oi-liquidation-proxy', decision: 'queued',
    reasonCode: 'signal-high-triggered', evidence: queued
  }))
  const counts = countAnalysisRuns(repo, asOf)
  // One model call: the batch's other two signals are readings in this row, not deliveries.
  expect(counts).toMatchObject({ dayRuns: 1, hourRuns: 1, eventRunsToday: 1, calendarRunsToday: 0 })
  expect(parseSignalEvidence('queued', repo.listTriggerLedger(eventGroupId)[0]!.evidenceJson)).toMatchObject({ signalCount: 3 })
})

it('does not let a later decision rewrite erase the reading', () => {
  const repo = repository()
  const skipped = skippedSignalEvidence(withWindow(signal()))
  repo.appendTriggerLedger(ledger({ evidence: skipped }))
  // The significance gate rewrites the same attempt's decision without carrying the reading back.
  repo.appendTriggerLedger(ledger({ id: 'mi-tl-2', decision: 'queued', reasonCode: 'signal-high-triggered', createdAt: '2026-10-09T12:01:00.000Z' }))
  const [row] = repo.listTriggerLedger(eventGroupId)
  expect(row).toMatchObject({ decision: 'queued', reasonCode: 'signal-high-triggered' })
  expect(parseSignalEvidence('skipped', row!.evidenceJson)).toEqual(skipped)
})

it('adds the evidence column to a database created without it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mi-ledger-evidence-'))
  const filePath = join(directory, 'analysis.sqlite')
  try {
    // An install from before the column: create it, then take the column away through the same
    // SQLite file the runtime opens.
    createMarketAnalysisRepository({ filePath }).close()
    const legacy = new DatabaseSync(filePath)
    legacy.exec('alter table mi_analysis_trigger_ledger drop column evidence_json')
    legacy.close()

    const repo = createMarketAnalysisRepository({ filePath })
    repo.appendEventGroup({
      id: eventGroupId, schemaVersion: 1, status: 'monitoring', groupType: 'macro', mergeKey: 'US.CPI', firstObservedAt: asOf,
      lastObservedAt: asOf, reviewDeadlineAt: '2026-10-09T14:00:00.000Z', eventRefs: ['event-1'], triggerCount: 0, reviewCount: 0,
      currentSummaryId: null, supersededByGroupId: null, revision: 1, createdAt: asOf, updatedAt: asOf
    })
    const queued = queuedSignalEvidence([withWindow(signal())])
    repo.appendTriggerLedger(ledger({ triggerKey: 'signal.open-interest.oi-liquidation-proxy', decision: 'queued', evidence: queued }))
    expect(parseSignalEvidence('queued', repo.listTriggerLedger(eventGroupId)[0]!.evidenceJson)).toEqual(queued)
    repo.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

it('refuses to store a reading whose shape disagrees with its decision', () => {
  const repo = repository()
  const queued = queuedSignalEvidence([withWindow(signal())])
  const skipped = skippedSignalEvidence(withWindow(signal()))
  // Stored as-is, a batch under `skipped` reads back as null and the panel shows a reason with no
  // reading — the one failure this column is meant to make impossible.
  expect(() => repo.appendTriggerLedger(ledger({ decision: 'skipped', evidence: queued }))).toThrowError('signal-evidence-shape-mismatch')
  expect(() => repo.appendTriggerLedger(ledger({ decision: 'queued', evidence: skipped }))).toThrowError('signal-evidence-shape-mismatch')
  expect(() => repo.appendTriggerLedger(ledger({ decision: 'recorded', evidence: skipped }))).toThrowError('signal-evidence-shape-mismatch')
  expect(repo.listTriggerLedger(eventGroupId)).toHaveLength(0)
})

it('still writes the queued rows that carry no reading at all', () => {
  // The calendar line, the session slots and restart compensation are all `queued` with no evidence;
  // requiring a reading there would refuse the runs that never had one.
  const repo = repository()
  repo.appendTriggerLedger(ledger({ decision: 'queued', reasonCode: 'significance-confirmed' }))
  repo.appendTriggerLedger(ledger({ id: 'mi-tl-2', triggerKey: 'restart.compensation', decision: 'queued', reasonCode: 'restart-initial-compensated' }))
  expect(repo.listTriggerLedger(eventGroupId)).toHaveLength(2)
  expect(repo.listTriggerLedger(eventGroupId).every(row => row.evidenceJson === null)).toBe(true)
})

it('restates a refused batch as its most severe signal, so the reason keeps its reading', () => {
  const repo = repository()
  const queued = queuedSignalEvidence([
    withWindow(signal({ severity: 'low', ruleId: 'oi-quiet' })),
    withWindow(signal({ severity: 'high', values: { dropPct: -2.7, volumeMultiple: 3.8 } })),
    withWindow(signal({ severity: 'medium', ruleId: 'oi-mid' }))
  ])
  const rowId = repo.appendTriggerLedger(ledger({
    triggerKey: 'signal.open-interest.oi-liquidation-proxy', decision: 'queued',
    reasonCode: 'signal-high-triggered', evidence: queued
  }))
  // The budget refusal and the enqueue failure both come through this one rewrite.
  repo.updateTriggerLedgerDecision(rowId, 'skipped', 'hour-budget-exhausted')
  const [row] = repo.listTriggerLedger(eventGroupId)
  expect(row).toMatchObject({ decision: 'skipped', reasonCode: 'hour-budget-exhausted' })
  const reading = parseSignalEvidence('skipped', row!.evidenceJson)
  expect(reading).toMatchObject({ severity: 'high', values: { dropPct: -2.7, volumeMultiple: 3.8 } })
  // "Four keys, no more": the batch shape must not survive under the refused decision.
  expect(Object.keys(reading!).sort()).toEqual(['observedAt', 'severity', 'values', 'window'])
  expect(parseSignalEvidence('queued', row!.evidenceJson)).toBeNull()
})

it('leaves a rewrite without a reading empty instead of inventing one', () => {
  const repo = repository()
  const rowId = repo.appendTriggerLedger(ledger({ decision: 'queued', reasonCode: 'significance-confirmed' }))
  repo.updateTriggerLedgerDecision(rowId, 'skipped', 'hour-budget-exhausted')
  const [row] = repo.listTriggerLedger(eventGroupId)
  expect(row).toMatchObject({ decision: 'skipped', evidenceJson: null })
  // Corrupt bytes become empty on the same pass: a row must not claim a reading it cannot state.
  const corruptId = repo.appendTriggerLedger(ledger({ id: 'mi-tl-2', changeHash: 'hash-2', decision: 'queued' }))
  repo.updateTriggerLedgerDecision(corruptId, 'skipped', 'day-budget-exhausted')
  expect(repo.listTriggerLedger(eventGroupId).find(row => row.id === corruptId)?.evidenceJson).toBeNull()
})

const signalKey = 'signal.open-interest.oi-liquidation-proxy'
const attempt = (overrides: Record<string, unknown> = {}) => ({
  id: 'mi-tl-s-1', eventGroupId, triggerKey: signalKey, changeHash: 'hash-signal',
  reasonCode: 'signal-high-triggered', evidence: queuedSignalEvidence([withWindow(signal())]),
  createdAt: asOf, ...overrides
})

it('records a signal attempt once, and a duplicate leaves every column untouched', () => {
  const repo = repository()
  expect(repo.appendSignalTrigger(attempt())).toEqual({ id: 'mi-tl-s-1', created: true, previous: null })
  const before = repo.listTriggerLedger(eventGroupId)[0]!
  // The same attempt arrives again ten minutes later, with a new id and a new reading.
  const again = repo.appendSignalTrigger(attempt({
    id: 'mi-tl-s-2', createdAt: '2026-10-09T12:10:00.000Z',
    evidence: queuedSignalEvidence([withWindow(signal({ severity: 'low', ruleId: 'oi-quiet' }))])
  }))
  expect(again).toEqual({ id: 'mi-tl-s-1', created: false, previous: { decision: 'queued', reasonCode: 'signal-high-triggered' } })
  expect(repo.listTriggerLedger(eventGroupId)).toHaveLength(1)
  // Every column, evidence included: nothing about the second call may leak into the stored row.
  expect(repo.listTriggerLedger(eventGroupId)[0]).toEqual(before)
})

it('does not rewrite a refused row into queued when the same attempt arrives again', () => {
  const repo = repository()
  const rowId = repo.appendTriggerLedger(ledger({
    triggerKey: signalKey, changeHash: 'hash-signal', decision: 'skipped', reasonCode: 'hour-budget-exhausted'
  }))
  const again = repo.appendSignalTrigger(attempt())
  expect(again).toMatchObject({ id: rowId, created: false, previous: { decision: 'skipped', reasonCode: 'hour-budget-exhausted' } })
  // Flipping it back to queued would count a run that never happened: the books and the queue would
  // disagree in the expensive direction.
  expect(repo.listTriggerLedger(eventGroupId)[0]).toMatchObject({ decision: 'skipped', reasonCode: 'hour-budget-exhausted', evidenceJson: null })
})

it('re-opens only the attempt whose enqueue failed, and only once', () => {
  const repo = repository()
  const rowId = repo.appendTriggerLedger(ledger({
    triggerKey: signalKey, changeHash: 'hash-signal', decision: 'skipped', reasonCode: 'signal-freeze-unavailable'
  }))
  expect(repo.appendSignalTrigger(attempt())).toMatchObject({
    id: rowId, created: false, previous: { decision: 'skipped', reasonCode: 'signal-freeze-unavailable' }
  })
  repo.rewriteSignalTrigger(rowId, {
    decision: 'queued', reasonCode: 'signal-high-triggered', evidence: queuedSignalEvidence([withWindow(signal())])
  })
  const [row] = repo.listTriggerLedger(eventGroupId)
  expect(row).toMatchObject({ decision: 'queued', reasonCode: 'signal-high-triggered' })
  // The reading comes back as the queued batch shape, not the refused row's four keys: leaving those
  // under `queued` is how the retry would read back as null.
  expect(parseSignalEvidence('queued', row!.evidenceJson)).toMatchObject({ signalCount: 1 })
  // The guard is the row's own state, so a second retry cannot re-open it.
  expect(() => repo.rewriteSignalTrigger(rowId, {
    decision: 'queued', reasonCode: 'signal-high-triggered', evidence: queuedSignalEvidence([withWindow(signal())])
  })).toThrowError('signal-trigger-rewrite-refused')
})

it('refuses to re-open a row that is not the failed-enqueue case', () => {
  const repo = repository()
  const queuedRow = repo.appendSignalTrigger(attempt()).id
  expect(() => repo.rewriteSignalTrigger(queuedRow, {
    decision: 'queued', reasonCode: 'signal-high-triggered', evidence: queuedSignalEvidence([withWindow(signal())])
  })).toThrowError('signal-trigger-rewrite-refused')
  const refusedRow = repo.appendTriggerLedger(ledger({
    id: 'mi-tl-refused', changeHash: 'hash-refused', decision: 'skipped', reasonCode: 'hour-budget-exhausted'
  }))
  expect(() => repo.rewriteSignalTrigger(refusedRow, {
    decision: 'queued', reasonCode: 'signal-high-triggered', evidence: queuedSignalEvidence([withWindow(signal())])
  })).toThrowError('signal-trigger-rewrite-refused')
})

it('refuses to put a refused reading back under a queued decision', () => {
  const repo = repository()
  const rowId = repo.appendTriggerLedger(ledger({
    triggerKey: signalKey, changeHash: 'hash-signal', decision: 'skipped', reasonCode: 'signal-freeze-unavailable'
  }))
  // Four keys under `queued` reads back as null through the decision-first parser, so the write itself
  // must reject it rather than store a shape no reader can use.
  expect(() => repo.rewriteSignalTrigger(rowId, {
    decision: 'queued', reasonCode: 'signal-high-triggered', evidence: skippedSignalEvidence(withWindow(signal()))
  })).toThrowError('signal-evidence-shape-mismatch')
  expect(repo.listTriggerLedger(eventGroupId)[0]).toMatchObject({ decision: 'skipped' })
})

it('keeps the attempt claimed across a receiver restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'mi-signal-claim-'))
  const filePath = join(directory, 'analysis.sqlite')
  try {
    const first = createMarketAnalysisRepository({ filePath })
    first.appendEventGroup({
      id: eventGroupId, schemaVersion: 1, status: 'monitoring', groupType: 'macro', mergeKey: 'signal|open-interest|2026-10-09',
      firstObservedAt: asOf, lastObservedAt: asOf, reviewDeadlineAt: '2026-10-09T14:00:00.000Z', eventRefs: [],
      triggerCount: 0, reviewCount: 0, currentSummaryId: null, supersededByGroupId: null, revision: 1, createdAt: asOf, updatedAt: asOf
    })
    expect(first.appendSignalTrigger(attempt())).toMatchObject({ created: true })
    first.close()
    // A new receiver against the same database: only the ledger can answer, so a memory set cannot
    // pass this one.
    const second = createMarketAnalysisRepository({ filePath })
    expect(second.appendSignalTrigger(attempt({ id: 'mi-tl-s-2', createdAt: '2026-10-09T12:10:00.000Z' })))
      .toMatchObject({ id: 'mi-tl-s-1', created: false, previous: { decision: 'queued' } })
    expect(second.listTriggerLedger(eventGroupId)).toHaveLength(1)
    second.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
