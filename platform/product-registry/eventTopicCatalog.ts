import type { ProductManifest } from '../product-manifest'

/**
 * 定时任务可订阅的 topic 目录（`MI-11-R22` A1）。
 *
 * 唯一来源是各产品 manifest 的 `eventTopics`（产品**发布**的话题）。平台不得 import 产品代码，
 * 所以这里只接受注入的 manifest 列表，由装配层传入生成的 `productManifests`。
 *
 * 静态目录的代价：**没声明的话题不可订阅**。发布方新增话题必须同批声明，
 * 否则任务建得成、永远不触发。
 */
export type EventTopicCatalog = {
  readonly topics: readonly string[]
  has: (topic: string) => boolean
}

export function createEventTopicCatalog(
  manifests: readonly Pick<ProductManifest, 'eventTopics'>[]
): EventTopicCatalog {
  const topics: string[] = []
  const known = new Set<string>()

  for (const manifest of manifests) {
    for (const candidate of manifest.eventTopics ?? []) {
      const topic = typeof candidate === 'string' ? candidate.trim() : ''
      // 形状校验在生成期（`validateDiscoveredProductManifest`）已经拦过；这里只负责去重与跳过空值，
      // 免得一条坏声明把整个目录读崩。
      if (topic === '' || known.has(topic)) continue
      known.add(topic)
      topics.push(topic)
    }
  }

  return {
    topics,
    has: (topic) => known.has(topic.trim())
  }
}
