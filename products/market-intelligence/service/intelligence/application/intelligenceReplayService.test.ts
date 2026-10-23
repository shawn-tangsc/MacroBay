import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { createIntelligencePipeline } from './intelligencePipeline'
import { createInMemoryProfileStorage, createSourceProfileStore } from './sourceProfileStore'
import { createIntelligenceReplayService } from './intelligenceReplayService'

describe('intelligenceReplayService', () => {
  it('queues replay from local raw records in a source/time window', async () => {
    const profileStore = createSourceProfileStore(createInMemoryProfileStorage())
    const pipeline = createIntelligencePipeline({ profileStore })
    const fixture = loadFixture('rss-sample.xml')

    await pipeline.collectSource({ sourceId: 'coindesk-rss', runId: 'run-1', fixtureText: fixture })
    await pipeline.normalizeRawRecords({ sourceId: 'coindesk-rss' })

    const queuedJobs: Array<{ jobId: string; payload: Record<string, unknown> }> = []
    const service = createIntelligenceReplayService({
      pipeline,
      listRawRecords: () => pipeline.listRawRecordSummaries().map((summary) => summary.rawRecordId),
      enqueueJob: async (jobId, payload) => {
        queuedJobs.push({ jobId, payload })
      }
    })

    const summary = await service.queueReplayWindow({ sourceId: 'coindesk-rss' })

    expect(summary.queued).toBe(true)
    expect(queuedJobs[0]?.jobId).toBe('market-intelligence.replayWindow')
  })

  it('replays local raw records without deleting historical assessments', async () => {
    const profileStore = createSourceProfileStore(createInMemoryProfileStorage())
    const pipeline = createIntelligencePipeline({ profileStore })
    const fixture = loadFixture('rss-sample.xml')

    await pipeline.collectSource({ sourceId: 'coindesk-rss', runId: 'run-1', fixtureText: fixture })
    await pipeline.normalizeRawRecords({ sourceId: 'coindesk-rss' })
    await pipeline.assessChangedItems({})
    const beforeAssessments = pipeline.listAssessments().length

    const service = createIntelligenceReplayService({ pipeline })
    const result = await service.replayWindow({ sourceId: 'coindesk-rss' })

    expect(result.replayedCount).toBeGreaterThan(0)
    expect(pipeline.listAssessments().length).toBeGreaterThanOrEqual(beforeAssessments)
  })

  it('returns a safe queued run summary', async () => {
    const profileStore = createSourceProfileStore(createInMemoryProfileStorage())
    const pipeline = createIntelligencePipeline({ profileStore })
    const service = createIntelligenceReplayService({
      pipeline,
      enqueueJob: async () => {}
    })

    const summary = await service.queueReplayWindow({ sourceId: 'coindesk-rss', from: '2026-07-01' })

    expect(summary.summary).toContain('Replay queued')
    expect(summary.queuedAt).toBeTruthy()
    expect(summary).not.toHaveProperty('payloadBody')
  })

  it('refuses the retired DeFiLlama stablecoin replay path before reading or queuing generic work', async () => {
    const pipeline = {
      listRawRecordSummaries: vi.fn(() => []),
      listItems: vi.fn(() => []),
      assessChangedItems: vi.fn(),
      refreshSentimentAggregates: vi.fn()
    } as never
    const enqueueJob = vi.fn(async () => undefined)
    const service = createIntelligenceReplayService({ pipeline, enqueueJob })

    await expect(service.queueReplayWindow({ sourceId: 'defillama-stablecoins' })).resolves.toMatchObject({ queued: false })
    await expect(service.replayWindow({ sourceId: 'defillama-stablecoins' })).resolves.toMatchObject({ replayedCount: 0, queuedJobs: [] })

    expect(enqueueJob).not.toHaveBeenCalled()
    expect(pipeline.listRawRecordSummaries).not.toHaveBeenCalled()
    expect(pipeline.listItems).not.toHaveBeenCalled()
    expect(pipeline.assessChangedItems).not.toHaveBeenCalled()
    expect(pipeline.refreshSentimentAggregates).not.toHaveBeenCalled()
  })
})

function loadFixture(name: string): string {
  return readFileSync(path.join(__dirname, '../adapters/fixtures', name), 'utf8')
}
