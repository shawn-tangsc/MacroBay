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
  desktopPermissionGranted: string
  desktopPermissionDenied: string
  desktopPermissionUnknown: string
  desktopKeepChoice: string
  desktopOpenSettings: string
  popupRow: string
  popupDisabled: string
  channelRow: string
  channelDesc: string
  channelNone: string
  channelNoEvidence: string
  channelTargetUnbound: string
  channelTargetMultiple: string
  channelLastPushFailed: (reason: string, time: string) => string
  /** 失败这个**结论**用 StatusPill 说：红只落在圆点与边框上，不落在句子上（见下方说明）。 */
  channelPushFailedPill: string
  channelGoConnect: string
  channelGoCheck: string
  channelSelectLabel: string
  subsHeading: string
  subsColRecord: string
  subsColDesktop: string
  subsColChannel: string
  subsChannelBlocked: string
  subsScope: string
  subsEmpty: string
  subsEmptyReason: string
  recordedVia: (surface: string) => string
  notApprovedDesktop: string
  notApprovedChannel: string
  readFailed: string
  readFailedHint: string
  toastSent: string
  toastOff: string
  desktopQueued: string
  desktopFailed: (reason: string) => string
  reasonUnknown: string
  retry: string
  loading: string
  sendTest: string
  sendTestHint: string
  testPushNotSent: string
  testPushAccepted: (code: string) => string
  testPushUnconfirmed: string
  testPushFailed: (reason: string) => string
}

