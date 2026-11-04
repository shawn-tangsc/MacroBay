import type { AppLanguage } from '@platform/settings/schema/appSettings'

/**
 * 设置 → 通知 这一屏自己的文案表。
 *
 * 为什么不塞进 `platformText`：它 3500 行、三份同形结构（类型 + 中 + 英），再加二十多个键，
 * 改一次要同时改三处、错一处就编译不过。而这一屏的句子量大、只在这一屏用——通知区已经有
 * 同样的先例（`platform/i18n/notificationCopy.ts`），一处定义、两种语言、类型在中间。
 *
 * 规矩不变：**屏幕上一个字面量都不许有**，全部从这里取。
 */
export type NotificationSettingsText = {
  centerRow: string
  centerFixed: string
  centerDesc: string
  toastRow: string
  toastDesc: string
  desktopRow: string
  desktopDesc: string
  /**
   * 系统开没开桌面通知，**我们读不到**（Electron 没有这个 API）。所以这一行不画状态、不下判断，
   * 只说清「去哪儿开」和「怎么自己验证」——把身子探进系统设置里猜，就是假状态。
   */
  desktopCannotRead: string
  popupRow: string
  popupDisabled: string
  channelRow: string
  channelDesc: string
  /**
   * 没有可投递频道时的那句结论。**不画选择器**：空下拉会把「没有」说成「挑一个」，
   * 而这一行真正能给的只有一个动作——去频道页接入。
   */
  channelNone: string
  /** 有频道但还没选：这是「推送关着」，不是「没有频道」，两句话不能混。 */
  channelUnselected: string
  channelUnbound: string
  channelAmbiguous: string
  /** 失败句：时刻由 `formatShellCompactInstant` 产出，调用点只把它放进模板。 */
  /**
   * 失败行：**原因的人话 + 时刻**。原因码是闭集（`ChannelPushReason`），查不到就如实说「这次没留下原因」，
   * 绝不把码或原始错误当读者文字印上去，也不写「没有上报」——那是拿空值包装成解释。
   */
  channelPushFailed: (reason: string, at: string) => string
  /**
   * `unknown-after-send` 自己的那一句（界面规范 v2.14 §2.5）：它既不是成功，也说不清原因，
   * 套「没发出去」那句就是把「拿不到」写成「没有」——先发后断线时手机很可能已经收到了。
   */
  channelPushUnknown: (at: string) => string
  pushFailureReason: Readonly<Record<string, string>>
  pushFailureReasonUnknown: string
  channelTargetLabel: string
  channelTargetDirect: string
  channelTargetGroup: string
  channelTargetChannel: string
  channelChoosePlaceholder: string
  goConnect: string
  goCheck: string
  /** 药丸只收状态词；这三句是词，不是句子。 */
  pillNotWired: string
  pillPushFailed: string
  /** 「交出去了、没拿到回执」那一档的状态词：既不是失败也不是成功，落 `muted`。 */
  pillPushUnconfirmed: string
  /** 药丸键解析不到时的那一句：宁可说「读不出来」，也不回显键名。 */
  pillUnavailable: string
  subsColChannel: string
  notApprovedChannel: string
  /**
   * 频道列消失时的那一句：列的条件含「已选频道」，读者一取消选择或目标被解绑，整列就不出现了，
   * **但订阅还在**。没有这句，读者会以为自己的勾丢了，回头再勾一遍。
   */
  channelPendingEffective: (count: number) => string
  /** 「已记录（因勾了桌面、频道）」的连接词：两种语言的分隔规则不同，不能在这里写死。 */
  surfaceJoin: string
  /** 失败这个**结论**用 StatusPill 说：红只落在圆点与边框上，不落在句子上（见下方说明）。 */
  subsHeading: string
  subsColRecord: string
  subsColDesktop: string
  subsScope: string
  subsEmpty: string
  subsEmptyReason: string
  /**
   * 清单里每一行的事件名，按事件 id 查。
   *
   * 为什么不直接复用通知词表：产品事件的标题是**通知正文**（`{sourceName} 连续失败 {failures} 次`），
   * 带占位符、清单里又没有参数可填；这一列要的是一个能站住的短名。名字查不到就显示
   * `subsNameUnavailable`，**绝不回显键名或事件 id**——那是内部代号，读者不该看见。
   */
  eventNames: Readonly<Record<string, string>>
  /** 事件名查不到时的那一句：说「拿不到」，不说「没有」。 */
  subsNameUnavailable: string
  recordedVia: (surface: string) => string
  notApprovedDesktop: string
  readFailed: string
  readFailedHint: string
  toastSent: string
  toastOff: string
  desktopQueued: string
  desktopFailed: (reason: string) => string
  reasonUnknown: string
  /** 写操作没成功（订阅/提示开关/推送频道）：一句话说没存上，不给内部码，也不假装成功。 */
  writeFailed: string
  retry: string
  loading: string
  sendTest: string
  sendTestHint: string
}

