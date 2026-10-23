import type { JobRuntime } from '@platform/jobs'

const PRODUCT_ID = 'market-intelligence'

export async function enqueueIntelligencePipelineJobs(
  jobRuntime: JobRuntime,
  jobIds: readonly string[],
  payload: Record<string, unknown>
): Promise<void> {
  for (const handlerId of jobIds) {
    let jobPayload: Record<string, unknown> = payload
    if (handlerId === 'market-intelligence.translateItems' && Array.isArray(payload.newItemIds)) {
      jobPayload = { itemIds: payload.newItemIds, reason: 'new-item' }
    } else if (
      (handlerId === 'market-intelligence.assessChangedItems' ||
        handlerId === 'market-intelligence.refreshSentimentAggregates') &&
      Array.isArray(payload.newItemIds)
    ) {
      jobPayload = { ...payload, itemIds: payload.newItemIds }
    }
    await jobRuntime.enqueueDefinition({
      id: `${handlerId}:${String(payload.sourceId ?? 'global')}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      owner: 'product',
      productId: PRODUCT_ID,
      handlerId,
      title: `Intelligence ${handlerId.split('.').pop() ?? handlerId}`,
      trigger: { kind: 'manual' },
      payload: jobPayload
    })
  }
}