const zh: NotificationSettingsText = {
  centerRow: '通知中心',
  centerFixed: '固定开启',
  centerDesc: '关不掉，也不能删——它是所有通知的底；桌面被系统拦下时，中心那条就是唯一证据。',
  toastRow: '应用内提示',
  toastDesc: '只决定获批的那几条要不要一闪而过；不逐条配置。',
  desktopRow: '桌面通知',
  desktopDesc: '逐条在下方清单里勾选；第一次勾桌面时才向系统请求授权。',
  desktopPermissionGranted: '系统已放行桌面通知',
  desktopPermissionDenied: '系统通知没有放行，去「系统设置 › 通知 › MacroBay」打开',
  desktopPermissionUnknown: '暂时无法确认系统是否放行',
  desktopKeepChoice: '这里的选择会被保留，系统放行后生效。',
  desktopOpenSettings: '去系统设置',
  popupRow: '高优先级弹窗',
  popupDisabled: '这个版本还没有实现弹窗；需要立刻叫醒你的事，现在走横幅，位置先留着。',
  channelRow: '发送到通道',
  channelDesc: '推送哪些事件在下方清单的通道列勾；这一行只选通道和看状态，没有开关。',
  channelNone: '还没有可用通道',
  channelNoEvidence: '需要一条真机验证记录才能启用；状态在通道接入页',
  channelTargetUnbound: '目标未绑定：还看不出会发到哪个会话',
  channelTargetMultiple: '这个通道绑了多个会话，请到通道页只保留一个',
  channelLastPushFailed: (reason, time) => `最近一次推送没发出去：${reason} · ${time}`,
  // 「失败」是结论，交给 StatusPill；句子本身用中性文字——`--danger` 在深色底上只有 3.25–3.94，
  // 一整句红字读不清，那不是风格问题而是可读性问题。
  channelPushFailedPill: '推送失败',
  channelGoConnect: '去接入',
  channelGoCheck: '去检查',
  channelSelectLabel: '通道选择',
  subsHeading: '订阅清单',
  subsColRecord: '记录',
  subsColDesktop: '桌面',
  subsColChannel: '通道',
  subsChannelBlocked: '还没有可用通道：先接入并完成一次真机验证，这里才能勾。',
  subsScope: '无条件记录的事件，取消订阅只影响桌面与手机；结果类事件的「记录」不勾就不记。',
  subsEmpty: '现在还没有可以订阅的事件',
  subsEmptyReason: '产品与平台都还没有登记事件；登记之后它们会出现在这里。',
  recordedVia: (surface) => `已记录（因勾了${surface}）`,
  notApprovedDesktop: '这条不会到桌面',
  notApprovedChannel: '这条不会到你的手机',
  readFailed: '通知设置没读出来',
  readFailedHint: '已经存在的订阅和开关还在，这次只是没读到',
  toastSent: '已推送到应用内。',
  toastOff: '应用内提示关着，这条没有闪出来。',
  desktopQueued: '桌面通知已交给系统，未确认显示。',
  desktopFailed: (reason) => `桌面通知发送失败：${reason}`,
  reasonUnknown: '原因不明',
  retry: '重试',
  loading: '正在读取通知设置…',
  sendTest: '发送测试通知',
  sendTestHint: '点一次会各测一遍：应用内提示与桌面通知，结果写在下面这一行。',
  testPushNotSent: '没有可用通道或目标未绑定，这条没有发到手机。',
  testPushAccepted: (code) => `通道已受理，短编号 #${code}。手机是否看到，我们无法确认。`,
  testPushUnconfirmed: '已交给通道，我们无法确认你手机是否看到。',
  testPushFailed: (reason) => `没发到手机：${reason}`
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
  desktopPermissionGranted: 'The system allows desktop notifications',
  desktopPermissionDenied: 'System notifications are not allowed. Open System Settings › Notifications › MacroBay',
  desktopPermissionUnknown: 'Cannot tell right now whether the system allows them',
  desktopKeepChoice: 'Your choices here are kept and take effect once the system allows them.',
  desktopOpenSettings: 'Open System Settings',
  popupRow: 'High-priority popup',
  popupDisabled:
    'This version does not implement popups. Anything that must wake you now goes through the banner, and the place is kept for it.',
  channelRow: 'Send to a channel',
  channelDesc:
    'Which events go to your phone is decided in the channel column below; this row only picks the channel and reports its state. There is no switch here.',
  channelNone: 'No channel is available yet',
  channelNoEvidence: 'A real-device record is needed before it can be enabled; its state is on the channel page',
  channelTargetUnbound: 'No target bound: it is not yet knowable which conversation will receive it',
  channelTargetMultiple: 'This channel is bound to several conversations; keep only one on the channel page',
  channelLastPushFailed: (reason, time) => `The last push did not go out: ${reason} · ${time}`,
  channelPushFailedPill: 'Push failed',
  channelGoConnect: 'Connect one',
  channelGoCheck: 'Check it',
  channelSelectLabel: 'Channel',
  subsHeading: 'Subscriptions',
  subsColRecord: 'Record',
  subsColDesktop: 'Desktop',
  subsColChannel: 'Channel',
  subsChannelBlocked: 'No channel available: connect one and complete a real-device check before ticking here.',
  subsScope:
    'For events recorded unconditionally, unsubscribing only affects desktop and phone. For result-type events, "Record" is what decides whether it is recorded at all.',
  subsEmpty: 'There is nothing to subscribe to yet',
  subsEmptyReason: 'Neither the platform nor a product has registered an event yet; they appear here once they do.',
  recordedVia: (surface) => `Recorded (because ${surface} is ticked)`,
  notApprovedDesktop: 'This one does not go to the desktop',
  notApprovedChannel: 'This one does not go to your phone',
  readFailed: 'The notification settings could not be read',
  readFailedHint: 'Existing subscriptions and switches are still there; only this read failed',
  toastSent: 'Shown inside the app.',
  toastOff: 'In-app hints are off, so this did not flash by.',
  desktopQueued: 'Handed to the system; display unconfirmed.',
  desktopFailed: (reason) => `The desktop notification failed: ${reason}`,
  reasonUnknown: 'reason unknown',
  retry: 'Retry',
  loading: 'Reading the notification settings…',
  sendTest: 'Send a test notification',
  sendTestHint: 'One click tests both: in-app hints and the desktop notification. The result appears on the line below.',
  testPushNotSent: 'No channel available or no target bound, so this did not reach your phone.',
  testPushAccepted: (code) => `The channel accepted it, short id #${code}. Whether your phone showed it, we cannot confirm.`,
  testPushUnconfirmed: 'Handed to the channel; we cannot confirm your phone showed it.',
  testPushFailed: (reason) => `Did not reach your phone: ${reason}`
}

export const notificationSettingsText: Record<AppLanguage, NotificationSettingsText> = {
  'zh-CN': zh,
  'en-US': en
}