const zh: NotificationSettingsText = {
  centerRow: '通知中心',
  centerFixed: '固定开启',
  centerDesc: '关不掉，也不能删——它是所有通知的底；桌面被系统拦下时，中心那条就是唯一证据。',
  toastRow: '应用内提示',
  toastDesc: '只决定获批的那几条要不要一闪而过；不逐条配置。',
  desktopRow: '桌面通知',
  desktopDesc: '逐条在下方清单里勾选；第一次勾桌面时才向系统请求授权。',
  desktopCannotRead:
    '横幅由系统弹出，我们读不到系统里的通知开关。没看到横幅，就去「系统设置 › 通知 › MacroBay」打开允许通知，再点一次「发送测试通知」。',
  popupRow: '高优先级弹窗',
  popupDisabled: '这个版本还没有实现弹窗；需要立刻叫醒你的事，现在走横幅，位置先留着。',
  channelRow: '发送到频道',
  channelDesc: '推送哪些事件在下方清单的频道列勾；这一行只选频道和看状态，没有开关。',
  channelNone: '还没有可用频道',
  channelUnselected: '还没有选频道：推送现在是关着的，选一条才会发到手机',
  channelUnbound: '目标未绑定：还看不出会发到哪个会话',
  channelAmbiguous: '这个频道绑了多个会话，请到频道页只保留一个；现在不发，也不替你挑',
  channelPushFailed: (reason, at) => `最近一次推送没发出去：${reason} · ${at}`,
  // 事实：发出去了、没回执。**不许压成「已发送成功」**——宁可短，不许变假话。
  channelPushUnknown: (at) => `已发给手机，未拿到确认 · ${at}`,
  pushFailureReason: Object.freeze({
    'push-unavailable': '频道还没有接通',
    'delivery-no-target-bound': '频道还没有绑定会话',
    'delivery-ambiguous-target': '频道绑了不止一个会话',
    'push-backoff': '连续失败后暂停了一会儿',
    'channel-rejected': '频道拒收了这条'
    // `unknown-after-send` 不在这张表里：它有自己的整句（`channelPushUnknown`），
    // 因为「没发出去：已交给频道」这句话自己和自己打架。
  }),
  pushFailureReasonUnknown: '这次没留下原因',
  channelTargetLabel: '目标',
  channelTargetDirect: '私聊',
  channelTargetGroup: '群聊',
  channelTargetChannel: '广播频道',
  channelChoosePlaceholder: '选择频道',
  goConnect: '去接入',
  goCheck: '去检查',
  pillNotWired: '未接入',
  pillPushFailed: '推送失败',
  pillPushUnconfirmed: '不确定',
  pillUnavailable: '状态读不出来',
  subsColChannel: '频道',
  notApprovedChannel: '这条不会到手机',
  channelPendingEffective: (count) => `已勾过频道的 ${count} 条会在频道就绪后继续生效；这一列不出现，不代表订阅被取消。`,
  surfaceJoin: '、',
  // 「失败」是结论，交给 StatusPill；句子本身用中性文字——`--danger` 在深色底上只有 3.25–3.94，
  // 一整句红字读不清，那不是风格问题而是可读性问题。
  subsHeading: '订阅清单',
  subsColRecord: '记录',
  subsColDesktop: '桌面',
  subsScope: '无条件记录的事件，取消订阅只影响桌面；结果类事件的「记录」不勾就不记。',
  subsEmpty: '现在还没有可以订阅的事件',
  subsEmptyReason: '产品与平台都还没有登记事件；登记之后它们会出现在这里。',
  subsNameUnavailable: '这一条的名称暂时读不出来',
  eventNames: Object.freeze({
    'platform.job.failed-terminal': '任务跑到终态仍失败',
    'platform.job.repeated-failed': '同一任务连续失败 3 次',
    'platform.analysis.quota-exhausted': '分析额度用尽',
    'platform.provider.credential-invalid': '模型供应商凭据失效',
    'platform.provider.credential-recovered': '模型供应商凭据恢复',
    'platform.channel.push-suspended': '推送到手机已暂停',
    'platform.channel.push-resumed': '推送到手机已恢复',
    'platform.desktop.blocked': '桌面通知没有弹出来',
    'market-intelligence.briefing.failed': '日报没生成出来',
    'market-intelligence.signal.triggered': '模块信号触发',
    'market-intelligence.macro.event-landed': '宏观事件落地',
    'market-intelligence.source.consecutive-failed': '来源连续失败',
    'market-intelligence.source.stale': '来源长时间没有新数据',
    'market-intelligence.calibration.result': '预测校准结果',
    'market-intelligence.timezone.invalid': '时区无效，自动生成已暂停'
  }),
  recordedVia: (surface) => `已记录（因勾了${surface}）`,
  notApprovedDesktop: '这条不会到桌面',
  readFailed: '通知设置没读出来',
  readFailedHint: '已经存在的订阅和开关还在，这次只是没读到',
  toastSent: '已推送到应用内。',
  toastOff: '应用内提示关着，这条没有闪出来。',
  desktopQueued: '桌面通知已交给系统，未确认显示。',
  desktopFailed: (reason) => `桌面通知发送失败：${reason}`,
  reasonUnknown: '原因不明',
  writeFailed: '这次没存上，可以再试一次',
  retry: '重试',
  loading: '正在读取通知设置…',
  sendTest: '发送测试通知',
  sendTestHint: '点一次会各测一遍：应用内提示与桌面通知，结果写在下面这一行。',
}

