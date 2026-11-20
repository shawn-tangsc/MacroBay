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
import { aggregatePushDelivery } from '../delivery/aggregatePushDelivery'
import type { ChannelPushAttempt, ChannelPushHook, ChannelPushTarget } from '../delivery/channelPushPort'
import { pushDeliveryState } from '../delivery/pushDeliveryState'
import type { NotificationDeliveryState, NotificationRecord, PushChannelOutcome } from '../contracts/notificationContracts'
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
    /** 这次要补的通道（调用方已经从投影派生好：谁是 `runtime-ready`）。 */
    targets: readonly ChannelPushTarget[]
    /** 退避窗口按通道算：窗口内的通道记 `queued`，不发。 */
    pausedUntil: (channelId: string) => string | null
    /** 端口没装配（或通道不可用）时返回 undefined，这里判 `channel-missing`，不吞成通用失败。 */
    deliver: ChannelPushHook | undefined
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
  if (deps.targets.length === 0 || deps.deliver === undefined) {
    return { kind: 'rejected', reason: 'channel-missing' }
  }
  // 只补**没到 delivered 终态**的通道：已 `sent-accepted` 的那条不重发（attempt 行本身就是记忆）。
  // 老记录没有 `channels`：没有逐通道证据，就按「都没发成」对待——重推本来就是读者点出来的。
  const previous = record.delivery.push?.channels
  const accepted = new Set(
    (previous ?? []).filter((channel) => channel.state === 'sent-accepted').map((channel) => channel.channelId)
  )
  const pending = deps.targets.filter((target) => !accepted.has(target.channelId))
  if (pending.length === 0) {
    // 每条都已经是 delivered：**一条都不发**，也不改计数（次数是「真的推了几次」的证据）；
    // 回执照实说「它已经在这个状态」——不冒用任何拒绝码，也不假称又推了一次。
    const current = record.delivery.push
    if (current !== undefined) return { kind: 'accepted', recordId: record.id, delivery: current }
    return { kind: 'rejected', reason: 'channel-missing' }
  }
  // 退避窗口内不退：记 `queued`，与首次投递同一口径（通道方案 §3）。
  const outcomes: PushChannelOutcome[] = []
  const toSend: ChannelPushTarget[] = []
  for (const target of pending) {
    const pausedUntil = deps.pausedUntil(target.channelId)
    if (pausedUntil !== null && pausedUntil > deps.now) {
      outcomes.push({ channelId: target.channelId, channelName: target.channelName, state: 'queued', reason: 'push-backoff', at: deps.now })
      continue
    }
    toSend.push(target)
  }
  const attempts: readonly ChannelPushAttempt[] = toSend.length === 0
    ? []
    : await deps.deliver(record, await deps.resolveContent(record), toSend)
  const byChannel = new Map(attempts.map((attempt) => [attempt.channelId, attempt]))
  for (const target of toSend) {
    const result = byChannel.get(target.channelId)?.result ?? { ok: false, reason: 'channel-rejected' }
    // 状态词只由这一处映射给：与新提交路径读同一张表（`pushDeliveryState`）。
    const mapped = pushDeliveryState(result)
    outcomes.push({
      channelId: target.channelId,
      channelName: target.channelName,
      state: mapped.state,
      ...(mapped.reason === undefined ? {} : { reason: mapped.reason }),
      ...(result.messageId === undefined ? {} : { attemptId: result.messageId }),
      at: deps.now
    })
  }
  // 聚合与首次投递用同一个纯函数（图片路径也复用它），不另写一套判定。
  const merged = new Map((previous ?? []).map((channel) => [channel.channelId, channel]))
  for (const outcome of outcomes) merged.set(outcome.channelId, outcome)
  const channels = deps.targets
    .map((target) => merged.get(target.channelId))
    .filter((channel): channel is PushChannelOutcome => channel !== undefined)
  const aggregate = aggregatePushDelivery(channels)
  const only = channels.length === 1 ? channels[0] : undefined
  const previousCount = record.delivery.push?.pushCount ?? 0
  const delivery: NotificationDeliveryState = {
    state: aggregate.state,
    ...(aggregate.reason === undefined ? {} : { reason: aggregate.reason }),
    at: deps.now,
    channels,
    pushCount: previousCount + 1,
    lastPushedAt: deps.now,
    ...(only?.attemptId === undefined ? {} : { messageId: only.attemptId }),
    ...(record.delivery.push?.highestSeverity === undefined ? {} : { highestSeverity: record.delivery.push.highestSeverity })
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
