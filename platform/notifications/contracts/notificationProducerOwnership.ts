/**
 * 生产者归属与让渡（契约 §14）：**默认平台发，产品声明后才让渡**。
 *
 * 键是稳定的 producerId（任务/来源的 handler 标识），不是任务名、不是标题。未登记的一律
 * 平台发——「重复发」是吵，读者会当场投诉；「没人发」是安静的，可能一个月没人发现。
 *
 * 表只接受注入：产品在 manifest 里写 `notificationProducerClaims`，装配层合并；平台自有
 * 任务由装配层按 job 定义的 handlerId 补成 `platform`，平台不认识产品代码。
 */
import type { ProductManifest } from '../../product-manifest'

export type NotificationProducerOwner = 'platform' | { productId: string }

export type NotificationProducerOwnership = Readonly<Record<string, NotificationProducerOwner>>

export type NotificationProducerClaimSource = Pick<ProductManifest, 'id' | 'notificationProducerClaims'>

/**
 * 建归属表。三件在登记时校验：
 *  1. claim 必须带 `<productId>.` 前缀（同一个 handler 换产品就不能静默抢走）；
 *  2. 同一个 producerId 不能被两个声明者同时 claim（说不清谁的事）；
 *  3. 非空、去重、去首尾空白。
 *
 * **平台自有任务不靠白名单判**：producerId 的前缀对不上任何已登记 productId 时，就是平台自有
 * （包括 `assistant.sessionRetention` 这类无前缀 handler），不记诊断。写死一张表迟早会漏。
 */
export function createNotificationProducerOwnership(input: {
  manifests: readonly NotificationProducerClaimSource[]
}): NotificationProducerOwnership {
  const owners: Record<string, NotificationProducerOwner> = {}
  for (const manifest of input.manifests) {
    for (const claim of manifest.notificationProducerClaims ?? []) {
      const producerId = claim.trim()
      if (producerId === '') throw new Error(`notification-producer-claim-empty:${manifest.id}`)
      if (!producerId.startsWith(`${manifest.id}.`)) {
        throw new Error(`notification-producer-claim-prefix-mismatch:${manifest.id}:${producerId}`)
      }
      if (owners[producerId] !== undefined) {
        throw new Error(`notification-producer-claim-conflict:${producerId}`)
      }
      owners[producerId] = { productId: manifest.id }
    }
  }
  return Object.freeze(owners)
}
