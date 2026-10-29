import { describe, expect, it } from 'vitest'
import type { MarketAnalysisContextAvailable } from '../../../contracts/marketAnalysisContracts'
import { appendAnalysisEventEvidence } from './analysisEventEvidence'
import { appendAnalysisNewsSentiment, resolveNewsSentimentWindow } from './analysisNewsSentimentEvidence'

const asOf = '2026-10-29T12:00:00.000Z'

function context(overrides: Partial<MarketAnalysisContextAvailable> = {}): MarketAnalysisContextAvailable {
  return {
    state: 'available', schemaVersion: 1, profileId: 'crypto-market-analysis-v1', eventGroupId: 'mi-eg-1',
    asOf, dataCutoff: asOf, snapshotId: null, snapshotHash: null, facts: [], missingDomains: [], caveats: [],
    evidenceRefs: [], sourceHealth: [], domainAccess: [], ...overrides
  } as MarketAnalysisContextAvailable
}

type Item = Readonly<{
  itemId: string; title: string; displayTitle?: string; sourceId: string; sourceName: string
  publishedAt: string; polarity: 'bullish' | 'bearish' | 'neutral' | 'mixed'
  strength: number; confidence: number; symbols: readonly string[]
}>

function item(overrides: Partial<Item> = {}): Item {
  return {
    itemId: 'item-bull', title: 'Spot ETF inflows accelerate', displayTitle: '现货 ETF 净流入加速',
    sourceId: 'coindesk-rss', sourceName: 'CoinDesk RSS', publishedAt: '2026-10-29T11:20:00.000Z',
    polarity: 'bullish', strength: 4, confidence: 82, symbols: ['BTC'], ...overrides
  }
}

function evidence(itemId: string, publishedAt: string) {
  const ref = { evidenceRefId: `ev-${itemId}`, itemId, sourceId: 'coindesk-rss', visibleAt: publishedAt, publishedAt, detectedAt: publishedAt, excerptHash: 'a'.repeat(64) }
  return { evidenceRefs: [ref], data: { evidenceRef: ref, title: 'title', excerpt: 'excerpt' } }
}

const reader = (items: readonly Item[]) => ({
  query: async () => ({ state: 'available' as const, asOf, generatedAt: asOf, window: '1h' as const, items, caveats: [] })
})

describe('analysisNewsSentiment', () => {
  it('resolves the smallest fixed window covering the time since the last analysis', () => {
    expect(resolveNewsSentimentWindow(asOf, '2026-10-29T11:30:00.000Z').window).toBe('1h')
    expect(resolveNewsSentimentWindow(asOf, '2026-10-29T08:30:00.000Z').window).toBe('4h')
    expect(resolveNewsSentimentWindow(asOf, '2026-10-28T13:00:00.000Z').window).toBe('24h')
    expect(resolveNewsSentimentWindow(asOf, '2026-10-25T12:00:00.000Z').window).toBe('7d')
    // A very old boundary is capped at a week rather than asking for unbounded history.
    const capped = resolveNewsSentimentWindow(asOf, '2026-09-01T00:00:00.000Z')
    expect(capped.window).toBe('7d')
    expect(capped.sinceMs).toBe(Date.parse(asOf) - 7 * 24 * 60 * 60 * 1_000)
    // No previous analysis: the 24h fallback.
    expect(resolveNewsSentimentWindow(asOf, undefined).window).toBe('24h')
  })

  it('adds only non-neutral items published after the previous analysis, as citable facts', async () => {
    const items = [
      item({ itemId: 'item-bull', polarity: 'bullish' }),
      item({ itemId: 'item-bear', polarity: 'bearish', publishedAt: '2026-10-29T11:40:00.000Z', title: 'Exchange outage', displayTitle: '交易所故障' }),
      item({ itemId: 'item-neutral', polarity: 'neutral', publishedAt: '2026-10-29T11:50:00.000Z' }),
      item({ itemId: 'item-old', polarity: 'bullish', publishedAt: '2026-10-29T10:00:00.000Z' })
    ]
    const getEvidenceExcerpt = async (input: { itemId: string }) => {
      const found = items.find(entry => entry.itemId === input.itemId)!
      return evidence(found.itemId, found.publishedAt)
    }

    const updated = await appendAnalysisNewsSentiment(context(), { getEvidenceExcerpt } as never, reader(items) as never, {
      asOf, since: '2026-10-29T11:00:00.000Z'
    })

    expect(updated.facts.map(fact => fact.factId)).toHaveLength(2)
    const [first] = updated.facts
    expect(first).toMatchObject({
      domain: 'sentiment', metric: 'news-sentiment', subject: 'BTC', comparability: 'not-comparable', evidenceRefId: 'ev-item-bear'
    })
    expect(String(first!.value)).toContain('看空')
    expect(String(first!.value)).toContain('交易所故障')
    expect(updated.evidenceRefs.map(ref => ref.evidenceRefId).sort()).toEqual(['ev-item-bear', 'ev-item-bull'])
    // The neutral item and the one from before the last analysis are not in the run.
    expect(JSON.stringify(updated.facts)).not.toContain('item-neutral')
    expect(JSON.stringify(updated.facts)).not.toContain('item-old')
  })

  it('keeps the anchor excerpt as it is when the same item is also the top news', async () => {
    const getEvidenceExcerpt = async (input: { itemId: string }) => evidence(input.itemId, '2026-10-29T11:20:00.000Z')
    // The anchor evidence is added first, exactly as the freeze path does; the same item then
    // appearing in the sentiment list must not be relabelled a second time.
    const anchorContext = await appendAnalysisEventEvidence(
      context(), { eventRefs: ['item-bull'], groupType: 'sentiment' }, { getEvidenceExcerpt } as never
    )
    const updated = await appendAnalysisNewsSentiment(anchorContext, { getEvidenceExcerpt } as never,
      reader([item()]) as never, { asOf, since: '2026-10-29T11:00:00.000Z' })

    expect(updated.facts.filter(fact => fact.metric === 'news-sentiment')).toHaveLength(0)
    expect(updated.facts[0]).toMatchObject({ metric: 'event-excerpt', evidenceRefId: 'ev-item-bull' })
  })

  it('names an unavailable store instead of pretending there was no news', async () => {
    const unavailable = { query: async () => ({ state: 'unavailable' as const, asOf, generatedAt: asOf, window: '1h' as const, items: [], caveats: [] }) }
    const updated = await appendAnalysisNewsSentiment(context(), { getEvidenceExcerpt: async () => undefined } as never, unavailable as never, { asOf })
    expect(updated.caveats).toContain('news-sentiment-unavailable')
    expect(updated.facts).toHaveLength(0)

    // No reader wired at all is the same gap, not an empty window.
    const missing = await appendAnalysisNewsSentiment(context(), { getEvidenceExcerpt: async () => undefined } as never, undefined, { asOf })
    expect(missing.caveats).toContain('news-sentiment-unavailable')
  })

  it('adds nothing when the window has only neutral items', async () => {
    const getEvidenceExcerpt = async (input: { itemId: string }) => evidence(input.itemId, '2026-10-29T11:20:00.000Z')
    const updated = await appendAnalysisNewsSentiment(context(), { getEvidenceExcerpt } as never,
      reader([item({ polarity: 'neutral' })]) as never, { asOf, since: '2026-10-29T11:00:00.000Z' })
    expect(updated.facts).toHaveLength(0)
    expect(updated.caveats).not.toContain('news-sentiment-unavailable')
  })
})
