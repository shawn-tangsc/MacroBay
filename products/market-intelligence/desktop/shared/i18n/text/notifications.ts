import type { NotificationCopyTableSet } from '@platform/notifications/contracts/notificationCopyPort'

import { indicatorNames } from '../../../../contracts/indicatorNames'
import { macroEventNotificationSentences } from '../../../../contracts/macroEventNotificationSentences'
import { sentimentAlertTemplates } from '../../../../contracts/sentimentAlertSentences'
import { signalNotificationSentences } from '../../../../contracts/signalNotificationSentences'
import {
  ACKNOWLEDGE_ACTION_KEY,
  MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS as IDS,
  OPEN_BRIEFING_ACTION_KEY,
  notificationEventBodyKey,
  notificationEventNamedKey,
  notificationEventHeadlineKey,
  notificationEventReasonKey,
  notificationEventTitleKey,
  notificationEventVariantKey
} from '../../../../contracts/notificationEventKeys'

/**
 * 情报模块 8 条通知事件的文案（中英各一份）。完成类只有「日报已完成」一条，且默认不勾。
 *
 * 键全部由事件 id 机械生成（`contracts/notificationEventKeys.ts`），这里只给句子，不另起一套键：
 * 事件改名时句子跟着改，键不会落空。正文变体名与声明里的 `bodyKeyByVariant` 逐字对应。
 *
 * 参数只有来源两条用：`{sourceName}`（来源的显示名）与 `{failures}`（连续失败次数）。
 * 缺参不会被印成 `{sourceName}` 这种原文——文案端口解析不出会回退兜底句（契约 §3.3）。
 */
export type MarketIntelligenceNotificationCopy = NotificationCopyTableSet

const TITLE = notificationEventTitleKey

/** 两种语言各一个别名：表里每一行都短，读起来像一句话而不是一条寻址。 */
const zh = { signal: signalNotificationSentences['zh-CN'], macro: macroEventNotificationSentences['zh-CN'], alert: sentimentAlertTemplates['zh-CN'] }
const en = { signal: signalNotificationSentences['en-US'], macro: macroEventNotificationSentences['en-US'], alert: sentimentAlertTemplates['en-US'] }
const BODY = notificationEventBodyKey
const REASON = notificationEventReasonKey

