import { describe, expect, it, vi } from 'vitest'

import type { JobDefinition, JobRuntime } from '@platform/jobs'

import { enqueueIntelligencePipelineJobs } from './enqueueIntelligencePipelineJobs'
import { INTELLIGENCE_SCORE_NEWS_SENTIMENT_JOB, INTELLIGENCE_TRANSLATE_ITEMS_JOB } from './intelligenceJobIds'

function createRuntime(): { jobRuntime: JobRuntime; enqueued: JobDefinition[] } {
  const enqueued: JobDefinition[] = []
  const jobRuntime = {
    async enqueueDefinition(definition: JobDefinition) {
      enqueued.push(definition)
      return { id: `run-${enqueued.length}` }
    }
  } as unknown as JobRuntime
  return { jobRuntime, enqueued }
}

describe('enqueueIntelligencePipelineJobs', () => {
  it('queues a translation batch under its source, not under a timestamp', async () => {
    const { jobRuntime, enqueued } = createRuntime()

    await enqueueIntelligencePipelineJobs(jobRuntime, [INTELLIGENCE_TRANSLATE_ITEMS_JOB], {
      sourceId: 'coindesk-rss',
      newItemIds: ['item-1', 'item-2']
    })

    expect(enqueued).toHaveLength(1)
    expect(enqueued[0]?.id).toBe('market-intelligence.translateItems.coindesk-rss')
    // The run log's source filter reads `payload.sourceId`; dropping it hides the whole batch.
    expect(enqueued[0]?.payload).toEqual({
      itemIds: ['item-1', 'item-2'],
      reason: 'new-item',
      sourceId: 'coindesk-rss'
    })
  })

  it('falls back to the global scope when the batch has no source of its own', async () => {
    const { jobRuntime, enqueued } = createRuntime()

    await enqueueIntelligencePipelineJobs(jobRuntime, [INTELLIGENCE_TRANSLATE_ITEMS_JOB], {
      newItemIds: ['item-1']
    })

    expect(enqueued[0]?.id).toBe('market-intelligence.translateItems.global')
    expect(enqueued[0]?.payload).toEqual({ itemIds: ['item-1'], reason: 'new-item' })
  })

  it('leaves the other pipeline jobs on their per-run identity', async () => {
    const { jobRuntime, enqueued } = createRuntime()
    const payload = { sourceId: 'coindesk-rss', newItemIds: ['item-1'] }

    await enqueueIntelligencePipelineJobs(jobRuntime, [INTELLIGENCE_SCORE_NEWS_SENTIMENT_JOB], payload)
    await enqueueIntelligencePipelineJobs(jobRuntime, [INTELLIGENCE_SCORE_NEWS_SENTIMENT_JOB], payload)

    // Deliberate: their ids still carry a timestamp, so two batches stay two distinct tasks.
    // Moving them to a stable id needs the same-source serialisation rule first.
    expect(enqueued[0]?.id).not.toBe(enqueued[1]?.id)
  })
})
