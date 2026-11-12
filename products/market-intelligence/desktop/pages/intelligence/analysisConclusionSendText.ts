/**
 * 「发送到频道」的说法，一张表。
 *
 * 为什么是一张表而不是散在组件里：状态（`analysisConclusionSendState`）先把事实分对，
 * 句子只从这里取；说法要改就改这里，组件与判定不动。
 *
 * 四条写进句子的规矩：
 * - **多通道是合法配置**（一条消息发到所有已启用通道）：总括句只说**几条收到、几条没到**，
 *   正文**不出现通道名**，也不写「已推送」「已发送」；
 * - **只表示通道受理**，不写「送达」——我们只知道通道接了这次请求；
 * - **没拿到回执另成一档**：既不说收到、也不说没到，中性占位；
 * - **被压下的那一档不叫「没发到手机」**：设备在免打扰时段不等于通道坏了，下一步是关勿扰或明天再试。
 *
 * 通道名只出现在 ⓘ 的逐行说明里（回执里的名字）；拿不到名字时用 `channelUnknown`，
 * 不印花括号、也不编一个品牌名。原因码不上屏，只翻成人话。
 */
export type AnalysisConclusionSendText = Readonly<{
  button: string
  /** 发送中的按钮文案。它比按钮短，按钮宽度按两句里更宽的那句留——见组件里的三层标签。 */
  sending: string
  /** 标题旁那颗 ⓘ 的读屏名与展开内容（一行）。 */
  infoLabel: string
  infoHint: string
  /** 记录在、中心有条，手机那一档没排上（没给原因）。`{time}` 由调用方填。 */
  appOnly: string
  /**
   * 被压下：设备在免打扰时段。**免打扰是「筛掉」不是「顺延」**——平台摘掉手机档之后没有任何补发路径，
   * 所以句子必须说「不会自动补发」，并给出现在就能做的那一步（关掉免打扰再点一次）。
   */
  quietHours: string
  /** 被压下：平台每日上限。下一步是等明天。 */
  dailyLimit: string
  /** 被压下：应用内提示关着。 */
  toastDisabled: string
  /** 被压下：高优先级弹窗关着。 */
  popupDisabled: string
  /** 被压下：桌面通知关着。 */
  desktopDisabled: string
  /** 平台报了一个这台设备不认识的原因：如实说没认出来，别空着，也别当成已发送。 */
  suppressedUnknown: string
  /** 被压下：读者自己关了这条事件的手机档。 */
  surfaceOff: string

  /** 通道 0 条：指路去启用一条。 */
  pushUnavailableNone: string
  /** 提交层面的其他失败（含请求没到）。 */
  failed: string
  channelUnknown: string

  /**
   * 多通道的总括句：**正文只有数字，没有通道名**。
   * `{n}` 是这次的目标通道数；`{ok}` / `{failed}` 是收到的与没到的条数。
   */
  deliveredAll: string
  deliveredPartial: string
  noneReceived: string
  /**
   * 「发出去但没收到回执」这一档的中性占位（产品还在定稿）：既不说收到、也不说没到。
   * 它**不是**失败态，呈现上不用失败色。
   */
  unconfirmed: string

  /** ⓘ 的读屏名：浮层里是逐通道那一行「名字 · 人话原因」。 */
  channelsLabel: string
  /** 逐通道三种状态的人话（收到 / 没收到 / 发出去了没回执）。 */
  channelReceived: string
  channelNotReceived: string
  channelUnconfirmed: string
  /** 通道报了一个这台设备不认识的原因：如实说没认出来，不编一个理由。 */
  channelReasonUnknown: string
  /**
   * 平台原因码 → 人话。**码本身不上屏**；认不出的码走 `channelReasonUnknown`。
   * 值域跟着平台 `ChannelPushReason` 走，少一个只影响那一句，不影响判定。
   */
  channelReasons: Readonly<Record<string, string>>
}>

