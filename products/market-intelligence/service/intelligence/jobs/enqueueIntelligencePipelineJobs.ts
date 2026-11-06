import type { JobRuntime } from '@platform/jobs'

import { translationJobDefinitionId } from './intelligenceJobIds'

const PRODUCT_ID = 'market-intelligence'

export async function enqueueIntelligencePipelineJobs(
  jobRuntime: JobRuntime,
  jobIds: readonly string[],
  payload: Record<string, unknown>
): Promise<void> {
  for (const handlerId of jobIds) {
    let jobPayload: Record<string, unknown> = payload
    // Translation is the one job whose definition identity names its source: the run log groups
    // history by it, so it may not carry a timestamp or a random tail.
    let definitionId = `${handlerId}:${String(payload.sourceId ?? 'global')}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
    if (handlerId === 'market-intelligence.translateItems' && Array.isArray(payload.newItemIds)) {
      const sourceId = typeof payload.sourceId === 'string' && payload.sourceId ? payload.sourceId : undefined
      // Dropping `sourceId` here is what made each batch invisible under the run log's source
      // filter: the projection reads it off the payload, and an empty source set matches nothing.
      jobPayload = { itemIds: payload.newItemIds, reason: 'new-item', ...(sourceId ? { sourceId } : {}) }
      definitionId = translationJobDefinitionId(sourceId)
    } else if (
      (handlerId === 'market-intelligence.assessChangedItems' ||
        handlerId === 'market-intelligence.refreshSentimentAggregates' ||
        handlerId === 'market-intelligence.enrichNewsDocuments' ||
        handlerId === 'market-intelligence.scoreNewsSentiment') &&
      Array.isArray(payload.newItemIds)
    ) {
      jobPayload = { ...payload, itemIds: payload.newItemIds }
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
