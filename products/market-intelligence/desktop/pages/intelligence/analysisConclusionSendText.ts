/**
 * 「发送到频道」的说法，一张表。
 *
 * 为什么是一张表而不是散在组件里：投递结果的最终口径还在架构师手上
 * （「已发到 / 已交给但没确认 / 没发到 / 只在应用内」与「被压下：免打扰、上限、冷却…」），
 * 所以状态（`analysisConclusionSendState`）先把事实分对，句子只从这里取；口径定了只改这里。
 *
 * 三条写进句子的规矩：
 * - **只表示通道受理**，不写「送达」——我们只知道通道接了这次请求；
 * - **没拿到回执照实说**，不并进成功句里；
 * - **被压下的那一档不叫「没发到手机」**：设备在免打扰时段不等于通道坏了，下一步是关勿扰或明天再试。
 *
 * 通道名由调用方填（`resolvePushChannel` 给的显示名）；拿不到名字时用 `channelUnknown`，
 * 不印花括号、也不编一个品牌名。
 */
export type AnalysisConclusionSendText = Readonly<{
  button: string
  /** 发送中的按钮文案。它比按钮短，按钮宽度按两句里更宽的那句留——见组件里的三层标签。 */
  sending: string
  /** 标题旁那颗 ⓘ 的读屏名与展开内容（一行）。 */
  infoLabel: string
  infoHint: string
  /** `{channel}` 与 `{time}` 由调用方填。 */
  sentAccepted: string
  sentUnconfirmed: string
  /** 记录在、中心有条，手机那一档没排上（没给原因）。 */
  appOnly: string
  /** 被压下：设备在免打扰时段。下一步是关勿扰或明天再试，不是查通道。 */
  quietHours: string
  /** 被压下：平台每日上限。下一步是等明天。 */
  dailyLimit: string
  /** 被压下：冷却中（同类通知刚发过不久）。 */
  cooldown: string
  /** 被压下：读者自己关了这条事件的手机档。 */
  surfaceOff: string
  /** 被压下：该档没有批准（代码与批准表不一致，属缺陷，但界面不许装成成功）。 */
  notApproved: string
  /** 被压下：设备给不了桌面通知——这条事件在手机上不适用。 */
  desktopUnsupported: string
  /** 通道 0 条：指路去启用一条。 */
  pushUnavailableNone: string
  /** 通道多条：指路停用到只剩一条。 */
  pushUnavailableMultiple: string
  /** 手机档排上了但通道报错。 */
  notSent: string
  /** 提交层面的其他失败（含请求没到）。 */
  failed: string
  channelUnknown: string
  /** 折叠项的名字；原因码本身由调用方给。 */
  reasonLabel: string
}>

const zh: AnalysisConclusionSendText = {
  button: '发送到频道',
  sending: '正在发送',
  infoLabel: '发送说明',
  infoHint: '只发最新那条结论，走的是你自动收到推送的同一条通道。',
  sentAccepted: '已发到 {channel} · {time}',
  sentUnconfirmed: '已交给 {channel}，没拿到回执 · {time}',
  appOnly: '只留在应用内，没到手机 · {time}',
  quietHours: '这次没有真的发出去：设备在免打扰时段，关掉勿扰或明天再试',
  dailyLimit: '今天的上限到了（每天 4 条），明天再发',
  cooldown: '同类通知刚发过，这一条被合并了；稍后可以再发一次',
  surfaceOff: '你关掉了这条通知的手机档，这次只留在应用内',
  notApproved: '这个版本没有批准这一档，没发出去',
  desktopUnsupported: '这台设备收不了这类通知',
  pushUnavailableNone: '没发到手机：还没有可用的通道，去「频道」启用一条',
  pushUnavailableMultiple: '没发到手机：启用了不止一条通道，去「频道」停用到只剩一条',
  notSent: '没发到手机',
  failed: '没发出去',
  channelUnknown: '推送通道',
  reasonLabel: '原因码'
}

const en: AnalysisConclusionSendText = {
  button: 'Send to channel',
  sending: 'Sending',
  infoLabel: 'About sending',
  infoHint: 'Sends only the newest conclusion, over the same channel your automatic pushes use.',
  sentAccepted: 'Sent to {channel} · {time}',
  sentUnconfirmed: 'Handed to {channel}, no receipt yet · {time}',
  appOnly: 'Stayed in the app, not sent to your phone · {time}',
  quietHours: 'Not actually sent this time: your device is in quiet hours — turn it off or try tomorrow',
  dailyLimit: 'Today’s limit is reached (4 a day) — try again tomorrow',
  cooldown: 'A notification like this one just went out, so this one was merged; you can send again later',
  surfaceOff: 'You turned off the phone leg for this notification, so it stayed in the app',
  notApproved: 'This build has not approved that leg, so nothing was sent',
  desktopUnsupported: 'This device cannot receive this kind of notification',
  pushUnavailableNone: 'Not sent to your phone: no usable channel yet — enable one under Channels',
  pushUnavailableMultiple: 'Not sent to your phone: more than one channel is enabled — turn all but one off under Channels',
  notSent: 'Not sent to your phone',
  failed: 'Not sent',
  channelUnknown: 'push channel',
  reasonLabel: 'Reason code'
}

export function analysisConclusionSendText(language: 'zh-CN' | 'en-US'): AnalysisConclusionSendText {
  return language === 'zh-CN' ? zh : en
}
