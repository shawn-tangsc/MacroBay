/**
 * 「把一条已有记录再推一次手机」（契约 §16.3.4 / 通道投递需求 §2.9）。
 *
 * 一句话职责：**只重做这一条记录的手机投递**。不新建记录、不改内容、不动
 * `occurrenceCount`/`createdAt`，只写 `delivery.push` 与 `updatedAt`。
 *
 * 五码闭集（都不静默）：
 * - `redeliver-target-missing`：**`recordId` 找不到**——绝不允许因此新建一行；
 * - `redeliver-edition-mismatch`：版次对不上（含历史记录没有 edition，**不猜不补**）；
 * - `redeliver-surface-invalid`：只开手机这一个表面；
 * - `push-paused`：通道熔断窗口内；
 * - `channel-missing`：没配通道或通道端口没装配（交给调用方翻成人话）。
 *
 * **平台侧不做时间窗去重**：读者点一次就再推一次，防连点归界面的「发送中」禁用。
 */
import { pushDeliveryState } from '../delivery/pushDeliveryState'
import type { NotificationDeliveryState, NotificationRecord } from '../contracts/notificationContracts'
import type { NotificationDeliveryContent } from './notificationRouting'

export type RedeliverReasonCode =
  | 'redeliver-surface-invalid'
  | 'redeliver-target-missing'
  | 'redeliver-edition-mismatch'
  | 'push-paused'
  | 'channel-missing'

export type RedeliverResult =
  | { kind: 'accepted'; recordId: string; delivery: NotificationDeliveryState }
  | { kind: 'rejected'; reason: RedeliverReasonCode }

export async function redeliverPushToChannel(
  input: { recordId: string; editionId: string; locale: string; surface?: string },
  deps: {
    records: readonly NotificationRecord[]
    now: string
    channelId: string | null
    pausedUntil: string | null
    /** 端口没装配（或通道不可用）时返回 undefined，这里判 `channel-missing`，不吞成通用失败。 */
    deliver:
      | ((record: NotificationRecord, content: NotificationDeliveryContent) => Promise<{
          ok: boolean
          reason?: string
          messageId?: string
        }>)
      | undefined
    /** 文案由 runtime 解析（它才有语言与文案表）；这里只负责在正确的时机调用一次。 */
    resolveContent: (record: NotificationRecord) => Promise<NotificationDeliveryContent>
  }
): Promise<RedeliverResult> {
  if (input.surface !== undefined && input.surface !== 'channel') {
    return { kind: 'rejected', reason: 'redeliver-surface-invalid' }
  }
  // 契约 v2.32 判定顺序：**先判存在性**，找不到就到此结束，不再往下判版次。
  const record = findRedeliverTarget(deps.records, input.recordId)
  if (record === undefined) return { kind: 'rejected', reason: 'redeliver-target-missing' }
  // 历史记录没有 edition：一律判不匹配，**不猜、不补默认值**。
  if (
    record.edition === undefined ||
    record.edition.editionId !== input.editionId ||
    record.edition.locale !== input.locale
  ) {
    return { kind: 'rejected', reason: 'redeliver-edition-mismatch' }
  }
  if (deps.pausedUntil !== null && deps.pausedUntil > deps.now) {
    return { kind: 'rejected', reason: 'push-paused' }
  }
  if (deps.channelId === null || deps.deliver === undefined) {
    return { kind: 'rejected', reason: 'channel-missing' }
  }
  const result = await deps.deliver(record, await deps.resolveContent(record))
  const previousCount = record.delivery.push?.pushCount ?? 0
  // 状态词只由这一处映射给：与新提交路径读同一张表（`pushDeliveryState`）。
  const mapped = pushDeliveryState(result)
  const delivery: NotificationDeliveryState = {
    ...mapped,
    at: deps.now,
    pushCount: previousCount + 1,
    lastPushedAt: deps.now,
    ...(result.messageId === undefined ? {} : { messageId: result.messageId })
  }
  return { kind: 'accepted', recordId: record.id, delivery }
}

/**
 * 按 `recordId` 找那条记录；没有就是不匹配，绝不新建。
 *
 * 为什么不再按去重键找：键的形态（模板串、产品前缀、分隔符、展开时机）是一整类陷阱，
 * `recordId` 是提交回执里现成的身份，换成它之后这类问题从根上消失（契约 v2.32）。
 */
export function findRedeliverTarget(
  records: readonly NotificationRecord[],
  recordId: string
): NotificationRecord | undefined {
  return records.find((record) => record.id === recordId)
}
