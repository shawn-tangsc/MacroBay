import { expect, it, vi } from 'vitest'

import type { EventGroup } from '../../../contracts/marketAnalysisContracts'
import type { ModuleSignal, SignalWindow } from '../../../contracts/moduleSignal'
import { createAnalysisSignificanceGate } from '../analysis/analysisSignificanceGate'
import { countAnalysisRuns } from '../analysis/analysisRunCounter'
import { analysisRunLineOf } from '../analysis/analysisTriggerSourcePolicy'
import { createSignalAnalysisRequest, signalGroupMergeKey, type SignalAnalysisRequest } from './requestSignalAnalysis'
import { FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB } from './marketAnalysisJobIds'

const asOf = '2026-11-03T06:30:00.000Z'

type LedgerRow = { id: string; eventGroupId: string; triggerKey: string; changeHash: string; decision: string; reasonCode: string; snapshotHash: string | null; analysisRunId: string | null; createdAt: string; evidence?: unknown }

/** Just the repository surface the entry and the counter touch. */
function fakeRepository() {
  const groups = new Map<string, EventGroup>()
  const ledger: LedgerRow[] = []
  return {
    groups,
    ledger,
    repository: {
      appendEventGroup: (group: EventGroup) => { groups.set(group.id, group) },
      findEventGroupByMergeKey: (mergeKey: string) => [...groups.values()].find(group => group.mergeKey === mergeKey),
      listEventGroups: () => [...groups.values()],
      listRuns: () => [] as readonly unknown[],
      appendTriggerLedger: (row: LedgerRow) => {
        const existing = ledger.find(entry => entry.eventGroupId === row.eventGroupId && entry.triggerKey === row.triggerKey && entry.changeHash === row.changeHash)
        if (existing) { Object.assign(existing, { decision: row.decision, reasonCode: row.reasonCode, evidence: row.evidence }); return existing.id }
        ledger.push(row)
        return row.id
      },
      updateTriggerLedgerDecision: (rowId: string, decision: string, reasonCode: string) => {
        const row = ledger.find(entry => entry.id === rowId)
        if (row) Object.assign(row, { decision, reasonCode })
      },
      listTriggerLedger: (eventGroupId: string) => ledger.filter(row => row.eventGroupId === eventGroupId)
    }
  }
}

function fakeJobs(options: Readonly<{ inFlightFreeze?: boolean; fail?: boolean }> = {}) {
  const enqueued: Record<string, unknown>[] = []
  return {
    enqueued,
    jobRuntime: {
      enqueueDefinition: vi.fn(async (definition: Record<string, unknown>) => {
        if (options.fail) throw new Error('job-runtime-unavailable')
        enqueued.push(definition)
        return { id: `job-${enqueued.length}` }
      }),
      listRuns: vi.fn(() => options.inFlightFreeze ? [{ id: 'job-in-flight' }] : [])
    }
  }
}

function signal(overrides: Partial<ModuleSignal> = {}): ModuleSignal {
  return {
    version: '1',
    moduleId: 'open-interest',
    ruleId: 'oi-liquidation-proxy',
    asset: 'btc',
    severity: 'high',
    observedAt: asOf,
    cadence: { kind: 'intraday', bucketMs: 15 * 60 * 1_000 },
    values: { change24hPct: -1.9, volumeMultiple: 3.4 },
    dedupeKey: 'oi|oi-liquidation-proxy|BTC|2026-11-03T06:30',
    readiness: 'available',
    triggerOwner: 'module-signal',
    ...overrides
  }
}

const window: SignalWindow = { unit: 'buckets', amount: 1, bucketMs: 15 * 60 * 1_000, upperBoundMs: 15 * 60 * 1_000 }

function request(overrides: Partial<ModuleSignal> = {}, groupType: SignalAnalysisRequest['groupType'] = 'funding'): SignalAnalysisRequest {
  return { signal: signal(overrides), window, groupType }
}

function entry(overrides: Readonly<{ inFlightFreeze?: boolean; fail?: boolean; enabled?: boolean }> = {}) {
  const { groups, ledger, repository } = fakeRepository()
  const { enqueued, jobRuntime } = fakeJobs(overrides)
  let sequence = 0
  const service = createSignalAnalysisRequest({
    repository: repository as never,
    jobRuntime: jobRuntime as never,
    now: () => asOf,
    idFactory: () => `${++sequence}`,
    isEnabled: async () => overrides.enabled ?? true
  })
  return { service, groups, ledger, repository, enqueued, jobRuntime }
}

it('names every module signal as the event line, never the calendar line', () => {
  expect(analysisRunLineOf('signal.open-interest.oi-liquidation-proxy')).toBe('event')
  expect(analysisRunLineOf('signal.etf-flows.three-day-outflow')).toBe('event')
  // A key without both segments falls to the stricter default line (`924bcb4`), and the entry
  // refuses it outright anyway: an unregistered key must never spend the event allowance.
  expect(analysisRunLineOf('signal.debug')).toBe('calendar')
  expect(analysisRunLineOf('signal.a.b.c')).toBe('calendar')
})

