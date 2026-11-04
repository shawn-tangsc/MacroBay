/**
 * 情报 · 通知设置页的文案（界面规范 v2.27 §9d）。
 *
 * 键都在这一张表里、中英各一份：页面不写字符串字面量，读屏名与 ⓘ 说明也从这里取。
 * 放在产品模块内、不走 `productText`，理由与通知文案表相同——这一屏的字句是它自己的，
 * 改一屏不该牵动整棵产品文案树。
 */
export type IntelligenceNotificationText = Readonly<Record<string, string>>

const ZH: IntelligenceNotificationText = Object.freeze({
  'pages.intelligence.notification.groupTitle': '情报通知',
  'pages.intelligence.notification.groupInfo.1': '这三条会发到手机；其余情报只出现在应用内和通知中心。',
  'pages.intelligence.notification.groupInfo.2': '四条同时成立才会推到手机：这里勾了、事件本身允许推手机、频道已启用、频道可用。',

  'pages.intelligence.notification.channelNotReady': '还没有可用频道，勾选会保留，等频道能用时生效。',

  'pages.intelligence.notification.rows.signalTriggered.title': '模块信号触发',
  'pages.intelligence.notification.rows.signalTriggered.info': '规则命中且达到严重度门槛时推一条；同一个信号在合并窗口内只算一次。',
  'pages.intelligence.notification.rows.macroEventLanded.title': '宏观事件落地',
  'pages.intelligence.notification.rows.macroEventLanded.info': '事件实际发布、或读数偏差超过阈值时推一条。',
  'pages.intelligence.notification.rows.briefingReady.title': '日报已完成',
  'pages.intelligence.notification.rows.briefingReady.info': '每天最多一条；同一天重新生成不会再发。默认开着，不想收可以关掉。',

  'pages.intelligence.notification.saveFailed': '这次没存上，可以再试一次。',
  'pages.intelligence.notification.footer': '只有这三条会发到手机；其余情报只出现在应用内和通知中心。',

  'pages.intelligence.notification.infoAria': '这三条推送的生效条件',
  'pages.intelligence.notification.rowInfoAria': '这一条什么时候推'
})

const EN: IntelligenceNotificationText = Object.freeze({
  'pages.intelligence.notification.groupTitle': 'Intelligence notifications',
  'pages.intelligence.notification.groupInfo.1': 'Only these three reach your phone; everything else stays in the app and the notification centre.',
  'pages.intelligence.notification.groupInfo.2': 'All four must hold: switched on here, the event allows phone delivery, the channel is enabled, and the channel is available.',

  'pages.intelligence.notification.channelNotReady': 'No usable channel yet. Your choices are kept and take effect once a channel is available.',

  'pages.intelligence.notification.rows.signalTriggered.title': 'Module signal triggers',
  'pages.intelligence.notification.rows.signalTriggered.info': 'Sends one notice when a rule fires above the severity threshold; the same signal counts once inside the merge window.',
  'pages.intelligence.notification.rows.macroEventLanded.title': 'Macro event released',
  'pages.intelligence.notification.rows.macroEventLanded.info': 'Sends one notice when a release actually lands, or when a reading deviates beyond the threshold.',
  'pages.intelligence.notification.rows.briefingReady.title': 'Daily brief is ready',
  'pages.intelligence.notification.rows.briefingReady.info': 'At most one a day; regenerating the same day does not send another. On by default — switch it off if you do not want it.',

  'pages.intelligence.notification.saveFailed': 'That did not save. You can try again.',
  'pages.intelligence.notification.footer': 'Only these three reach your phone; the rest of the intelligence stays in the app and the notification centre.',

  'pages.intelligence.notification.infoAria': 'When these three reach your phone',
  'pages.intelligence.notification.rowInfoAria': 'When this one sends'
})

export const intelligenceNotificationText: Readonly<Record<'zh-CN' | 'en-US', IntelligenceNotificationText>> =
  Object.freeze({ 'zh-CN': ZH, 'en-US': EN })
