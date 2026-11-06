import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { JobHandler, JobRuntime } from '@platform/jobs'

import type { IntelligencePipeline } from '../application/intelligencePipeline'
import type { MarketIntelligencePublicQueryService } from '../public-query/publicQueryService'
import type { MetricIntelligenceEvent } from '../schema/intelligenceMetricEvent'
import type { IntelligenceItem } from '../schema/intelligenceRecord'
import { FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB, GROUP_MARKET_ANALYSIS_CHANGE_JOB } from './marketAnalysisJobIds'
import { registerMarketAnalysisRuntime } from './registerMarketAnalysisRuntime'

const releaseAt = '2026-11-05T00:00:00.000Z'
const collectedAt = '2026-11-05T00:58:00.000Z'
const now = '2026-11-05T00:59:00.000Z'

type MacroIndicator = Readonly<{ itemId: string; title: string; metricKey: string; period: string; releaseTime?: string }>
type LedgerRow = Readonly<{ decision: string; reasonCode: string; eventGroupId: string }>

function macroItem(indicator: MacroIndicator): IntelligenceItem {
  return {
    itemId: indicator.itemId, primaryRawRecordId: `raw-${indicator.itemId}`,
    canonicalDedupeKey: `metric:fred-rates-liquidity:${indicator.metricKey}:${indicator.period}`,
    sourceId: 'fred-rates-liquidity', eventType: 'rate', title: indicator.title, sourceCategory: 'macro',
    sourceTrust: 'high', publishedAt: indicator.releaseTime ?? releaseAt, detectedAt: collectedAt,
    severityHint: 'critical', timelineStatus: 'evaluated', normalizerVersion: 'v1',
    processingLabelsJson: JSON.stringify({ dataDomain: 'macro', relevanceOutcome: 'full-intelligence', sentimentEligible: true })
  }
}

function metricEvent(indicator: MacroIndicator): MetricIntelligenceEvent {
  return {
    metricEventId: `metric-${indicator.itemId}`, itemId: indicator.itemId, sourceId: 'fred-rates-liquidity',
    metricKey: indicator.metricKey, metricName: indicator.title, metricKind: 'treasury-yield', actual: 4.1,
    period: indicator.period, releaseTime: indicator.releaseTime ?? releaseAt,
    comparisonBasis: 'period-change', surpriseDirection: 'unknown', metricVersion: 'v1'
  }
}

/** The five series FRED publishes together: one release, five items, five subjects. */
const oneRelease: readonly MacroIndicator[] = [
  { itemId: 'item-2y', title: '美国 2 年期国债收益率', metricKey: 'US_2Y_YIELD', period: '2026-11-05' },
  { itemId: 'item-10y', title: '美国 10 年期国债收益率', metricKey: 'US_10Y_YIELD', period: '2026-11-05' },
  { itemId: 'item-real', title: '美国 10 年期实际利率', metricKey: 'US_10Y_REAL_YIELD', period: '2026-11-05' },
  { itemId: 'item-breakeven', title: '美债 10 年期盈亏平衡通胀', metricKey: 'US_10Y_BREAKEVEN_INFLATION', period: '2026-11-05' },
  { itemId: 'item-term', title: '10Y−2Y 期限利差', metricKey: 'US_10Y_2Y_TERM_SPREAD', period: '2026-11-05' }
]

/**
 * The real handler chain with the scheduler and the model cut out: grouping, the trigger policy,
 * the release check and the ledger all run against SQLite exactly as they do in the app.
 */