it('refuses a signal that cannot produce a complete trigger key', async () => {
  const { service } = entry()
  // A rule id that is not a kebab token has no key; a module outside the closed set has none either.
  await expect(service(request({ ruleId: 'oi_liquidation' }))).rejects.toThrow('analysis-invalid-request')
  await expect(service(request({ moduleId: 'unknown-module' as never }))).rejects.toThrow('analysis-invalid-request')
  // Low only marks the board; letting it in would spend a call for a display.
  await expect(service(request({ severity: 'low' }))).rejects.toThrow('analysis-invalid-request')
  await expect(service(request({ observedAt: 'yesterday' }))).rejects.toThrow('analysis-invalid-request')
  // "Data did not arrive" is not "the rule fired": an unavailable signal would spend a call to be
  // told the reading is missing.
  await expect(service(request({ readiness: 'unavailable' }))).rejects.toThrow('analysis-invalid-request')
  // An event another key owns is analysed by that key's line; queueing it here would spend twice.
  await expect(service(request({ triggerOwner: 'calendar.refresh' }))).rejects.toThrow('analysis-invalid-request')
})

it('writes nothing when the capability is off', async () => {
  const { service, groups, ledger, enqueued } = entry({ enabled: false })

  expect(await service(request())).toEqual({ state: 'disabled' })
  expect(groups.size).toBe(0)
  expect(ledger).toHaveLength(0)
  expect(enqueued).toHaveLength(0)
})

it('anchors the signal on its own group, writes the attempt row, then queues the freeze', async () => {
  const { service, groups, ledger, enqueued } = entry()

  const outcome = await service(request())

  const group = [...groups.values()][0]
  expect(outcome).toMatchObject({ state: 'queued', groupId: group?.id })
  expect(group).toMatchObject({
    mergeKey: signalGroupMergeKey('open-interest', asOf),
    groupType: 'funding', status: 'open', eventRefs: []
  })
  // The row says which severity let it through, and it is the id the freeze carries so a refusal
  // can rewrite this very row instead of counting a call that never happened.
  expect(ledger).toHaveLength(1)
  expect(ledger[0]).toMatchObject({ triggerKey: 'signal.open-interest.oi-liquidation-proxy', decision: 'queued', reasonCode: 'signal-high-triggered' })
  expect(enqueued[0]).toMatchObject({
    handlerId: FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB,
    payload: expect.objectContaining({
      eventGroupId: group?.id,
      triggerKey: 'signal.open-interest.oi-liquidation-proxy',
      analysisPhase: 'correction',
      asOf,
      attemptLedgerId: ledger[0]?.id
    })
  })
})

/**
 * The duplicate the funds line reproduced: the ledger's unique key stopped the second *row*, but the
 * queue decision came after that row was written, so the same bucket queued twice — two analyses
 * for one event, counted once.
 */
it('queues one run per bucket, so the same signal does not call the model twice', async () => {
  const { service, ledger, enqueued } = entry()

  expect((await service(request())).state).toBe('queued')
  expect((await service(request())).state).toBe('duplicate')

  expect(ledger).toHaveLength(1)
  expect(enqueued).toHaveLength(1)
})

it('still refuses the bucket after a restart: the judgement reads the ledger, not memory', async () => {
  const { ledger, repository } = fakeRepository()
  // Two wirings over the same ledger: the second is what a restart builds, with nothing in memory.
  const wiring = () => {
    const { enqueued, jobRuntime } = fakeJobs()
    const service = createSignalAnalysisRequest({
      repository: repository as never, jobRuntime: jobRuntime as never,
      now: () => asOf, idFactory: () => '1', isEnabled: async () => true
    })
    return { service, enqueued }
  }
  const before = wiring()
  const after = wiring()

  expect((await before.service(request())).state).toBe('queued')
  expect((await after.service(request())).state).toBe('duplicate')

  expect(ledger).toHaveLength(1)
  expect(before.enqueued).toHaveLength(1)
  expect(after.enqueued).toHaveLength(0)
})

it('does not retry a bucket the budget refused', async () => {
  const { service, ledger, enqueued } = entry()
  const first = await service(request())
  const attemptLedgerId = first.state === 'queued' ? first.attemptLedgerId : ''
  ledger[0]!.decision = 'skipped'
  ledger[0]!.reasonCode = 'hour-budget-exhausted'

  expect((await service(request())).state).toBe('duplicate')
  expect(ledger[0]!.id).toBe(attemptLedgerId)
  expect(enqueued).toHaveLength(1)
})

it('retries only the attempt that never reached the queue, reusing its row', async () => {
  const { service, ledger, enqueued } = entry()
  const first = await service(request())
  const attemptLedgerId = first.state === 'queued' ? first.attemptLedgerId : ''
  // The queue refused the work: that call was never spent, so the same bucket may try again.
  ledger[0]!.decision = 'skipped'
  ledger[0]!.reasonCode = 'signal-freeze-unavailable'

  expect((await service(request())).state).toBe('queued')
  expect(ledger).toHaveLength(1)
  expect(ledger[0]!.id).toBe(attemptLedgerId)
  expect(ledger[0]!.decision).toBe('queued')
  expect(enqueued).toHaveLength(2)
})

