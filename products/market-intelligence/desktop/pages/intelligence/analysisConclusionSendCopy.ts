import type { SendOutcomeState } from './analysisConclusionSendState'
import type { AnalysisConclusionSendText } from './analysisConclusionSendText'

/**
 * 状态 → 那一句话。**这是唯一拼句子的地方**：组件只渲染它给的结果。
 *
 * 两处数据来自不同来源，不许互相代替：
 * - **这一次发没发出去**：只看回执（`SendOutcomeState`）；
 * - **通道有几条、叫什么**：只看 `resolvePushChannel` 的那一份派生（`ChannelAvailability`）。
 */
/**
 * 点击前的通道事实：只用来判「0 条 / 多条」这种配置问题。
 * **没有通道名**——名字只认这次提交的回执，两种来源不混用。
 */
export type SendChannelFacts = Readonly<{ enabledChannelCount: number; multiple: boolean }>

export type SendStatusCopy = Readonly<{
  /** 说明行那一句。 */
  message: string
  /** 折叠区里那一枚原因码；没有就没有折叠项。 */
  reasonCode?: string
}>

export function describeSendStatus(input: Readonly<{
  state: SendOutcomeState
  text: AnalysisConclusionSendText
  /** 回执里这次真的发到的通道名（与提交同一次结果）；没有就用中性命。 */
  receiptChannelName?: string | undefined
  /** 点击前的通道事实（`resolvePushChannel` 的派生）：只用于「0 条 / 多条」的指路句。 */
  channel?: SendChannelFacts | undefined
  /** 已格式化好的时刻（读者时区）。 */
  time: string
}>): SendStatusCopy {
  const { state, text } = input
  // 通道名跟着**这次提交的结果**走；`channel` 那一份派生只回答「点击前有没有可用通道」，
  // 不参与「已发到 X」这句话——两个问题两个来源。
  const channelName = input.receiptChannelName ?? text.channelUnknown
  const fill = (sentence: string): string => sentence.replaceAll('{channel}', channelName).replaceAll('{time}', input.time)
  switch (state.state) {
    case 'sent': return { message: fill(text.sentAccepted) }
    case 'handed': return { message: fill(text.sentUnconfirmed) }
    // 记录在、中心有条，只是手机那档没排上：不许写成「失败」。
    case 'app-only': return { message: fill(text.appOnly) }
    case 'suppressed': return { message: suppressedSentence(state.reason, text) }
    case 'push-unavailable': {
      // 0 条与多条是两种下一步：一条要「去启用」，多条要「停到只剩一条」。
      const multiple = input.channel === undefined ? false : input.channel.multiple || input.channel.enabledChannelCount > 1
      return { message: multiple ? text.pushUnavailableMultiple : text.pushUnavailableNone, reasonCode: 'push-unavailable' }
    }
    case 'not-sent': return { message: text.notSent, reasonCode: state.reason ?? 'channel-rejected' }
    case 'failed': return { message: text.failed, reasonCode: state.reason }
  }
}

/** 被压下的六种原因各一句：上限与免打扰下一步不同，不许合成一句「没发出去」。 */
function suppressedSentence(reason: Extract<SendOutcomeState, { state: 'suppressed' }>['reason'], text: AnalysisConclusionSendText): string {
  switch (reason) {
    case 'quiet-hours': return text.quietHours
    case 'daily-limit': return text.dailyLimit
    case 'minimum-gap': return text.minimumGap
    case 'surface-off': return text.surfaceOff
    case 'not-subscribed': return text.notSubscribed
    case 'not-approved': return text.notApproved
    case 'desktop-unsupported': return text.desktopUnsupported
  }
}
