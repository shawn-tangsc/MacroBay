import type { JobRuntime } from '@platform/jobs'

import type { IntelligenceItem } from '../schema/intelligenceRecord'
import type { TranslateIntelligenceItemsJobInput } from '../schema/intelligenceTranslation'
import { INTELLIGENCE_TRANSLATE_ITEMS_JOB, translationJobDefinitionId } from '../jobs/intelligenceJobIds'
import { createTranslationGroupId, splitTranslationBatchBySource } from './intelligenceTranslationHelpers'

const PRODUCT_ID = 'market-intelligence'

/**
 * 入队前按来源拆批，再把每一批挂到来源级定义 id 上。
 *
 * 为什么两件事必须一起做：定义 id 要稳定到来源级（运行记录按它归拢历史、按来源筛选还要读
 * payload 里的 `sourceId`），而一次入队可能横跨多个来源。只补 `sourceId` 不拆批，跨来源的批
 * 就只能退回 `global`，按来源筛照样看不见；只拆批不补 `sourceId`，每批仍然在筛选下消失。
 *
 * 拆出来的多批共用一个 `groupId`：否则一次动作会显示成 N 次互不相干的翻译。
 */
export async function enqueueTranslationBatches(
  jobRuntime: JobRuntime,
  input: TranslateIntelligenceItemsJobInput,
  items: readonly Pick<IntelligenceItem, 'itemId' | 'sourceId'>[]
): Promise<number> {
  const batches = splitTranslationBatchBySource(input, items)
  const groupId = batches.length > 1 ? createTranslationGroupId() : undefined
  let queuedCount = 0
  for (const batch of batches) {
    queuedCount += await enqueueTranslationJob(jobRuntime, groupId ? { ...batch, groupId } : batch)
  }
  return queuedCount
}

async function enqueueTranslationJob(
  jobRuntime: JobRuntime,
  input: TranslateIntelligenceItemsJobInput
): Promise<number> {
  const itemCount = input.itemIds?.length ?? input.clusterIds?.length ?? input.translationIds?.length ?? 1
  await jobRuntime.enqueueDefinition({
    id: translationJobDefinitionId(input.sourceId),
    owner: 'product',
    productId: PRODUCT_ID,
    handlerId: INTELLIGENCE_TRANSLATE_ITEMS_JOB,
    title: 'Translate intelligence items',
    trigger: { kind: 'manual' },
    payload: input
  })
  return itemCount
}