/**
 * The architect's catch: a row without readings keeps the counts and the "why" blank, and nothing
 * fails. The one column that can answer both is written with the row.
 */
it('stores the readings behind the run, so the bar and the detail are not blank', async () => {
  const { service, ledger } = entry()

  await service(request({ severity: 'medium' }))

  const evidence = ledger[0]?.evidence as { signalCount?: number; signals?: readonly Record<string, unknown>[] } | undefined
  expect(evidence?.signalCount).toBe(1)
  // Exactly the seven entry keys: the refused-signal four plus what identifies it within a batch.
  expect(Object.keys(evidence?.signals?.[0] ?? {}).sort())
    .toEqual(['asset', 'moduleId', 'observedAt', 'ruleId', 'severity', 'values', 'window'])
  expect(evidence?.signals?.[0]).toMatchObject({
    severity: 'medium', moduleId: 'open-interest', ruleId: 'oi-liquidation-proxy', asset: 'btc',
    values: { change24hPct: -1.9, volumeMultiple: 3.4 }
  })
})

it('reuses the same day\u2019s group for another rule of the same module', async () => {
  const { service, groups, ledger } = entry()

  await service(request())
  await service(request({ ruleId: 'oi-short-crowded', dedupeKey: 'oi|oi-short-crowded|BTC|2026-11-03T06:30' }))

  expect(groups.size).toBe(1)
  expect(ledger).toHaveLength(2)
})

it('does not queue twice while a freeze is already in flight for the group', async () => {
  const { service, ledger, enqueued } = entry({ inFlightFreeze: true })

  expect(await service(request())).toMatchObject({ state: 'in-flight' })
  expect(ledger).toHaveLength(0)
  expect(enqueued).toHaveLength(0)
})

it('flips the row to skipped when the queue refuses the work, so no call is charged', async () => {
  const { service, ledger } = entry({ fail: true })

  await expect(service(request())).rejects.toThrow('job-runtime-unavailable')
  expect(ledger[0]).toMatchObject({ decision: 'skipped', reasonCode: 'signal-freeze-unavailable' })
})

/**
 * The acceptance the plan asks for: one OI signal reaches the gate with its own key, the gate
 * writes no second decision, and the spend lands on the event line — not the calendar's nine.
 */
it('spends the event line, and lets the gate refuse it there when that line is full', async () => {
  const { service, ledger, repository } = entry()
  const queued = await service(request())
  expect(queued.state).toBe('queued')
  const attemptLedgerId = queued.state === 'queued' ? queued.attemptLedgerId : ''

  const counts = countAnalysisRuns(repository as never, asOf)
  expect(counts).toMatchObject({ eventRunsToday: 1, calendarRunsToday: 0, scheduledRunsToday: 0 })

  const recordDecision = vi.fn()
  const updateDecision = vi.fn((rowId: string, decision: 'skipped', reasonCode: string) => { repository.updateTriggerLedgerDecision(rowId, decision, reasonCode) })
  const gate = createAnalysisSignificanceGate({
    now: () => asOf,
    queryMacroRoute: async () => { throw new Error('signals never read the macro route') },
    recordDecision,
    updateDecision,
    countRuns: (at: string, excludedRowId?: string) => countAnalysisRuns(repository as never, at, excludedRowId),
    lastAutoRunAt: () => null
  })

  expect(await gate.evaluate({ eventGroupId: ledger[0]!.eventGroupId, triggerKey: 'signal.open-interest.oi-liquidation-proxy', asOf, previousSnapshot: null, attemptLedgerId }))
    .toMatchObject({ decision: 'queued', reasonCode: null })
  expect(recordDecision).not.toHaveBeenCalled()

  // Now the event line is full: the attempt the entry already wrote must stop counting.
  for (let index = 0; index < 48; index += 1) {
    ledger.push({
      id: `mi-ledger-seed-${index}`, eventGroupId: ledger[0]!.eventGroupId, triggerKey: 'signal.open-interest.seed',
      changeHash: `seed-${index}`, decision: 'queued', reasonCode: 'signal-high-triggered', snapshotHash: null, analysisRunId: null, createdAt: asOf
    })
  }
  expect(await gate.evaluate({ eventGroupId: ledger[0]!.eventGroupId, triggerKey: 'signal.open-interest.oi-liquidation-proxy', asOf, previousSnapshot: null, attemptLedgerId }))
    .toMatchObject({ decision: 'skipped', reasonCode: 'day-budget-exhausted' })
  expect(ledger.find(row => row.id === attemptLedgerId)).toMatchObject({ decision: 'skipped', reasonCode: 'day-budget-exhausted' })
})