const en: NotificationSettingsText = {
  centerRow: 'Notification center',
  centerFixed: 'Always on',
  centerDesc:
    'It cannot be turned off or deleted: it is the floor under every notification, and when the system blocks a banner the center record is the only evidence.',
  toastRow: 'In-app hints',
  toastDesc: 'Only decides whether the approved few flash by; nothing is configured per event.',
  desktopRow: 'Desktop notifications',
  desktopDesc: 'Tick them row by row below. The system is asked for permission the first time you tick desktop.',
  desktopCannotRead:
    'The system draws the banner and we cannot read its notification switch. If no banner appears, open System Settings › Notifications › MacroBay, allow notifications, then press "Send a test notification" again.',
  popupRow: 'High-priority popup',
  popupDisabled:
    'This version does not implement popups. Anything that must wake you now goes through the banner, and the place is kept for it.',
  channelRow: 'Send to channel',
  channelDesc:
    'Which events get pushed is decided by the channel column below; this row only picks the channel and shows its state, with no switch.',
  channelNone: 'No channel is available yet',
  channelUnselected: 'No channel selected yet: pushing is off, and it reaches your phone once you pick one',
  channelUnbound: 'No target bound: it is not clear which conversation it would post to',
  channelAmbiguous:
    'This channel has several conversations bound; keep only one on the Channels page. Nothing is sent, and we do not pick for you.',
  channelPushFailed: (reason, at) => `The last push did not go out: ${reason} · ${at}`,
  channelPushUnknown: (at) => `Sent to the phone, no confirmation yet · ${at}`,
  pushFailureReason: Object.freeze({
    'push-unavailable': 'no channel is connected yet',
    'delivery-no-target-bound': 'the channel has no conversation bound',
    'delivery-ambiguous-target': 'the channel has more than one conversation bound',
    'push-backoff': 'paused for a while after repeated failures',
    'channel-rejected': 'the channel rejected this message'
    // `unknown-after-send` has its own sentence; see `channelPushUnknown`.
  }),
  pushFailureReasonUnknown: 'no reason was recorded this time',
  channelTargetLabel: 'Target',
  channelTargetDirect: 'Direct message',
  channelTargetGroup: 'Group chat',
  channelTargetChannel: 'Broadcast channel',
  channelChoosePlaceholder: 'Choose a channel',
  goConnect: 'Connect',
  goCheck: 'Check',
  pillNotWired: 'Not connected',
  pillPushFailed: 'Push failed',
  pillPushUnconfirmed: 'Unconfirmed',
  pillUnavailable: 'Status cannot be read',
  subsColChannel: 'Channel',
  notApprovedChannel: 'This never goes to the phone',
  channelPendingEffective: (count) =>
    `The ${count} ${count === 1 ? 'event' : 'events'} you ticked for the phone stay subscribed and take effect once a channel is ready; a missing column does not cancel them.`,
  surfaceJoin: ' and ',
  subsHeading: 'Subscriptions',
  subsColRecord: 'Record',
  subsColDesktop: 'Desktop',
  subsScope:
    'For events recorded unconditionally, unsubscribing only affects the desktop. For result-type events, "Record" is what decides whether it is recorded at all.',
  subsEmpty: 'There is nothing to subscribe to yet',
  subsEmptyReason: 'Neither the platform nor a product has registered an event yet; they appear here once they do.',
  subsNameUnavailable: 'The name of this entry cannot be read right now',
  eventNames: Object.freeze({
    'platform.job.failed-terminal': 'A task still failing at its final state',
    'platform.job.repeated-failed': 'The same task failed 3 times in a row',
    'platform.analysis.quota-exhausted': 'Analysis quota exhausted',
    'platform.provider.credential-invalid': 'Model provider credential rejected',
    'platform.provider.credential-recovered': 'Model provider credential restored',
    'platform.channel.push-suspended': 'Sending to your phone is paused',
    'platform.channel.push-resumed': 'Sending to your phone is back',
    'platform.desktop.blocked': 'A desktop notification did not appear',
    'market-intelligence.briefing.failed': 'The daily briefing did not generate',
    'market-intelligence.signal.triggered': 'Module signal fired',
    'market-intelligence.macro.event-landed': 'A macro event landed',
    'market-intelligence.source.consecutive-failed': 'A source keeps failing',
    'market-intelligence.source.stale': 'A source has no new data',
    'market-intelligence.calibration.result': 'Forecast calibration settled',
    'market-intelligence.timezone.invalid': 'Invalid time zone, generation paused'
  }),
  recordedVia: (surface) => `Recorded (because ${surface} is ticked)`,
  notApprovedDesktop: 'This one does not go to the desktop',
  readFailed: 'The notification settings could not be read',
  readFailedHint: 'Existing subscriptions and switches are still there; only this read failed',
  toastSent: 'Shown inside the app.',
  toastOff: 'In-app hints are off, so this did not flash by.',
  desktopQueued: 'Handed to the system; display unconfirmed.',
  desktopFailed: (reason) => `The desktop notification failed: ${reason}`,
  reasonUnknown: 'reason unknown',
  writeFailed: 'that was not saved; try again',
  retry: 'Retry',
  loading: 'Reading the notification settings…',
  sendTest: 'Send a test notification',
  sendTestHint: 'One click tests both: in-app hints and the desktop notification. The result appears on the line below.',
}

export const notificationSettingsText: Record<AppLanguage, NotificationSettingsText> = {
  'zh-CN': zh,
  'en-US': en
}
