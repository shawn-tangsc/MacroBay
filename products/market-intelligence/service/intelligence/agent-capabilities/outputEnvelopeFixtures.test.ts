import { describe, expect, it } from 'vitest'

import type { IntelligenceAgentCapability, ToolCallContext } from './capabilityTypes'
import { projectTimelineRow } from './projections'
import { guardProductToolOutput } from './sensitiveDataGuard'
import { wrapProductToolHandler } from './wrapProductToolHandler'

/**
 * Real product reads return envelopes whose optional fields are own properties holding
 * `undefined`. JSON semantics drop those keys; the guard must accept them rather than reject
 * ordinary calls.
 */
const capability: IntelligenceAgentCapability = {
  id: 'get_test_envelope',
  domain: 'query',
  kind: 'read',
  title: { 'zh-CN': '测试信封', 'en-US': 'Test envelope' },
  description: 'Returns a representative product envelope.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: { type: 'object' },
  handlerId: 'market-intelligence.get-test-envelope',
  timeoutMs: 5_000,
  maxOutputBytes: 65_536
}

const context: ToolCallContext = {
  toolCallId: 'call-1',
  productId: 'market-intelligence',
  toolName: capability.id,
  schemaVersion: 1,
  agentId: 'agent-1',
  agentSessionId: 'session-1',
  signal: new AbortController().signal,
  log: async () => {}
}

const publicQueryEnvelope = {
  queryId: 'query-1',
  queryType: 'sentiment-snapshot',
  asOf: '2026-07-08T10:00:00.000Z',
  servedAt: '2026-07-08T10:00:01.000Z',
  scope: { sourceIds: ['coindesk-rss'] },
  timeWindow: {
    from: undefined,
    to: '2026-07-08T10:00:00.000Z',
    lookbackWindowMs: undefined
  },
  confidence: 0.5,
  caveats: ['insufficient-source-coverage'],
  sourceCoverage: [
    {
      sourceId: 'coindesk-rss',
      sourceKind: 'mainstream-news',
      layer: 'industry',
      focusMarkets: [],
      readiness: 'live',
      productionState: 'pending',
      includedInResult: false,
      latestSuccessAt: undefined,
      latestFailureAt: undefined,
      latestVisibleItemAt: undefined,
      confidence: 0.2,
      caveats: []
    }
  ],
  evidenceRefs: [],
  data: { aggregates: [] },
  resultHash: 'abcdef123456'
}

describe('output guard against real envelope fixtures', () => {
  it('wraps a public-query envelope whose optional window and coverage times are undefined', async () => {
    const handler = wrapProductToolHandler({ capability, handle: async () => publicQueryEnvelope })

    const result = (await handler.handle({}, context)) as typeof publicQueryEnvelope

    expect(result).toEqual({
      ...publicQueryEnvelope,
      timeWindow: { to: '2026-07-08T10:00:00.000Z' },
      sourceCoverage: [
        {
          sourceId: 'coindesk-rss',
          sourceKind: 'mainstream-news',
          layer: 'industry',
          focusMarkets: [],
          readiness: 'live',
          productionState: 'pending',
          includedInResult: false,
          confidence: 0.2,
          caveats: []
        }
      ]
    })
    expect(result.timeWindow).not.toHaveProperty('from')
    expect(result.timeWindow).not.toHaveProperty('lookbackWindowMs')
    expect(result.sourceCoverage[0]).not.toHaveProperty('latestSuccessAt')
    expect(result.sourceCoverage[0]).not.toHaveProperty('latestFailureAt')
    expect(result.sourceCoverage[0]).not.toHaveProperty('latestVisibleItemAt')
  })

  it('accepts translation statuses whose timestamps are undefined', () => {
    const statuses = {
      'item-1': {
        sourceType: 'rss',
        sourceId: 'coindesk-rss',
        targetLocale: 'zh-CN',
        status: 'pending',
        translatedAt: undefined,
        errorCode: undefined
      }
    }

    expect(guardProductToolOutput(statuses)).toEqual({
      'item-1': {
        sourceType: 'rss',
        sourceId: 'coindesk-rss',
        targetLocale: 'zh-CN',
        status: 'pending'
      }
    })
  })

  it('accepts a workspace timeline row with undefined clusterId and summary', () => {
    const row = {
      rowId: 'row-internal',
      identityKind: 'item',
      clusterId: undefined,
      itemId: 'item-1',
      sourceId: 'coindesk-rss',
      sourceName: 'CoinDesk',
      sourceGroup: 'mainstream-news',
      eventType: 'news',
      title: 'ETF inflows accelerate',
      summary: undefined,
      detectedAt: '2026-07-08T09:30:00.000Z',
      symbols: ['BTCUSDT'],
      alertStatus: 'none',
      hasRevision: false,
      relevance: 'watchlist',
      match: { eventId: 'event-1', matchedSymbols: ['BTCUSDT'] }
    }
    const projected = projectTimelineRow(row as never)

    const guarded = guardProductToolOutput(projected) as Record<string, unknown>

    expect(() => guardProductToolOutput(projected)).not.toThrow()
    expect(guarded.itemId).toBe('item-1')
    expect(guarded).not.toHaveProperty('clusterId')
    expect(guarded).not.toHaveProperty('summary')
    expect(guarded).not.toHaveProperty('rowId')
    expect(guarded).not.toHaveProperty('match')
  })
})
