/**
 * 生产者归属判定（契约 §14）：让渡 / 未登记 / 平台自有，三选一。
 *
 * 从 runtime 拆出来是为了体积门禁，也让判定本身可单独测：它只读归属表和「已经见过的
 * producerId」集合，不碰文件、不碰时钟。
 */
import type { NotificationDiagnosticsSink } from '../contracts/notificationContracts'
import type { NotificationProducerOwnership } from '../contracts/notificationProducerOwnership'

export type ProducerGateDecision =
  | { action: 'delegated'; ownerProductId: string }
  | { action: 'send' }

export function evaluateProducerGate(input: {
  producerId?: string
  eventTypeId: string
  ownership?: NotificationProducerOwnership
  /** 已登记的产品 productId：producerId 的前缀对得上，才进入「产品 vs 平台」判定。 */
  productIds?: readonly string[]
  diagnostics?: NotificationDiagnosticsSink
  seenUnclaimedProducers: Set<string>
  now: string
}): ProducerGateDecision {
  const producerId = input.producerId
  if (producerId === undefined) return { action: 'send' }

  // 前缀对不上任何已登记产品 → 平台自有（含 `assistant.sessionRetention` 这类无前缀 handler），
  // 视为已登记，不记诊断。只有「带产品前缀、却没人 claim」才是真正的未登记，记一次。
  const productId = (input.productIds ?? []).find((id) => producerId.startsWith(`${id}.`))
  if (productId === undefined) return { action: 'send' }

  const owner = input.ownership?.[producerId]
  if (owner !== undefined && owner !== 'platform') {
    // 让渡：平台不发、不落库；产品自己会发它那条。记一条诊断，排查「为什么没发」时能看到是谁接的。
    input.diagnostics?.({ code: 'delegated', eventTypeId: input.eventTypeId, producerId, at: input.now })
    return { action: 'delegated', ownerProductId: owner.productId }
  }
  if (owner === 'platform') return { action: 'send' }

  if (!input.seenUnclaimedProducers.has(producerId)) {
    // 未声明：平台照发（漏发是安静的），但第一次见到时留一条诊断，别让新任务变成黑箱。
    input.seenUnclaimedProducers.add(producerId)
    input.diagnostics?.({ code: 'unclaimed-producer', eventTypeId: input.eventTypeId, producerId, at: input.now })
  }
  return { action: 'send' }
}
