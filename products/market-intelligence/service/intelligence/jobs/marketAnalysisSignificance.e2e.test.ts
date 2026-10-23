import { expect, it } from 'vitest'
import type { AgentFact } from '../../../contracts/marketAnalysisContracts'
import { countAnalysisRuns, lastAutoRunAt } from '../analysis/analysisRunCounter'
import { createAnalysisSignificanceGate } from '../analysis/analysisSignificanceGate'
import { buildAnalysisMessages } from '../analysis/analysisModelPrompt'
import { projectPreviousBaseline } from '../analysis/previousSignificanceBaseline'
import { projectTriggerStatus } from '../analysis/triggerStatusProjection'
import { createMarketAnalysisRepository } from '../store/marketAnalysisRepository'
import { queryMacroRoute } from '../public-query/macroRouteQuery'
import { toTriggerHistory } from './registerMarketAnalysisRuntime'

const asOf = '2026-10-09T12:00:00.000Z'
const queuedAt = '2026-10-09T12:00:01.000Z'

/** A real repository, so the ledger's upsert, dedupe and read paths are exercised. */
function repository() {
  const repo = createMarketAnalysisRepository({ filePath: ':memory:' })
  repo.appendEventGroup({
    id: 'mi-eg-1', schemaVersion: 1, status: 'monitoring', groupType: 'macro', mergeKey: 'US.CPI', firstObservedAt: asOf,
    lastObservedAt: asOf, reviewDeadlineAt: '2026-10-09T14:00:00.000Z', eventRefs: ['item-1'], triggerCount: 0, reviewCount: 0,
    currentSummaryId: null, supersededByGroupId: null, revision: 1, createdAt: asOf, updatedAt: asOf
  })
  return repo
}

function macroFact(value: string): AgentFact {
  return {
    factId: 'mi-fact-macro-consumer-price-index-actual', domain: 'macro', subject: 'consumer-price-index', metric: 'actual', value,
    unit: null, sourceId: 'us-bls-official-calendar', sourceLabel: 'us-bls-official-calendar', observedAt: asOf, asOf,
    freshness: 'fresh', confidence: 1, comparability: 'comparable',
    evidenceRefId: 'macro-calendar:us-bls-official-calendar:US.CPI.RELEASE.2026-M09'
  }
}

const official = (actual: string, detectedAt: string) => ({
  eventKey: 'US.CPI.RELEASE.2026-M09', releaseGroupKey: 'g', eventFamily: 'consumer-price-index', titleKey: 'cpi', countryCode: 'US' as const,
  importance: 'high' as const, periodKey: 'p', lifecycleState: 'released' as const, coverage: 'available' as const,
  scheduledDate: '2026-10-13', detectedAt, providerIds: ['us-bls-official-calendar'], caveats: [], actual: { displayValue: actual }
})

function gateFor(repo: ReturnType<typeof repository>, current: readonly unknown[]) {
  return createAnalysisSignificanceGate({
    now: () => queuedAt,
    queryMacroRoute: (input) => queryMacroRoute({ queryMacroEconomicCalendarMonth: async ({ month }) => month === '2026-10' ? { state: 'available', asOf, events: current } as never : { state: 'available', asOf, events: [] } as never }, input),
    countRuns: (now) => countAnalysisRuns(repo, now),
    lastAutoRunAt: (eventGroupId, now) => lastAutoRunAt(repo, eventGroupId, now),
    recordDecision: (decision) => repo.appendTriggerLedger({ id: `mi-tl-${Math.random().toString(36).slice(2, 8)}`, ...decision, snapshotHash: null, analysisRunId: null, createdAt: queuedAt } as never)
  })
}

