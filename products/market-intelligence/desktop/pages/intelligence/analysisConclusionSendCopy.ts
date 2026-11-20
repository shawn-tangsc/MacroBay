import type { PushChannelReading, SendOutcomeState, SuppressionReason } from './analysisConclusionSendState'
import type { AnalysisConclusionSendText } from './analysisConclusionSendText'

/**
 * 状态 → 那一句话。**这是唯一拼句子的地方**：组件只渲染它给的结果。
 *
 * 多通道方案（一条消息发到所有已启用通道）之后，说明行分成两层：
 * - **正文**只有数字：「{n} 条通道都收到了」「{ok} 条收到，{failed} 条没到」
 *   「没有任何通道收到（共 {n} 条）」；通道名一个都不出现；
 * - **ⓘ 浮层**：按通道一行「名字 · 人话原因」，**不上原因码**。
 *
 * 计数只从回执的逐通道行来（`channels[]`），不从聚合档反推；没有逐通道行的老记录按单条读。
 * 「发出去了没拿到回执」那一档仍是中性占位：既不说收到，也不说没到。
 */
export type SendChannelRow = Readonly<{
  /** 读者在通道页看到的那个名字（回执给的）；拿不到就用中性命。 */
  name: string
  /** 这一条的人话：收到了 / 没收到（为什么）/ 发出去了没回执。 */
  detail: string
}>

export type SendStatusCopy = Readonly<{
  /** 说明行那一句（正文只有数字，没有通道名）。 */
  message: string
  /** ⓘ 里的逐通道说明；没有回执通道行时为空——不画空气泡。 */
  channels?: readonly SendChannelRow[]
}>

export function describeSendStatus(input: Readonly<{
  state: SendOutcomeState
  text: AnalysisConclusionSendText
  /** 回执里的逐通道结果：计数与逐条说明的唯一来源。 */
  channels?: readonly PushChannelReading[] | undefined
  /** 已格式化好的时刻（读者时区）：只在「只在应用内」这类带时刻的句子里用。 */
  time: string
}>): SendStatusCopy {
  const { state, text } = input
  const rows = channelRows(input.channels, text)
  const withRows = (message: string): SendStatusCopy => rows === undefined ? { message } : { message, channels: rows }
  switch (state.state) {
    case 'delivered': return withRows(text.deliveredAll.replace('{n}', String(state.total)))
    case 'partial': return withRows(
      text.deliveredPartial
        .replace('{ok}', String(state.received))
        .replace('{failed}', String(state.total - state.received))
        .replace('{n}', String(state.total))
    )
    case 'none-received': return withRows(text.noneReceived.replace('{n}', String(state.total)))
    case 'unconfirmed': return withRows(text.unconfirmed)
    // 记录在、中心有条，只是手机那档没排上：不许写成「失败」。
    case 'app-only': return { message: text.appOnly.replace('{time}', input.time) }
    case 'suppressed': return { message: SUPPRESSED_SENTENCE[state.reason](text) }
    // 认不出的码：不空着、不猜成没发、更不说成已发送。
    case 'suppressed-unknown': return { message: text.suppressedUnknown }
    case 'daily-limit': return { message: text.dailyLimit }
    case 'push-unavailable': return { message: text.pushUnavailableNone }
    case 'failed': return { message: text.failed }
  }
}

/**
 * 逐通道那一行：名字 + 人话。
 *
 * `sent-unconfirmed` 与 `failed` 分开说：前者「发出去了、不知道到没到」，后者「没收到，因为…」。
 * 原因码只用来选句子，**不出现**在结果里；认不出的码说「不认识」，不编一个理由。
 */
function channelRows(
  channels: readonly PushChannelReading[] | undefined,
  text: AnalysisConclusionSendText
): readonly SendChannelRow[] | undefined {
  if (channels === undefined || channels.length === 0) return undefined
  return channels.map((channel) => ({
    name: channel.channelName ?? text.channelUnknown,
    detail: channel.state === 'sent-accepted'
      ? text.channelReceived
      : channel.state === 'sent-unconfirmed'
        ? text.channelUnconfirmed
        : channel.reason === undefined
          ? text.channelNotReceived
          : text.channelReasons[channel.reason] ?? text.channelReasonUnknown
  }))
}

/**
 * 被压下的原因各一句。**键就是契约的值域**（四个码），少一个多一个都编不过——
 * 所以不会出现「表里留着一条永远没数据的句子」。认不出的码走 `suppressedUnknown` 兜底。
 */
const SUPPRESSED_SENTENCE: Readonly<Record<SuppressionReason, (text: AnalysisConclusionSendText) => string>> = {
  'quiet-hours': (text) => text.quietHours,
  'toast-disabled': (text) => text.toastDisabled,
  'popup-disabled': (text) => text.popupDisabled,
  'desktop-disabled': (text) => text.desktopDisabled
}