export const marketIntelligenceNotificationCopy: MarketIntelligenceNotificationCopy = Object.freeze({
  'zh-CN': Object.freeze({
    [TITLE(IDS.briefingFailed)]: '日报没生成出来',
    // 产品动作的标签（v2.58）：与正文同一条解析链路。句子与搬家前逐字相同。
    [OPEN_BRIEFING_ACTION_KEY]: '打开日报',
    [ACKNOWLEDGE_ACTION_KEY]: '知道了',
    [notificationEventVariantKey(IDS.briefingFailed, 'not-generated')]: '{date} {time} {language}这一期没有生成出来。',
    [notificationEventVariantKey(IDS.briefingFailed, 'editorial-missing')]: '{date} {time} {language}这一期数据齐了，但解读没出来。',
    [REASON(IDS.briefingFailed)]: '这一期跑完了仍然失败。',

    // 句子与源头拼成品**共用同一份字符串**（`contracts/signalNotificationSentences.ts`）：
    // 标题以资产名开头；正文四个变体是规则 × 档位，模板里不写任何阈值。
    // 这几条只服务已经落库的旧记录——新记录存的是成品，平台不再读这张表。
    [TITLE(IDS.signalTriggered)]: zh.signal.title,
    [notificationEventHeadlineKey(IDS.signalTriggered, 'etfOutflow')]: zh.signal.headline.etfOutflow,
    [notificationEventHeadlineKey(IDS.signalTriggered, 'oiDrop')]: zh.signal.headline.oiDrop,
    [notificationEventHeadlineKey(IDS.signalTriggered, 'etfOutflowAggravated')]: zh.signal.headline.etfOutflowAggravated,
    [notificationEventHeadlineKey(IDS.signalTriggered, 'oiDropAggravated')]: zh.signal.headline.oiDropAggravated,
    [notificationEventHeadlineKey(IDS.signalTriggered, 'oiLong')]: zh.signal.headline.oiLong,
    [notificationEventHeadlineKey(IDS.signalTriggered, 'oiLongAggravated')]: zh.signal.headline.oiLongAggravated,
    [notificationEventHeadlineKey(IDS.signalTriggered, 'oiShort')]: zh.signal.headline.oiShort,
    [notificationEventHeadlineKey(IDS.signalTriggered, 'oiShortAggravated')]: zh.signal.headline.oiShortAggravated,
    [notificationEventVariantKey(IDS.signalTriggered, 'etfOutflow')]: zh.signal.body.etfOutflow,
    [notificationEventVariantKey(IDS.signalTriggered, 'etfOutflowAggravated')]: zh.signal.body.etfOutflowAggravated,
    [notificationEventVariantKey(IDS.signalTriggered, 'oiDrop')]: zh.signal.body.oiDrop,
    [notificationEventVariantKey(IDS.signalTriggered, 'oiDropAggravated')]: zh.signal.body.oiDropAggravated,
    [notificationEventVariantKey(IDS.signalTriggered, 'oiLong')]: zh.signal.body.oiLong,
    [notificationEventVariantKey(IDS.signalTriggered, 'oiLongAggravated')]: zh.signal.body.oiLongAggravated,
    [notificationEventVariantKey(IDS.signalTriggered, 'oiShort')]: zh.signal.body.oiShort,
    [notificationEventVariantKey(IDS.signalTriggered, 'oiShortAggravated')]: zh.signal.body.oiShortAggravated,
    [REASON(IDS.signalTriggered)]: zh.signal.reason,

    // 与源头拼成品**共用同一份字符串**（`contracts/macroEventNotificationSentences.ts`）；
    // 这几条只服务已落库的旧记录——新记录存的是成品，平台不再读这张表。
    // N10 舆情：标题【强度】+ 原文标题、正文来源、理由是一句事实（不含任何动作指令）。
    // 日历事件的开始前提醒：实际发出的句子在源头按「哪一条事件 + 读者时区的时刻 +
    // 还剩多少分钟」拼好（`renderCalendarReminderSentence`），这里必须也有三格——声明指着的
    // 键一旦空缺，界面上印的就是键名，而且不会报错。三句都不含动作指令（手机推送不许带）。
    [TITLE(IDS.calendarEventUpcoming)]: '日历事件即将开始',
    [BODY(IDS.calendarEventUpcoming)]: '按你设定的提前量提醒：有一条日历事件快开始了。',
    [REASON(IDS.calendarEventUpcoming)]: '你打开了日历事件的开始前提醒。',

    // 刷新失败（2026-11-11 用户：「失败了，要通知」）：**不出现任何内部码**，原因走人话表；
    // 没有码时不编原因，只用 `no-reason` 那一版。
    [TITLE(IDS.calendarRefreshFailed)]: '日历刷新失败',
    // 变体名 = 失败码：句子里**不出现任何内部码**，原因就是这句人话（没有码时不编原因）。
    [notificationEventVariantKey(IDS.calendarRefreshFailed, 'input-invalid')]: '{source} 这次没刷新成功：请求没有通过校验。已有事件还在，不会丢。',
    [notificationEventVariantKey(IDS.calendarRefreshFailed, 'credential-not-configured')]: '{source} 这次没刷新成功：还没有配置凭据。已有事件还在，不会丢。',
    [notificationEventVariantKey(IDS.calendarRefreshFailed, 'response-unavailable')]: '{source} 这次没刷新成功：来源没有响应。已有事件还在，不会丢。',
    [notificationEventVariantKey(IDS.calendarRefreshFailed, 'archive-unavailable')]: '{source} 这次没刷新成功：证据归档不可用。已有事件还在，不会丢。',
    [notificationEventVariantKey(IDS.calendarRefreshFailed, 'parse-unavailable')]: '{source} 这次没刷新成功：返回的内容没能解析出来。已有事件还在，不会丢。',
    [notificationEventVariantKey(IDS.calendarRefreshFailed, 'storage-unavailable')]: '{source} 这次没刷新成功：本地存储不可用。已有事件还在，不会丢。',
    [notificationEventVariantKey(IDS.calendarRefreshFailed, 'storage-pressure')]: '{source} 这次没刷新成功：本地存储空间受限。已有事件还在，不会丢。',
    [notificationEventVariantKey(IDS.calendarRefreshFailed, 'no-code')]: '{source} 这次没刷新成功。已有事件还在，不会丢。',
    [REASON(IDS.calendarRefreshFailed)]: '市场日历的一次刷新没有完成。',

    [TITLE(IDS.sentimentAlert)]: zh.alert.title,
    [notificationEventVariantKey(IDS.sentimentAlert, 'withSource')]: zh.alert.bodyWithSource,
    [REASON(IDS.sentimentAlert)]: zh.alert.reason,
    [notificationEventNamedKey(IDS.sentimentAlert, 'strength.high')]: zh.alert.strength.high,
    [notificationEventNamedKey(IDS.sentimentAlert, 'strength.medium')]: zh.alert.strength.medium,
    [notificationEventNamedKey(IDS.sentimentAlert, 'strength.low')]: zh.alert.strength.low,
    [TITLE(IDS.macroEventLanded)]: zh.macro.title,
    [notificationEventNamedKey(IDS.macroEventLanded, 'direction.above')]: zh.macro.direction.above,
    [notificationEventNamedKey(IDS.macroEventLanded, 'direction.below')]: zh.macro.direction.below,
    [notificationEventNamedKey(IDS.macroEventLanded, 'direction.matched')]: zh.macro.direction.matched,
    // 指标名一张表：已注册按标识、自由文本按源站标题；表外就用原文（通知里拼的是字面量）。
    ...Object.fromEntries(
      Object.entries(indicatorNames).map(([id, name]) => [
        notificationEventNamedKey(IDS.macroEventLanded, `indicator.${id}`),
        name.zh
      ])
    ),

    [notificationEventNamedKey(IDS.macroEventLanded, 'country.US')]: zh.macro.country.US,
    [notificationEventVariantKey(IDS.macroEventLanded, 'values')]: zh.macro.body.values,
    [notificationEventVariantKey(IDS.macroEventLanded, 'noPrevious')]: zh.macro.body.noPrevious,
    [notificationEventVariantKey(IDS.macroEventLanded, 'noForecast')]: zh.macro.body.noForecast,
    [notificationEventVariantKey(IDS.macroEventLanded, 'matched')]: zh.macro.body.matched,
    [notificationEventNamedKey(IDS.macroEventLanded, 'periodicity.yoy')]: zh.macro.periodicity.yoy,
    [notificationEventNamedKey(IDS.macroEventLanded, 'periodicity.mom')]: zh.macro.periodicity.mom,
    [REASON(IDS.macroEventLanded)]: zh.macro.reason,

    [TITLE(IDS.sourceConsecutiveFailed)]: '{sourceName} 连续失败 {failures} 次',
    [BODY(IDS.sourceConsecutiveFailed)]: '这个来源一直取不到数据，去设置检查密钥或代理。',
    [REASON(IDS.sourceConsecutiveFailed)]: '同一个来源连续三次失败，提醒一次。',

    [TITLE(IDS.sourceStale)]: '{sourceName} 这段时间没有新内容',
    [BODY(IDS.sourceStale)]: '这个源在它的静默窗口内没有带来新条目。去设置里检查它的开关和连接。',
    [REASON(IDS.sourceStale)]: '最后一条新内容出现在这个窗口之前，之后的采集都没有带来新条目。',

    [TITLE(IDS.briefingReady)]: '日报已完成',
    [BODY(IDS.briefingReady)]: '{date} {time} {language}这一期已经生成。',
    [REASON(IDS.briefingReady)]: '你订阅了日报完成提醒。',

    // N12：信号唤起的那次分析出结论。正文由源头拼成品（结论一句 + 半句理由），这张表只是旧记录的回退句。
    [TITLE(IDS.analysisConclusion)]: '分析结论',
    [BODY(IDS.analysisConclusion)]: '这次分析的结论已经出来了。',
    [REASON(IDS.analysisConclusion)]: '你订阅了信号触发的分析结论提醒。',
    // 分析额度那条正文里的线名：句子属于产品自己的分析线，平台文案表里不再寄存（v2.59）。
    'notification.analysis-line.market-intelligence.event': '行情变动分析',
    'notification.analysis-line.market-intelligence.calendar': '日历事件分析',

    [TITLE(IDS.timezoneInvalid)]: '时区无效，自动生成已暂停',
    [BODY(IDS.timezoneInvalid)]: '去设置里改成有效的时区，日报会恢复自动生成。',
    [REASON(IDS.timezoneInvalid)]: '设置里的时区读不出来。'
  }),
  'en-US': Object.freeze({
    [TITLE(IDS.briefingFailed)]: 'The daily briefing did not generate',
    [OPEN_BRIEFING_ACTION_KEY]: 'Open briefing',
    [ACKNOWLEDGE_ACTION_KEY]: 'Got it',
    [notificationEventVariantKey(IDS.briefingFailed, 'not-generated')]: 'The {date} {time} {language} edition failed to generate.',
    [notificationEventVariantKey(IDS.briefingFailed, 'editorial-missing')]: 'The {date} {time} {language} edition has its data ready but no interpretation.',
    [REASON(IDS.briefingFailed)]: 'This edition finished its run and still failed.',

    [TITLE(IDS.signalTriggered)]: en.signal.title,
    [notificationEventHeadlineKey(IDS.signalTriggered, 'etfOutflow')]: en.signal.headline.etfOutflow,
    [notificationEventHeadlineKey(IDS.signalTriggered, 'oiDrop')]: en.signal.headline.oiDrop,
    [notificationEventHeadlineKey(IDS.signalTriggered, 'etfOutflowAggravated')]: en.signal.headline.etfOutflowAggravated,
    [notificationEventHeadlineKey(IDS.signalTriggered, 'oiDropAggravated')]: en.signal.headline.oiDropAggravated,
    [notificationEventHeadlineKey(IDS.signalTriggered, 'oiLong')]: en.signal.headline.oiLong,
    [notificationEventHeadlineKey(IDS.signalTriggered, 'oiLongAggravated')]: en.signal.headline.oiLongAggravated,
    [notificationEventHeadlineKey(IDS.signalTriggered, 'oiShort')]: en.signal.headline.oiShort,
    [notificationEventHeadlineKey(IDS.signalTriggered, 'oiShortAggravated')]: en.signal.headline.oiShortAggravated,
    [notificationEventVariantKey(IDS.signalTriggered, 'etfOutflow')]: en.signal.body.etfOutflow,
    [notificationEventVariantKey(IDS.signalTriggered, 'etfOutflowAggravated')]: en.signal.body.etfOutflowAggravated,
    [notificationEventVariantKey(IDS.signalTriggered, 'oiDrop')]: en.signal.body.oiDrop,
    [notificationEventVariantKey(IDS.signalTriggered, 'oiDropAggravated')]: en.signal.body.oiDropAggravated,
    [notificationEventVariantKey(IDS.signalTriggered, 'oiLong')]: en.signal.body.oiLong,
    [notificationEventVariantKey(IDS.signalTriggered, 'oiLongAggravated')]: en.signal.body.oiLongAggravated,
    [notificationEventVariantKey(IDS.signalTriggered, 'oiShort')]: en.signal.body.oiShort,
    [notificationEventVariantKey(IDS.signalTriggered, 'oiShortAggravated')]: en.signal.body.oiShortAggravated,
    [REASON(IDS.signalTriggered)]: en.signal.reason,

    [TITLE(IDS.calendarEventUpcoming)]: 'A calendar event starts soon',
    [BODY(IDS.calendarEventUpcoming)]: 'A reminder at the lead time you set: a calendar event is about to start.',
    [REASON(IDS.calendarEventUpcoming)]: 'You turned on the reminder before calendar events start.',

    [TITLE(IDS.calendarRefreshFailed)]: 'Calendar refresh failed',
    [notificationEventVariantKey(IDS.calendarRefreshFailed, 'input-invalid')]: '{source} did not refresh this time: the request was rejected as invalid. The events you already have are still there.',
    [notificationEventVariantKey(IDS.calendarRefreshFailed, 'credential-not-configured')]: '{source} did not refresh this time: no credential is configured. The events you already have are still there.',
    [notificationEventVariantKey(IDS.calendarRefreshFailed, 'response-unavailable')]: '{source} did not refresh this time: the source did not respond. The events you already have are still there.',
    [notificationEventVariantKey(IDS.calendarRefreshFailed, 'archive-unavailable')]: '{source} did not refresh this time: the evidence archive is unavailable. The events you already have are still there.',
    [notificationEventVariantKey(IDS.calendarRefreshFailed, 'parse-unavailable')]: '{source} did not refresh this time: the response could not be parsed. The events you already have are still there.',
    [notificationEventVariantKey(IDS.calendarRefreshFailed, 'storage-unavailable')]: '{source} did not refresh this time: local storage is unavailable. The events you already have are still there.',
    [notificationEventVariantKey(IDS.calendarRefreshFailed, 'storage-pressure')]: '{source} did not refresh this time: local storage is short of space. The events you already have are still there.',
    [notificationEventVariantKey(IDS.calendarRefreshFailed, 'no-code')]: '{source} did not refresh this time. The events you already have are still there.',
    [REASON(IDS.calendarRefreshFailed)]: 'A market-calendar refresh did not finish.',

    [TITLE(IDS.sentimentAlert)]: en.alert.title,
    [notificationEventVariantKey(IDS.sentimentAlert, 'withSource')]: en.alert.bodyWithSource,
    [REASON(IDS.sentimentAlert)]: en.alert.reason,
    [notificationEventNamedKey(IDS.sentimentAlert, 'strength.high')]: en.alert.strength.high,
    [notificationEventNamedKey(IDS.sentimentAlert, 'strength.medium')]: en.alert.strength.medium,
    [notificationEventNamedKey(IDS.sentimentAlert, 'strength.low')]: en.alert.strength.low,
    [TITLE(IDS.macroEventLanded)]: en.macro.title,
    [notificationEventNamedKey(IDS.macroEventLanded, 'direction.above')]: en.macro.direction.above,
    [notificationEventNamedKey(IDS.macroEventLanded, 'direction.below')]: en.macro.direction.below,
    [notificationEventNamedKey(IDS.macroEventLanded, 'direction.matched')]: en.macro.direction.matched,
    // 指标名一张表：已注册按标识、自由文本按源站标题；表外就用原文（通知里拼的是字面量）。
    ...Object.fromEntries(
      Object.entries(indicatorNames).map(([id, name]) => [
        notificationEventNamedKey(IDS.macroEventLanded, `indicator.${id}`),
        name.en
      ])
    ),

    [notificationEventNamedKey(IDS.macroEventLanded, 'country.US')]: en.macro.country.US,
    [notificationEventVariantKey(IDS.macroEventLanded, 'values')]: en.macro.body.values,
    [notificationEventVariantKey(IDS.macroEventLanded, 'noPrevious')]: en.macro.body.noPrevious,
    [notificationEventVariantKey(IDS.macroEventLanded, 'noForecast')]: en.macro.body.noForecast,
    [notificationEventVariantKey(IDS.macroEventLanded, 'matched')]: en.macro.body.matched,
    [notificationEventNamedKey(IDS.macroEventLanded, 'periodicity.yoy')]: en.macro.periodicity.yoy,
    [notificationEventNamedKey(IDS.macroEventLanded, 'periodicity.mom')]: en.macro.periodicity.mom,
    [REASON(IDS.macroEventLanded)]: en.macro.reason,

    [TITLE(IDS.sourceConsecutiveFailed)]: '{sourceName} failed {failures} times in a row',
    [BODY(IDS.sourceConsecutiveFailed)]: 'This source keeps returning nothing. Check its key or proxy in settings.',
    [REASON(IDS.sourceConsecutiveFailed)]: 'The same source failed three times in a row, so it is mentioned once.',

    [TITLE(IDS.sourceStale)]: '{sourceName} has had no new items',
    [BODY(IDS.sourceStale)]: 'This source brought no new items for longer than its silence window. Check its switch and connection in settings.',
    [REASON(IDS.sourceStale)]: 'The last new item arrived before this window; collections since then brought nothing new.',

    [TITLE(IDS.briefingReady)]: 'Daily brief is ready',
    [BODY(IDS.briefingReady)]: 'The {date} {time} {language} edition is ready.',
    [REASON(IDS.briefingReady)]: 'You subscribed to briefing-ready notices.',

    [TITLE(IDS.analysisConclusion)]: 'Analysis conclusion',
    [BODY(IDS.analysisConclusion)]: 'The conclusion from this analysis is ready.',
    [REASON(IDS.analysisConclusion)]: 'You subscribed to signal-triggered analysis conclusions.',
    // Line names used inside the analysis-quota sentence: they belong to this product's analysis lines,
    // so the platform copy table no longer carries them (v2.59).
    'notification.analysis-line.market-intelligence.event': 'market-move analysis',
    'notification.analysis-line.market-intelligence.calendar': 'calendar-event analysis',

    [TITLE(IDS.timezoneInvalid)]: 'Invalid time zone, automatic generation paused',
    [BODY(IDS.timezoneInvalid)]: 'Set a valid time zone in settings and the briefing will generate automatically again.',
    [REASON(IDS.timezoneInvalid)]: 'The configured time zone cannot be read.'
  })
})
