import type { NotificationSubmitOutcome } from '@platform/notifications/contracts/notificationContracts'

import { INTELLIGENCE_IPC_METHODS } from '../../../contracts/intelligenceIpcMethods'
import type { DeliveryReading, PushDeliveryReading, SuppressionReason, SendReceiptView } from '../../pages/intelligence/analysisConclusionSendState'

/**
 * 抽屉里「发送到频道」的渲染层入口：**只传运行 id**。
 *
 * 结论句、去重键、通道都由主进程按 id 现取——渲染层传不了内容，也就不会出现
 * 「屏幕上这条」与「实际发出去那条」不是同一条。
 *
 * 回执解析**只读形状、不认识契约类型**：平台给的产品回执是 JSON，多一个字段不需要在这里改类型，
 * 少一个字段也不会被当成成功。投递结果（`delivery.push` / `delivery.suppressed`）就在提交回执里，
 * 不再去读一次记录——「提交成功 ≠ 手机收到」这句话靠这两处判，不靠猜。
 */
export type AnalysisConclusionSendReceipt = SendReceiptView

/**
 * 回执里是否已经带这次提交的投递结果（`accepted.delivery`）。这是**类型事实**，不是开关人记得。
 *
 * 为什么现在藏在它后面：没有 `delivery` 时，一次真的发到手机也会被判成「只在应用内」——
 * 句子不撒谎，但读者刚点了「发送到频道」，看到这句会以为通道坏了。
 *
 * 等什么：**频道线的回执笔**——`NotificationSubmitOutcome` 的 `accepted`（以及 `merged` 在真升级时）
 * 带上 `delivery`。等它进契约，`ReceiptCarriesDelivery` 就变成 `true`，下面那一行随之编不过，
 * 把它改成 `true` 按钮就出来了；同时有一条用例钉着 `false`，改的时候会一起提醒。
 * 放出来那一笔还要一并接：0 条通道不渲染（`getNotificationRuntime().resolvePushChannel()`）。
 */
export type ReceiptCarriesDelivery = 'delivery' extends keyof Extract<NotificationSubmitOutcome, { kind: 'accepted' }> ? true : false

export const SEND_ACTION_READY: ReceiptCarriesDelivery = false

const PRODUCT_ID = 'market-intelligence'

const SUPPRESSION_REASONS: readonly SuppressionReason[] = [
  'quiet-hours', 'daily-limit', 'minimum-gap', 'surface-off', 'not-subscribed', 'not-approved', 'desktop-unsupported'
]
const PUSH_STATES: readonly PushDeliveryReading['state'][] = ['queued', 'sent-accepted', 'sent-unconfirmed', 'failed']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPush(value: unknown): PushDeliveryReading | undefined {
  if (!isRecord(value)) return undefined
  const state = PUSH_STATES.find(candidate => candidate === value.state)
  if (state === undefined) return undefined
  const reason = typeof value.reason === 'string' && value.reason.length > 0 ? { reason: value.reason } : {}
  const channelName = typeof value.channelName === 'string' && value.channelName.length > 0 ? { channelName: value.channelName } : {}
  return { state, ...reason, ...channelName }
}

function readSuppressed(value: unknown): DeliveryReading['suppressed'] {
  if (!Array.isArray(value)) return undefined
  const entries: { level: string; reason: SuppressionReason }[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const reason = SUPPRESSION_REASONS.find(candidate => candidate === entry.reason)
    if (reason === undefined || typeof entry.level !== 'string') continue
    entries.push({ level: entry.level, reason })
  }
  return entries.length === 0 ? undefined : entries
}

/** 认不出形状就抛：**不猜成成功**，也不猜成某一种失败。 */
export function readSendReceipt(value: unknown): AnalysisConclusionSendReceipt {
  if (!isRecord(value)) throw new Error('analysis-conclusion-send-unreadable')
  if (value.kind === 'rejected') {
    if (typeof value.reason !== 'string' || value.reason.length === 0) throw new Error('analysis-conclusion-send-unreadable')
    return { kind: 'rejected', reason: value.reason }
  }
  if (value.kind === 'accepted' || value.kind === 'merged') {
    const delivery = isRecord(value.delivery) ? value.delivery : undefined
    const push = readPush(delivery?.push)
    const suppressed = readSuppressed(delivery?.suppressed)
    // 没带投递结果＝这次没有投递（合并没升级、折叠、让渡都属此列），按「只在应用内」判，不当成功。
    if (push === undefined && suppressed === undefined) return { kind: 'accepted' }
    return { kind: 'accepted', delivery: { ...(push === undefined ? {} : { push }), ...(suppressed === undefined ? {} : { suppressed }) } }
  }
  throw new Error('analysis-conclusion-send-unreadable')
}

export async function sendAnalysisConclusion(analysisRunId: string): Promise<AnalysisConclusionSendReceipt> {
  return readSendReceipt(await window.platform.products.invoke(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.sendAnalysisConclusion, { analysisRunId }))
}
