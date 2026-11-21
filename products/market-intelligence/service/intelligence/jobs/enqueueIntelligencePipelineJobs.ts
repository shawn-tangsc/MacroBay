import type { JobRuntime } from '@platform/jobs'

import { translationJobDefinitionId } from './intelligenceJobIds'

const PRODUCT_ID = 'market-intelligence'

export async function enqueueIntelligencePipelineJobs(
  jobRuntime: JobRuntime,
  jobIds: readonly string[],
  payload: Record<string, unknown>
): Promise<void> {
  // A 365-day backfill must not spend one model call per day: those items are stored, marked
  // `pending`, and stay out of the translate/assess queues (the reader can still translate one by hand).
  const backfill = new Set(
    Array.isArray(payload.backfillItemIds)
      ? payload.backfillItemIds.filter((entry): entry is string => typeof entry === 'string')
      : []
  )
  const queuedItemIds = Array.isArray(payload.newItemIds)
    ? payload.newItemIds.filter((entry): entry is string => typeof entry === 'string' && !backfill.has(entry))
    : undefined

  for (const handlerId of jobIds) {
    let jobPayload: Record<string, unknown> = payload
    // Translation is the one job whose definition identity names its source: the run log groups
    // history by it, so it may not carry a timestamp or a random tail.
    let definitionId = `${handlerId}:${String(payload.sourceId ?? 'global')}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
    if (handlerId === 'market-intelligence.translateItems' && queuedItemIds) {
      if (queuedItemIds.length === 0) continue
      const sourceId = typeof payload.sourceId === 'string' && payload.sourceId ? payload.sourceId : undefined
      // Dropping `sourceId` here is what made each batch invisible under the run log's source
      // filter: the projection reads it off the payload, and an empty source set matches nothing.
      jobPayload = { itemIds: queuedItemIds, reason: 'new-item', ...(sourceId ? { sourceId } : {}) }
      definitionId = translationJobDefinitionId(sourceId)
    } else if (
      (handlerId === 'market-intelligence.assessChangedItems' ||
        handlerId === 'market-intelligence.refreshSentimentAggregates' ||
        handlerId === 'market-intelligence.enrichNewsDocuments' ||
        handlerId === 'market-intelligence.scoreNewsSentiment') &&
      Array.isArray(payload.newItemIds)
    ) {
      const assessLike =
        handlerId === 'market-intelligence.assessChangedItems' ||
        handlerId === 'market-intelligence.refreshSentimentAggregates'
      if (assessLike && queuedItemIds?.length === 0) continue
      jobPayload = { ...payload, itemIds: assessLike ? queuedItemIds : payload.newItemIds }
    }
    await jobRuntime.enqueueDefinition({
      id: definitionId,
      owner: 'product',
      productId: PRODUCT_ID,
      handlerId,
      title: `Intelligence ${handlerId.split('.').pop() ?? handlerId}`,
      trigger: { kind: 'manual' },
      payload: jobPayload
    })
  }
}
