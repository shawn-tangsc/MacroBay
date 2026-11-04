import type { AppLanguage } from '@platform/settings/schema/appSettings'

/**
 * 设置 → 通知 这一屏自己的文案表（规范 v2.27 §2/§5）。
 *
 * 这一页只剩两个开关 + 一个测试按钮 + 页脚：**没有事件清单、没有频道控件、没有「固定开启」**。
 * 订阅层在 v2.20 撤销，所以订阅矩阵、未批准灰格、频道行那批键一并删掉了——留着就是死键，
 * 下一任维护者会以为界面上还有那个对象。
 *
 * 规矩不变：**屏幕上一个字面量都不许有**，全部从这里取；说明只进 ⓘ，页面每块最多一行。
 */
export type NotificationSettingsText = {
  /** 组标题：本机 / 测试。 */
  localGroup: string
  testGroup: string
  toastRow: string
  /** ⓘ 里的两句话：它为什么存在、两个都关之后剩下什么。 */
  toastHint: string
  desktopRow: string
  /** ⓘ：弹什么、只打扰一次、系统里关掉通知时我们读不到。 */
  desktopHint: string
  /** 三个 ⓘ 的读屏名（不是句子，是控件名）。 */
  toastHintLabel: string
  desktopHintLabel: string
  footerHintLabel: string
  sendTestRow: string
  sendTest: string
  /** 页脚那一行（唯一一行常驻说明）。 */
  footerLine: string
  /** 页脚 ⓘ 第一段：中心关不掉、读过可清、超保留期自动清理。 */
  centerDesc: string
  /** 页脚 ⓘ 第二段：内置规则、本机只打扰一次、系统层面不二次兜底、手机是另一个维度。 */
  footerHint: string
  /** 测试回执：与屏幕同义，绝不写「已送达 / 已显示」。 */
  toastSent: string
  toastOff: string
  desktopQueued: string
  desktopFailed: (reason: string) => string
  reasonUnknown: string
  /** 开关没存上：不点亮、不假装成功、不显示内部码。 */
  writeFailed: string
  retry: string
  loading: string
}

const zh: NotificationSettingsText = {
  localGroup: '本机',
  testGroup: '测试',
  toastRow: '应用内提示',
  toastHint:
    '两个作用：桌面提醒开着时不会再在应用内重复；桌面关着时，它接住这些提醒。两个都关，就只剩通知中心里的记录。',
  desktopRow: '桌面提醒',
  desktopHint:
    '开了就弹桌面，同一条只打扰一次，不会再在应用内重复。系统里如果关掉了 MacroBay 的通知，我们看不到——没看到横幅就去「系统设置 › 通知 › MacroBay」打开允许通知，再点一次「发送测试通知」。',
  toastHintLabel: '应用内提示的说明',
  desktopHintLabel: '桌面提醒的说明',
  footerHintLabel: '页脚说明',
  sendTestRow: '发送测试通知',
  sendTest: '发送测试',
  footerLine: '失败与状态变化一定会记录。',
  centerDesc: '不能逐条关；读过的可以清掉，超过保留期的自动清理。',
  footerHint:
    '这些事件都由我们替你决定、不给开关。本机只打扰一次：桌面开着就弹桌面、不再在应用内重复；只有「桌面关着、这台机器不支持桌面通知、发送报错」这三种情况才改在应用内提示。系统里关掉通知这件事我们读不到，也不会因此重复弹一次。手机是另一回事——只有三条离开应用，跟这里的开关无关。',
  toastSent: '已推送到应用内。',
  toastOff: '应用内提示关着，这条没有闪出来。',
  desktopQueued: '桌面通知已交给系统，未确认显示。',
  desktopFailed: (reason) => `桌面通知发送失败：${reason}`,
  reasonUnknown: '原因不明',
  writeFailed: '这次没有保存上。',
  retry: '重试',
  loading: '正在读取通知设置…'
}

const en: NotificationSettingsText = {
  localGroup: 'On this device',
  testGroup: 'Test',
  toastRow: 'In-app hint',
  toastHint:
    'It does two things: when desktop alerts are on, this keeps a notification from repeating in the app; when desktop alerts are off, it catches them instead. With both off, only the record in the notification center remains.',
  desktopRow: 'Desktop alerts',
  desktopHint:
    'When on, it shows on the desktop; one notification disturbs you once and does not repeat in the app. We cannot see whether MacroBay notifications are turned off in the system — if no banner appears, open "System Settings › Notifications › MacroBay", allow notifications, then press "Send test" again.',
  toastHintLabel: 'About the in-app hint',
  desktopHintLabel: 'About desktop alerts',
  footerHintLabel: 'About this footer',
  sendTestRow: 'Send a test notification',
  sendTest: 'Send test',
  footerLine: 'Failures and state changes are always recorded.',
  centerDesc:
    'You cannot turn individual ones off; read ones can be cleared, and the rest age out of the retention window.',
  footerHint:
    'We decide which of these events notify you; there is no switch for them. On this device a notification disturbs you once: if desktop alerts are on it shows on the desktop and does not repeat in the app; only when desktop is off, the system does not support desktop notifications, or sending fails does it fall back to the in-app hint. We cannot read whether notifications are turned off in the system, so we do not fall back a second time and do not repeat the alert. The phone is a separate channel — only three events leave the app, and none of them depend on these switches.',
  toastSent: 'Sent in the app.',
  toastOff: 'In-app hints are off, so this one did not appear.',
  desktopQueued: 'Handed to the system; whether it appeared is unconfirmed.',
  desktopFailed: (reason) => `Sending the desktop notification failed: ${reason}`,
  reasonUnknown: 'reason unknown',
  writeFailed: 'That change was not saved.',
  retry: 'Retry',
  loading: 'Reading the notification settings…'
}

export const notificationSettingsText: Record<AppLanguage, NotificationSettingsText> = {
  'zh-CN': zh,
  'en-US': en
}
