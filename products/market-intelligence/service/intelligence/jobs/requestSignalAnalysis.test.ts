import { expect, it, vi } from 'vitest'

import type { EventGroup } from '../../../contracts/marketAnalysisContracts'
import { createAnalysisSignificanceGate } from '../analysis/analysisSignificanceGate'
import { countAnalysisRuns } from '../analysis/analysisRunCounter'
import { analysisRunLineOf } from '../analysis/analysisTriggerSourcePolicy'
import { createSignalAnalysisRequest, signalGroupMergeKey, type SignalAnalysisRequest } from './requestSignalAnalysis'
import { FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB } from './marketAnalysisJobIds'

const asOf = '2026-11-03T06:30:00.000Z'

type LedgerRow = { id: string; eventGroupId: string; triggerKey: string; changeHash: string; decision: string; reasonCode: string; snapshotHash: string | null; analysisRunId: string | null; createdAt: string }

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
        if (existing) { Object.assign(existing, { decision: row.decision, reasonCode: row.reasonCode }); return existing.id }
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

function request(overrides: Partial<SignalAnalysisRequest> = {}): SignalAnalysisRequest {
  return {
    triggerKey: 'signal.open-interest.oi-liquidation-proxy',
    moduleId: 'open-interest',
    ruleId: 'oi-liquidation-proxy',
    groupType: 'funding',
    severity: 'high',
    observedAt: asOf,
    changeHash: 'oi|oi-liquidation-proxy|BTC|2026-11-03T06:30',
    ...overrides
  }
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

it('refuses a key that is not exactly signal.<moduleId>.<ruleId>', async () => {
  const { service } = entry()
  await expect(service(request({ triggerKey: 'signal.debug' }))).rejects.toThrow('analysis-invalid-request')
  await expect(service(request({ triggerKey: 'signal.other-module.oi-liquidation-proxy' }))).rejects.toThrow('analysis-invalid-request')
  await expect(service(request({ severity: 'low' as never }))).rejects.toThrow('analysis-invalid-request')
  await expect(service(request({ observedAt: 'yesterday' }))).rejects.toThrow('analysis-invalid-request')
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
  expect(ledger[0]).toMatchObject({ triggerKey: request().triggerKey, decision: 'queued', reasonCode: 'signal-high-triggered' })
  expect(enqueued[0]).toMatchObject({
    handlerId: FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB,
    payload: expect.objectContaining({
      eventGroupId: group?.id,
      triggerKey: request().triggerKey,
      analysisPhase: 'correction',
      asOf,
      attemptLedgerId: ledger[0]?.id
    })
  })
})

it('reuses the same day\u2019s group for another rule of the same module', async () => {
  const { service, groups, ledger } = entry()

  await service(request())
  await service(request({
    triggerKey: 'signal.open-interest.oi-short-crowded', ruleId: 'oi-short-crowded',
    changeHash: 'oi|oi-short-crowded|BTC|2026-11-03T06:30'
  }))

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

  expect(await gate.evaluate({ eventGroupId: ledger[0]!.eventGroupId, triggerKey: request().triggerKey, asOf, attemptLedgerId }))
    .toMatchObject({ decision: 'queued', reasonCode: null })
  expect(recordDecision).not.toHaveBeenCalled()

  // Now the event line is full: the attempt the entry already wrote must stop counting.
  for (let index = 0; index < 48; index += 1) {
    ledger.push({
      id: `mi-ledger-seed-${index}`, eventGroupId: ledger[0]!.eventGroupId, triggerKey: 'signal.open-interest.seed',
      changeHash: `seed-${index}`, decision: 'queued', reasonCode: 'signal-high-triggered', snapshotHash: null, analysisRunId: null, createdAt: asOf
    })
  }
  expect(await gate.evaluate({ eventGroupId: ledger[0]!.eventGroupId, triggerKey: request().triggerKey, asOf, attemptLedgerId }))
    .toMatchObject({ decision: 'skipped', reasonCode: 'day-budget-exhausted' })
  expect(ledger.find(row => row.id === attemptLedgerId)).toMatchObject({ decision: 'skipped', reasonCode: 'day-budget-exhausted' })
})
