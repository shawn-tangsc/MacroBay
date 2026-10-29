import { describe, expect, it } from 'vitest'
import type { MarketAnalysisContextAvailable } from '../../../contracts/marketAnalysisContracts'
import { appendAnalysisEventEvidence } from './analysisEventEvidence'
import { appendAnalysisNewsSentiment, newsSentimentSince, resolveNewsSentimentWindow } from './analysisNewsSentimentEvidence'

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
  it('starts at the later of the last analysis and the previous 8-hour session slot', () => {
    // asOf = 20:00 Asia/Shanghai; the previous open strictly before it is 16:00 local (08:00Z).
    const previousSlot = Date.parse('2026-10-29T08:00:00.000Z')
    expect(resolveNewsSentimentWindow(asOf, '2026-10-29T11:30:00.000Z')).toMatchObject({ window: '1h', sinceMs: Date.parse('2026-10-29T11:30:00.000Z') })
    expect(resolveNewsSentimentWindow(asOf, '2026-10-29T09:00:00.000Z').window).toBe('4h')
    // Older than the previous open: the window is clamped to the open, not to the stale run.
    expect(resolveNewsSentimentWindow(asOf, '2026-10-29T06:00:00.000Z')).toMatchObject({ sinceMs: previousSlot, window: '4h' })
    // No previous analysis at all, and a run from days ago, both land on the same floor.
    expect(resolveNewsSentimentWindow(asOf, undefined).sinceMs).toBe(previousSlot)
    expect(resolveNewsSentimentWindow(asOf, '2026-09-01T00:00:00.000Z').sinceMs).toBe(previousSlot)
    // A run serving the 16:00 open looks back to 08:00, not to the instant it stands on.
    expect(resolveNewsSentimentWindow('2026-10-29T08:00:00.000Z', undefined).sinceMs).toBe(Date.parse('2026-10-29T00:00:00.000Z'))
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
  it('continues from the latest published run and ignores failed or running ones', () => {
    expect(newsSentimentSince([
      { status: 'succeeded', startedAt: '2026-10-29T19:48:00.000Z', queuedAt: '2026-10-29T19:47:00.000Z', completedAt: '2026-10-29T19:50:00.000Z' },
      { status: 'running', startedAt: '2026-10-29T21:00:00.000Z', queuedAt: '2026-10-29T20:59:00.000Z', completedAt: null },
      { status: 'failed', startedAt: '2026-10-29T20:10:00.000Z', queuedAt: '2026-10-29T20:09:00.000Z', completedAt: '2026-10-29T20:11:00.000Z' }
    ])).toBe('2026-10-29T19:48:00.000Z')
    // Nothing published yet: the group's previous snapshot is the boundary.
    expect(newsSentimentSince([], '2026-10-29T00:00:00.000Z')).toBe('2026-10-29T00:00:00.000Z')
    expect(newsSentimentSince([])).toBeUndefined()
  })

  it('drops an item revised after the cutoff, like the anchor path does', async () => {
    const getEvidenceExcerpt = async (input: { itemId: string }) => evidence(input.itemId, '2026-10-29T11:20:00.000Z')
    const updated = await appendAnalysisNewsSentiment(context(), { getEvidenceExcerpt } as never, reader([item()]) as never,
      { asOf, since: '2026-10-29T11:00:00.000Z' },
      () => [{ itemId: 'item-bull', detectedAt: '2026-10-29T12:30:00.000Z' }])
    expect(updated.facts).toHaveLength(0)
  })

})