const zh: AnalysisConclusionSendText = {
  button: '发送到频道',
  sending: '正在发送',
  infoLabel: '发送说明',
  infoHint: '只发最新那条结论，走的是你自动收到推送的同一条通道。',
  deliveredAll: '{n} 条通道都收到了',
  deliveredPartial: '{ok} 条通道收到，{failed} 条没到',
  noneReceived: '没有任何通道收到（共 {n} 条）',
  unconfirmed: '已送出去，还没收到回执',
  channelsLabel: '这次每条通道的结果',
  channelReceived: '收到了',
  channelNotReceived: '没收到',
  channelUnconfirmed: '已送出去，还没收到回执',
  channelReasonUnknown: '这次没成功（原因这台设备不认识）',
  channelReasons: {
    'channel-rejected': '通道没接这次请求',
    'push-backoff': '这条通道刚失败过几次，暂时没有重试',
    'unknown-after-send': '送到一半失去响应，不知道到没到',
    'delivery-no-target-bound': '这条通道没有绑定投递目标',
    'delivery-ambiguous-target': '有多个同名通道，不确定发给哪一条',
    'push-unavailable': '这条通道现在不可用'
  },
  appOnly: '只留在应用内，没到手机 · {time}',
  quietHours: '这次没发到手机：现在是免打扰时段，不会自动补发。要现在验通道，关掉免打扰再点一次。',
  dailyLimit: '今天的上限到了（每天 4 条），明天再发',
  toastDisabled: '你没开应用内提示，这次只留在应用内',
  popupDisabled: '你没开高优先级弹窗，这次只留在应用内',
  desktopDisabled: '你没开桌面通知，这次只留在应用内',
  suppressedUnknown: '这次没发到手机：这台设备还不认识平台给的原因',
  surfaceOff: '你关掉了这条通知的手机档，这次只留在应用内',
  pushUnavailableNone: '没发到手机：还没有可用的通道，去「频道」启用一条',
  failed: '没发出去',
  channelUnknown: '推送通道'
}

const en: AnalysisConclusionSendText = {
  button: 'Send to channel',
  sending: 'Sending',
  infoLabel: 'About sending',
  infoHint: 'Sends only the newest conclusion, over the same channel your automatic pushes use.',
  deliveredAll: 'All {n} channels received it',
  deliveredPartial: '{ok} of {n} channels received it; {failed} did not',
  noneReceived: 'No channel received it (0 of {n})',
  unconfirmed: 'Sent, no receipt yet',
  channelsLabel: 'What each channel reported',
  channelReceived: 'received',
  channelNotReceived: 'did not receive',
  channelUnconfirmed: 'sent, no receipt yet',
  channelReasonUnknown: 'it failed for a reason this build does not recognize',
  channelReasons: {
    'channel-rejected': 'the channel did not take this request',
    'push-backoff': 'this channel failed recently, so it was not retried',
    'unknown-after-send': 'the connection dropped mid-send, so delivery is unknown',
    'delivery-no-target-bound': 'this channel has no delivery target bound',
    'delivery-ambiguous-target': 'several channels share this name, so the target was ambiguous',
    'push-unavailable': 'this channel is not available right now'
  },
  appOnly: 'Stayed in the app, not sent to your phone · {time}',
  quietHours: 'Not sent to your phone this time: it is quiet hours now, and nothing is resent later. To test the channel, turn quiet hours off and send again.',
  dailyLimit: 'Today’s limit is reached (4 a day) — try again tomorrow',
  toastDisabled: 'In-app toasts are off, so this stayed in the app',
  popupDisabled: 'High-priority popups are off, so this stayed in the app',
  desktopDisabled: 'Desktop notifications are off, so this stayed in the app',
  suppressedUnknown: 'Not sent to your phone: the platform reported a reason this build does not recognize',
  surfaceOff: 'You turned off the phone leg for this notification, so it stayed in the app',
  pushUnavailableNone: 'Not sent to your phone: no usable channel yet — enable one under Channels',
  failed: 'Not sent',
  channelUnknown: 'push channel'
}

export function analysisConclusionSendText(language: 'zh-CN' | 'en-US'): AnalysisConclusionSendText {
  return language === 'zh-CN' ? zh : en
}