it('does not spend a run on a refresh that re-collected identical values, and says so', async () => {
  const repo = repository()
  const previousSnapshot = { asOf: '2026-10-09T06:00:00.000Z', facts: [macroFact('3.2%')] }
  const outcome = await gateFor(repo, [official('3.2%', '2026-10-09T11:00:00.000Z')])
    .evaluate({ eventGroupId: 'mi-eg-1', triggerKey: 'calendar.refresh', asOf, previousSnapshot })
  expect(outcome).toMatchObject({ decision: 'skipped', reasonCode: 'significance-below-threshold' })
  // Exactly one ledger row, and the panel can explain it.
  const ledger = repo.listTriggerLedger('mi-eg-1')
  expect(ledger).toHaveLength(1)
  // Attribution is per run: the decision is explainable for the run this key would produce.
  expect(projectTriggerStatus(ledger, { triggerKey: 'calendar.refresh', queuedAt, completedAt: queuedAt })).toMatchObject({ triggerKey: 'calendar.refresh', reasonCode: 'significance-below-threshold' })
  expect(projectPreviousBaseline(previousSnapshot)?.values.get('macro|consumer-price-index|actual|US.CPI.RELEASE.2026-M09')).toBe('3.2%')
})

it('queues a released value, carries the reason into the prompt, and shows it on the panel', async () => {
  const repo = repository()
  const previousSnapshot = { asOf: '2026-10-09T06:00:00.000Z', facts: [macroFact('3.1%')] }
  const outcome = await gateFor(repo, [official('3.2%', '2026-10-09T11:00:00.000Z')])
    .evaluate({ eventGroupId: 'mi-eg-1', triggerKey: 'calendar.refresh', asOf, previousSnapshot })
  expect(outcome).toMatchObject({ decision: 'queued', reasonCode: 'significance-confirmed' })
  // The run payload carries the reasons the prompt is built from.
  const messages = buildAnalysisMessages({ profileId: 'crypto-market-analysis-v1', asOf, dataCutoff: asOf, facts: [macroFact('3.2%')], missingDomains: [], caveats: [], evidenceRefs: [], sourceHash: null } as never, outcome.signals)
  expect(JSON.parse(messages[1]!.content as string).triggers).toEqual([expect.stringContaining('消费者物价指数（CPI）')])
  // The ledger row is a queue, not a skip, and the count reflects the delivered run.
  expect(projectTriggerStatus(repo.listTriggerLedger('mi-eg-1'), { triggerKey: 'calendar.refresh', queuedAt, completedAt: queuedAt })).toMatchObject({ reasonCode: 'significance-confirmed' })
  expect(countAnalysisRuns(repo, queuedAt)).toMatchObject({ dayRuns: 1, eventRunsToday: 1, scheduledRunsToday: 0 })
})

it('coalesces a second wave inside the window, and lets the session slot through anyway', async () => {
  const repo = repository()
  const previousSnapshot = { asOf: '2026-10-09T06:00:00.000Z', facts: [macroFact('3.1%')] }
  const gate = gateFor(repo, [official('3.2%', '2026-10-09T11:00:00.000Z')])
  await gate.evaluate({ eventGroupId: 'mi-eg-1', triggerKey: 'calendar.refresh', asOf, previousSnapshot })
  // A second delivery inside thirty minutes is coalesced against the first.
  const second = await gateFor(repo, [official('3.3%', '2026-10-09T11:30:00.000Z')])
    .evaluate({ eventGroupId: 'mi-eg-1', triggerKey: 'calendar.refresh', asOf, previousSnapshot })
  expect(second).toMatchObject({ decision: 'skipped', reasonCode: 'interval-active' })
  // The floor ignores the interval and the hourly gate, and books against its own quota.
  const slot = await gateFor(repo, [official('3.3%', '2026-10-09T11:30:00.000Z')])
    .evaluate({ eventGroupId: 'mi-eg-1', triggerKey: 'schedule.asia.open', asOf, previousSnapshot })
  expect(slot).toMatchObject({ decision: 'queued', reasonCode: 'session-slot-asia' })
  expect(countAnalysisRuns(repo, queuedAt)).toMatchObject({ dayRuns: 2, eventRunsToday: 1, scheduledRunsToday: 1 })
})

it('never lets an automatic row disturb the item path history', async () => {
  const repo = repository()
  const previousSnapshot = { asOf: '2026-10-09T06:00:00.000Z', facts: [macroFact('3.2%')] }
  await gateFor(repo, [official('3.2%', '2026-10-09T11:00:00.000Z')])
    .evaluate({ eventGroupId: 'mi-eg-1', triggerKey: 'calendar.refresh', asOf, previousSnapshot })
  const phases = repo.listTriggerLedger('mi-eg-1').map(row => toTriggerHistory(row).phase)
  expect(phases).toEqual(['correction'])
})
