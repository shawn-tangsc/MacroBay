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
 * 平台自有任务可以直接给 `platformProducerIds`，表里记成 `platform`——它们不会触发
 * `unclaimed-producer`，也不必让产品去 claim 平台自己的 handler。
 * **平台自有 ID 由装配层从 job runtime 的 handler 列表生成，不写死一张表**：写死的表
 * 会让新加的平台任务在第一次提交时误报未登记。
 */
export function createNotificationProducerOwnership(input: {
  manifests: readonly NotificationProducerClaimSource[]
  platformProducerIds?: readonly string[]
}): NotificationProducerOwnership {
  const owners: Record<string, NotificationProducerOwner> = {}
  for (const producerId of input.platformProducerIds ?? []) {
    const normalized = producerId.trim()
    if (normalized === '') throw new Error('notification-producer-claim-empty')
    owners[normalized] = 'platform'
  }
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
