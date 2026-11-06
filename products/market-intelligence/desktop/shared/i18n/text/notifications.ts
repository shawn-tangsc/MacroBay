import type { NotificationCopyTableSet } from '@platform/notifications/contracts/notificationCopyPort'

import { indicatorNames } from '../../../../contracts/indicatorNames'
import { signalNotificationSentences } from '../../../../contracts/signalNotificationSentences'
import {
  MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS as IDS,
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
const zh = { signal: signalNotificationSentences['zh-CN'] }
const en = { signal: signalNotificationSentences['en-US'] }
const BODY = notificationEventBodyKey
const REASON = notificationEventReasonKey

export const marketIntelligenceNotificationCopy: MarketIntelligenceNotificationCopy = Object.freeze({
  'zh-CN': Object.freeze({
    [TITLE(IDS.briefingFailed)]: '日报没生成出来',
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
    [notificationEventVariantKey(IDS.signalTriggered, 'etfOutflow')]: zh.signal.body.etfOutflow,
    [notificationEventVariantKey(IDS.signalTriggered, 'etfOutflowAggravated')]: zh.signal.body.etfOutflowAggravated,
    [notificationEventVariantKey(IDS.signalTriggered, 'oiDrop')]: zh.signal.body.oiDrop,
    [notificationEventVariantKey(IDS.signalTriggered, 'oiDropAggravated')]: zh.signal.body.oiDropAggravated,
    [REASON(IDS.signalTriggered)]: zh.signal.reason,

    [TITLE(IDS.macroEventLanded)]: '{country} {indicator} {direction}',
    [notificationEventNamedKey(IDS.macroEventLanded, 'direction.above')]: '高于预期',
    [notificationEventNamedKey(IDS.macroEventLanded, 'direction.below')]: '低于预期',
    // 指标名一张表：已注册按标识、自由文本按源站标题；表外就用原文（通知里拼的是字面量）。
    ...Object.fromEntries(
      Object.entries(indicatorNames).map(([id, name]) => [
        notificationEventNamedKey(IDS.macroEventLanded, `indicator.${id}`),
        name.zh
      ])
    ),

    [notificationEventNamedKey(IDS.macroEventLanded, 'country.US')]: '美国',
    [notificationEventVariantKey(IDS.macroEventLanded, 'values')]: '实际 {actual}，预期 {consensus}，前值 {previous}{periodLabel}',
    [notificationEventVariantKey(IDS.macroEventLanded, 'noPrevious')]: '实际 {actual}，预期 {consensus}，前值没有公布{periodLabel}',
    [notificationEventVariantKey(IDS.macroEventLanded, 'noForecast')]: '实际 {actual}，这次没有预期值可比{periodLabel}',
    [notificationEventNamedKey(IDS.macroEventLanded, 'periodicity.yoy')]: '（同比）',
    [notificationEventNamedKey(IDS.macroEventLanded, 'periodicity.mom')]: '（环比）',
    [REASON(IDS.macroEventLanded)]: '读数达到这条规则的意外阈值。',

    [TITLE(IDS.sourceConsecutiveFailed)]: '{sourceName} 连续失败 {failures} 次',
    [BODY(IDS.sourceConsecutiveFailed)]: '这个来源一直取不到数据，去设置检查密钥或代理。',
    [REASON(IDS.sourceConsecutiveFailed)]: '同一个来源连续三次失败，提醒一次。',

    [TITLE(IDS.sourceStale)]: '{sourceName} 很久没有新数据',
    [BODY(IDS.sourceStale)]: '超过这个来源的新鲜度窗口仍没有新数据，去设置检查。',
    [REASON(IDS.sourceStale)]: '最后一次成功采集在窗口之前。',

    [TITLE(IDS.briefingReady)]: '日报已完成',
    [BODY(IDS.briefingReady)]: '{date} {time} {language}这一期已经生成。',
    [REASON(IDS.briefingReady)]: '你订阅了日报完成提醒。',

    [TITLE(IDS.timezoneInvalid)]: '时区无效，自动生成已暂停',
    [BODY(IDS.timezoneInvalid)]: '去设置里改成有效的时区，日报会恢复自动生成。',
    [REASON(IDS.timezoneInvalid)]: '设置里的时区读不出来。'
  }),
  'en-US': Object.freeze({
    [TITLE(IDS.briefingFailed)]: 'The daily briefing did not generate',
    [notificationEventVariantKey(IDS.briefingFailed, 'not-generated')]: 'The {date} {time} {language} edition failed to generate.',
    [notificationEventVariantKey(IDS.briefingFailed, 'editorial-missing')]: 'The {date} {time} {language} edition has its data ready but no interpretation.',
    [REASON(IDS.briefingFailed)]: 'This edition finished its run and still failed.',

    [TITLE(IDS.signalTriggered)]: en.signal.title,
    [notificationEventHeadlineKey(IDS.signalTriggered, 'etfOutflow')]: en.signal.headline.etfOutflow,
    [notificationEventHeadlineKey(IDS.signalTriggered, 'oiDrop')]: en.signal.headline.oiDrop,
    [notificationEventHeadlineKey(IDS.signalTriggered, 'etfOutflowAggravated')]: en.signal.headline.etfOutflowAggravated,
    [notificationEventHeadlineKey(IDS.signalTriggered, 'oiDropAggravated')]: en.signal.headline.oiDropAggravated,
    [notificationEventVariantKey(IDS.signalTriggered, 'etfOutflow')]: en.signal.body.etfOutflow,
    [notificationEventVariantKey(IDS.signalTriggered, 'etfOutflowAggravated')]: en.signal.body.etfOutflowAggravated,
    [notificationEventVariantKey(IDS.signalTriggered, 'oiDrop')]: en.signal.body.oiDrop,
    [notificationEventVariantKey(IDS.signalTriggered, 'oiDropAggravated')]: en.signal.body.oiDropAggravated,
    [REASON(IDS.signalTriggered)]: en.signal.reason,

    [TITLE(IDS.macroEventLanded)]: '{country} {indicator} {direction}',
    [notificationEventNamedKey(IDS.macroEventLanded, 'direction.above')]: 'above forecast',
    [notificationEventNamedKey(IDS.macroEventLanded, 'direction.below')]: 'below forecast',
    // 指标名一张表：已注册按标识、自由文本按源站标题；表外就用原文（通知里拼的是字面量）。
    ...Object.fromEntries(
      Object.entries(indicatorNames).map(([id, name]) => [
        notificationEventNamedKey(IDS.macroEventLanded, `indicator.${id}`),
        name.en
      ])
    ),

    [notificationEventNamedKey(IDS.macroEventLanded, 'country.US')]: 'US',
    [notificationEventVariantKey(IDS.macroEventLanded, 'values')]: 'Actual {actual} vs {consensus} forecast; previous {previous}{periodLabel}',
    [notificationEventVariantKey(IDS.macroEventLanded, 'noPrevious')]: 'Actual {actual} vs {consensus} forecast; no previous release{periodLabel}',
    [notificationEventVariantKey(IDS.macroEventLanded, 'noForecast')]: 'Actual {actual}; no forecast to compare{periodLabel}',
    [notificationEventNamedKey(IDS.macroEventLanded, 'periodicity.yoy')]: ' (YoY)',
    [notificationEventNamedKey(IDS.macroEventLanded, 'periodicity.mom')]: ' (MoM)',
    [REASON(IDS.macroEventLanded)]: 'The reading crossed this rule’s surprise threshold.',

    [TITLE(IDS.sourceConsecutiveFailed)]: '{sourceName} failed {failures} times in a row',
    [BODY(IDS.sourceConsecutiveFailed)]: 'This source keeps returning nothing. Check its key or proxy in settings.',
    [REASON(IDS.sourceConsecutiveFailed)]: 'The same source failed three times in a row, so it is mentioned once.',

    [TITLE(IDS.sourceStale)]: '{sourceName} has no new data',
    [BODY(IDS.sourceStale)]: 'No new data for longer than this source’s freshness window. Check it in settings.',
    [REASON(IDS.sourceStale)]: 'The last successful collection was before the window.',

    [TITLE(IDS.briefingReady)]: 'Daily brief is ready',
    [BODY(IDS.briefingReady)]: 'The {date} {time} {language} edition is ready.',
    [REASON(IDS.briefingReady)]: 'You subscribed to briefing-ready notices.',

    [TITLE(IDS.timezoneInvalid)]: 'Invalid time zone, automatic generation paused',
    [BODY(IDS.timezoneInvalid)]: 'Set a valid time zone in settings and the briefing will generate automatically again.',
    [REASON(IDS.timezoneInvalid)]: 'The configured time zone cannot be read.'
  })
})