async function createHarness(input: Readonly<{ withMetricEvents?: boolean }> = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'mi-analysis-release-'))
  const clock = { now }
  const items: IntelligenceItem[] = []
  const metricEvents: MetricIntelligenceEvent[] = []
  const handlers = new Map<string, JobHandler>()
  const enqueued: { handlerId: string; payload: Record<string, unknown> }[] = []
  const jobRuntime = {
    registerHandler: (id: string, handler: JobHandler) => { handlers.set(id, handler) },
    enqueueDefinition: async (definition: { id: string; handlerId: string; payload: Record<string, unknown> }) => {
      enqueued.push({ handlerId: definition.handlerId, payload: definition.payload })
      return { id: definition.id }
    }
  } as unknown as JobRuntime
  const runtime = registerMarketAnalysisRuntime({
    jobRuntime,
    pipeline: {
      listItems: () => items,
      listRevisions: () => [],
      listMetricEvents: () => metricEvents
    } as unknown as IntelligencePipeline,
    publicQueryService: {} as MarketIntelligencePublicQueryService,
    structuredModelInvocation: { invoke: async () => { throw new Error('grouping must not call the model') } },
    dataDir, now: () => clock.now
  })
  const context = {
    jobRunId: 'release-coalescing', signal: new AbortController().signal,
    log: async () => undefined, progress: async () => undefined
  }
  return {
    /** Publishes one collection pass and runs the real group-change handler for each indicator. */
    async publish(indicators: readonly MacroIndicator[], at: string = clock.now): Promise<void> {
      clock.now = at
      for (const indicator of indicators) {
        const item = macroItem(indicator)
        if (!items.some(existing => existing.itemId === item.itemId)) items.push(item)
        if (input.withMetricEvents !== false) {
          const event = metricEvent(indicator)
          if (!metricEvents.some(existing => existing.metricEventId === event.metricEventId)) metricEvents.push(event)
        }
        await handlers.get(GROUP_MARKET_ANALYSIS_CHANGE_JOB)!({ changeId: item.itemId, eventRef: item.itemId }, context)
      }
    },
    state(): { groups: number; freezes: readonly { handlerId: string; payload: Record<string, unknown> }[]; ledger: readonly LedgerRow[] } {
      const groups = runtime.repository.listEventGroups()
      return {
        groups: groups.length,
        freezes: enqueued.filter(entry => entry.handlerId === FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB),
        ledger: groups.flatMap(group => runtime.repository.listTriggerLedger(group.id)
          .map(row => ({ decision: row.decision, reasonCode: row.reasonCode, eventGroupId: group.id })))
      }
    },
    async dispose(): Promise<void> {
      runtime.dispose()
      await rm(dataDir, { recursive: true, force: true })
    }
  }
}

describe('market analysis same-release coalescing', () => {
  it('turns five indicators of one release into one analysis and leaves a reason on each of the other four', async () => {
    const harness = await createHarness()
    try {
      await harness.publish(oneRelease)
      const state = harness.state()
      // One release, one queued attempt: the freeze stage is entered once.
      expect(state.freezes).toHaveLength(1)
      expect(state.groups).toBe(5)
      const coalesced = state.ledger.filter(row => row.reasonCode === 'same-release-coalesced')
      expect(coalesced).toHaveLength(4)
      // Each skipped indicator explains itself on its own group, so no row is left unexplained.
      expect(new Set(coalesced.map(row => row.eventGroupId)).size).toBe(4)
      expect(coalesced.every(row => row.decision === 'skipped')).toBe(true)
      expect(state.ledger.filter(row => row.decision === 'queued')).toHaveLength(1)
      expect(state.ledger).toHaveLength(5)
    } finally {
      await harness.dispose()
    }
  })

  it('leaves two different reporting periods at two runs, even two minutes apart', async () => {
    const harness = await createHarness()
    try {
      await harness.publish([
        { itemId: 'item-period-10', title: '美国 10 月 CPI 同比', metricKey: 'US_CPI_YOY', period: '2026-10', releaseTime: '2026-11-05T00:00:00.000Z' },
        { itemId: 'item-period-09', title: '美国 9 月 CPI 同比', metricKey: 'US_CPI_YOY', period: '2026-09', releaseTime: '2026-11-05T00:02:00.000Z' }
      ])
      const state = harness.state()
      expect(state.freezes).toHaveLength(2)
      expect(state.ledger.filter(row => row.reasonCode === 'same-release-coalesced')).toHaveLength(0)
      expect(state.ledger.filter(row => row.decision === 'queued')).toHaveLength(2)
    } finally {
      await harness.dispose()
    }
  })

  it('gives an indicator that arrives after the window its own run', async () => {
    const harness = await createHarness()
    try {
      await harness.publish(oneRelease.slice(0, 2))
      // Eighteen minutes later the earlier attempt no longer covers the release.
      await harness.publish([oneRelease[2]!], '2026-11-05T01:16:00.000Z')
      const state = harness.state()
      expect(state.freezes).toHaveLength(2)
      expect(state.ledger.filter(row => row.reasonCode === 'same-release-coalesced')).toHaveLength(1)
    } finally {
      await harness.dispose()
    }
  })

  it('does not merge an item whose release cannot be read, instead of guessing from its title', async () => {
    const harness = await createHarness({ withMetricEvents: false })
    try {
      await harness.publish(oneRelease)
      const state = harness.state()
      expect(state.freezes).toHaveLength(5)
      expect(state.ledger.filter(row => row.reasonCode === 'same-release-coalesced')).toHaveLength(0)
    } finally {
      await harness.dispose()
    }
  })
})
