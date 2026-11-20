import type { NotificationSubmitOutcome } from '@platform/notifications/contracts/notificationContracts'

import { INTELLIGENCE_IPC_METHODS } from '../../../contracts/intelligenceIpcMethods'
import type { DeliveryReading, PushChannelReading, PushDeliveryReading, SendReceiptView } from '../../pages/intelligence/analysisConclusionSendState'

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

export const SEND_ACTION_READY: ReceiptCarriesDelivery = true

const PRODUCT_ID = 'market-intelligence'

const PUSH_STATES: readonly PushDeliveryReading['state'][] = ['queued', 'sent-accepted', 'sent-unconfirmed', 'failed']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 逐通道结果（多通道方案）：一条通道一行，状态照抄四档。
 *
 * 认不出一条通道就**跳过那一行**，不让整份回执变红：界面按**行数**数收到/没到，跳过一行会让数字
 * 少一条，但至少不会编造；行数异常会在下一版由守卫发现（回执是平台的，不是读者写的）。
 */
function readChannels(value: unknown): readonly PushChannelReading[] | undefined {
  if (!Array.isArray(value)) return undefined
  const rows: PushChannelReading[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const state = PUSH_STATES.find(candidate => candidate === entry.state)
    if (state === undefined) continue
    rows.push({
      state,
      ...(typeof entry.reason === 'string' && entry.reason.length > 0 ? { reason: entry.reason } : {}),
      ...(typeof entry.channelName === 'string' && entry.channelName.length > 0 ? { channelName: entry.channelName } : {})
    })
  }
  return rows.length === 0 ? undefined : rows
}

/**
 * 手机那一档：产品形状是 `{ pushState, pushReason, channels }`（服务侧翻译过，渲染层不认平台类型）。
 * 聚合档没有可读状态、又没有逐通道行时返回 `undefined`——那一条不构成「到没到」的证据。
 */
function readPush(value: unknown): PushDeliveryReading | undefined {
  if (!isRecord(value)) return undefined
  const state = PUSH_STATES.find(candidate => candidate === value.pushState)
  const channels = readChannels(value.channels)
  if (state === undefined) return channels === undefined ? undefined : { state: 'failed', channels }
  return {
    state,
    ...(typeof value.pushReason === 'string' && value.pushReason.length > 0 ? { reason: value.pushReason } : {}),
    ...(channels === undefined ? {} : { channels })
  }
}

function readSuppressed(value: unknown): DeliveryReading['suppressed'] {
  if (!Array.isArray(value)) return undefined
  const entries: { level: string; reason: string }[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    // **认不出的码也留着**：界面要能说「这台设备不认识这个原因」，丢掉就等于把它当成「没排上」。
    if (typeof entry.reason !== 'string' || entry.reason.length === 0 || typeof entry.level !== 'string') continue
    entries.push({ level: entry.level, reason: entry.reason })
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
    // 服务侧给的是产品形状：`{ pushState, pushReason, channels, suppressed }`，不是平台的嵌套对象。
    const delivery = isRecord(value.delivery) ? value.delivery : undefined
    const push = readPush(delivery)
    const suppressed = readSuppressed(delivery?.suppressed)
    // 没带投递结果＝这次没有投递（合并没升级、折叠、让渡都属此列），按「只在应用内」判，不当成功。
    if (push === undefined && suppressed === undefined) return { kind: 'accepted' }
    return { kind: 'accepted', delivery: { ...(push === undefined ? {} : { push }), ...(suppressed === undefined ? {} : { suppressed }) } }
  }
  throw new Error('analysis-conclusion-send-unreadable')
}

/**
 * **点击前**那一问：现在能不能发。0 条 → 按钮整个不渲染；≥1 条 → 按钮在（多通道是合法配置）。
 * 只回答「能不能发」，**不带通道名**——名字只认这次提交回执里那一份。
 */
export type SendChannelReadiness =
  | Readonly<{ state: 'ready' }>
  | Readonly<{ state: 'unavailable' }>

export function readChannelReadiness(value: unknown): SendChannelReadiness {
  if (!isRecord(value)) throw new Error('analysis-conclusion-channel-unreadable')
  if (value.state === 'ready') return { state: 'ready' }
  if (value.state === 'unavailable') return { state: 'unavailable' }
  throw new Error('analysis-conclusion-channel-unreadable')
}

export async function readAnalysisConclusionSendChannel(): Promise<SendChannelReadiness> {
  return readChannelReadiness(await window.platform.products.invoke(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.getAnalysisConclusionSendChannel, {}))
}

export async function sendAnalysisConclusion(analysisRunId: string): Promise<AnalysisConclusionSendReceipt> {
  return readSendReceipt(await window.platform.products.invoke(PRODUCT_ID, INTELLIGENCE_IPC_METHODS.sendAnalysisConclusion, { analysisRunId }))
}
