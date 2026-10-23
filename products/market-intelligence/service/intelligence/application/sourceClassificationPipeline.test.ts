import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { createIntelligencePipeline } from './intelligencePipeline'
import { createInMemoryProfileStorage, createSourceProfileStore } from './sourceProfileStore'
import { parseProcessingLabels } from './intelligenceItemLabels'

describe('source classification pipeline', () => {
  it('ignores unrelated regulator items without creating intelligence items', async () => {
    const pipeline = createHarness()
    await collectNormalizeAssess(pipeline, 'sec-rss', 'sec-unrelated-rss.xml')

    expect(pipeline.listItems()).toHaveLength(0)
    const ignored = pipeline.listRawRecordSummaries().find((record) => record.processingState === 'ignored')
    expect(ignored?.errorMessage).toBe('scope-not-matched')
    expect(JSON.stringify(pipeline.listRawRecordSummaries())).not.toContain('insurance company')
  })

  it('creates exchange listing item with symbol from classifier enrichment', async () => {
    const pipeline = createHarness()
    await collectNormalizeAssess(pipeline, 'binance-announcements', 'binance-articles.json')

    const item = pipeline.listItems()[0]
    expect(item?.symbolsJson).toContain('ABC')
    const labels = parseProcessingLabels(item?.processingLabelsJson)
    expect(labels.eventSubtype).toBe('exchange-listing')
    expect(labels.relevanceOutcome).toBe('full-intelligence')
  })

  it('creates Fed supervision item as context-only without sentiment eligibility', async () => {
    const pipeline = createHarness()
    await collectNormalizeAssess(pipeline, 'federal-reserve-rss', 'fed-supervision-rss.xml')

    const item = pipeline.listItems()[0]
    const labels = parseProcessingLabels(item?.processingLabelsJson)
    expect(labels.relevanceOutcome).toBe('context-only')
    expect(labels.sentimentEligible).toBe(false)

    await pipeline.refreshSentimentAggregates({ horizon: '1h' })
    expect(pipeline.listSentimentAggregates().filter((entry) => entry.signalCount > 0)).toHaveLength(0)
  })

  it('creates active status incident as full intelligence with impact', async () => {
    const pipeline = createHarness()
    await collectNormalizeAssess(pipeline, 'coinbase-status', 'statuspage-incidents.json')

    const item = pipeline.listItems()[0]
    const labels = parseProcessingLabels(item?.processingLabelsJson)
    expect(labels.relevanceOutcome).toBe('full-intelligence')
    expect(pipeline.listImpacts().some((impact) => impact.ruleId === 'micro.exchange.incident.v1')).toBe(true)
  })
})

function createHarness() {
  const profileStore = createSourceProfileStore(createInMemoryProfileStorage())
  return createIntelligencePipeline({ profileStore })
}

async function collectNormalizeAssess(
  pipeline: ReturnType<typeof createIntelligencePipeline>,
  sourceId: string,
  fixtureName: string
) {
  const fixtureText = readFileSync(path.join(__dirname, '../adapters/fixtures', fixtureName), 'utf8')
  await pipeline.collectSource({ sourceId, runId: 'run-test', fixtureText })
  await pipeline.normalizeRawRecords({ sourceId })
  await pipeline.assessChangedItems({})
}
