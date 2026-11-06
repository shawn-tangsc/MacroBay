import type { NotificationCopyTableSet } from '@platform/notifications/contracts/notificationCopyPort'

import { registeredEventNames } from '../../../../contracts/registeredEventNames'
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
const BODY = notificationEventBodyKey
const REASON = notificationEventReasonKey

export const marketIntelligenceNotificationCopy: MarketIntelligenceNotificationCopy = Object.freeze({
  'zh-CN': Object.freeze({
    [TITLE(IDS.briefingFailed)]: '日报没生成出来',
    [notificationEventVariantKey(IDS.briefingFailed, 'not-generated')]: '{date} {time} {language}这一期没有生成出来，点开可以重试。',
    [notificationEventVariantKey(IDS.briefingFailed, 'editorial-missing')]: '{date} {time} {language}这一期数据齐了但解读没出来，点开可以重试。',
    [REASON(IDS.briefingFailed)]: '这一期跑完了仍然失败。',

    // 标题必须以资产名开头（情报 v3.26 §十一）：读者可能同时在盯几个资产。
    [TITLE(IDS.signalTriggered)]: '{asset} {headline}',
    [notificationEventHeadlineKey(IDS.signalTriggered, 'etfOutflow')]: 'ETF 连续净流出',
    [notificationEventHeadlineKey(IDS.signalTriggered, 'oiDrop')]: '持仓骤降',
    [notificationEventHeadlineKey(IDS.signalTriggered, 'etfOutflowAggravated')]: 'ETF 净流出加剧',
    [notificationEventHeadlineKey(IDS.signalTriggered, 'oiDropAggravated')]: '持仓骤降加剧',
    // 正文四个变体：规则 × 档位。数字一律数值参数，模板里不写任何阈值。
    [notificationEventVariantKey(IDS.signalTriggered, 'etfOutflow')]: '净流出 {amount}，超过 {threshold} 的阈值',
    [notificationEventVariantKey(IDS.signalTriggered, 'etfOutflowAggravated')]: '净流出 {amount}，是阈值的 {multiple}',
    [notificationEventVariantKey(IDS.signalTriggered, 'oiDrop')]: '15 分钟跌 {dropPct}（阈值 {thresholdPct}），成交放大 {multiple}，规模约 {notional}',
    [notificationEventVariantKey(IDS.signalTriggered, 'oiDropAggravated')]: '15 分钟跌 {dropPct}（强阈值 {strongPct}），成交放大 {multiple}，规模约 {notional}',
    [REASON(IDS.signalTriggered)]: '规则命中，且读数达到这条规则的阈值。',

    [TITLE(IDS.macroEventLanded)]: '{country} {indicator} {direction}',
    [notificationEventNamedKey(IDS.macroEventLanded, 'direction.above')]: '高于预期',
    [notificationEventNamedKey(IDS.macroEventLanded, 'direction.below')]: '低于预期',
    [notificationEventNamedKey(IDS.macroEventLanded, 'country.US')]: '美国',
    [notificationEventNamedKey(IDS.macroEventLanded, 'indicator.cpi')]: registeredEventNames['zh-CN']['cpi'],
    [notificationEventNamedKey(IDS.macroEventLanded, 'indicator.core-cpi')]: registeredEventNames['zh-CN']['core-cpi'],
    [notificationEventNamedKey(IDS.macroEventLanded, 'indicator.nonfarm-payrolls')]: registeredEventNames['zh-CN']['nonfarm-payrolls'],
    [notificationEventNamedKey(IDS.macroEventLanded, 'indicator.unemployment')]: registeredEventNames['zh-CN']['unemployment'],
    [notificationEventNamedKey(IDS.macroEventLanded, 'indicator.average-hourly-earnings')]: registeredEventNames['zh-CN']['average-hourly-earnings'],
    [notificationEventNamedKey(IDS.macroEventLanded, 'indicator.pce')]: registeredEventNames['zh-CN']['pce'],
    [notificationEventNamedKey(IDS.macroEventLanded, 'indicator.core-pce')]: registeredEventNames['zh-CN']['core-pce'],
    [notificationEventNamedKey(IDS.macroEventLanded, 'indicator.gdp')]: registeredEventNames['zh-CN']['gdp'],
    [notificationEventNamedKey(IDS.macroEventLanded, 'indicator.fomc')]: registeredEventNames['zh-CN']['fomc'],
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
    [BODY(IDS.briefingReady)]: '{date} {time} {language}这一期已经生成，点开可以看全文。',
    [REASON(IDS.briefingReady)]: '你订阅了日报完成提醒。',

    [TITLE(IDS.timezoneInvalid)]: '时区无效，自动生成已暂停',
    [BODY(IDS.timezoneInvalid)]: '去设置里改成有效的时区，日报会恢复自动生成。',
    [REASON(IDS.timezoneInvalid)]: '设置里的时区读不出来。'
  }),
  'en-US': Object.freeze({
    [TITLE(IDS.briefingFailed)]: 'The daily briefing did not generate',
    [notificationEventVariantKey(IDS.briefingFailed, 'not-generated')]: 'The {date} {time} {language} edition failed to generate. Open it to retry.',
    [notificationEventVariantKey(IDS.briefingFailed, 'editorial-missing')]: 'The {date} {time} {language} edition has its data ready but no interpretation. Open it to retry.',
    [REASON(IDS.briefingFailed)]: 'This edition finished its run and still failed.',

    [TITLE(IDS.signalTriggered)]: '{asset} {headline}',
    [notificationEventHeadlineKey(IDS.signalTriggered, 'etfOutflow')]: 'ETF outflows',
    [notificationEventHeadlineKey(IDS.signalTriggered, 'oiDrop')]: 'open interest dropped',
    [notificationEventHeadlineKey(IDS.signalTriggered, 'etfOutflowAggravated')]: 'ETF outflows deepened',
    [notificationEventHeadlineKey(IDS.signalTriggered, 'oiDropAggravated')]: 'open interest fell further',
    [notificationEventVariantKey(IDS.signalTriggered, 'etfOutflow')]: '{amount} net outflow, past the {threshold} threshold',
    [notificationEventVariantKey(IDS.signalTriggered, 'etfOutflowAggravated')]: '{amount} net outflow, {multiple} the threshold',
    [notificationEventVariantKey(IDS.signalTriggered, 'oiDrop')]: 'Down {dropPct} in 15 min (threshold {thresholdPct}), volume {multiple}, about {notional}',
    [notificationEventVariantKey(IDS.signalTriggered, 'oiDropAggravated')]: 'Down {dropPct} in 15 min (strong threshold {strongPct}), volume {multiple}, about {notional}',
    [REASON(IDS.signalTriggered)]: 'A rule matched and the reading reached its threshold.',

    [TITLE(IDS.macroEventLanded)]: '{country} {indicator} {direction}',
    [notificationEventNamedKey(IDS.macroEventLanded, 'direction.above')]: 'above forecast',
    [notificationEventNamedKey(IDS.macroEventLanded, 'direction.below')]: 'below forecast',
    [notificationEventNamedKey(IDS.macroEventLanded, 'country.US')]: 'US',
    [notificationEventNamedKey(IDS.macroEventLanded, 'indicator.cpi')]: registeredEventNames['en-US']['cpi'],
    [notificationEventNamedKey(IDS.macroEventLanded, 'indicator.core-cpi')]: registeredEventNames['en-US']['core-cpi'],
    [notificationEventNamedKey(IDS.macroEventLanded, 'indicator.nonfarm-payrolls')]: registeredEventNames['en-US']['nonfarm-payrolls'],
    [notificationEventNamedKey(IDS.macroEventLanded, 'indicator.unemployment')]: registeredEventNames['en-US']['unemployment'],
    [notificationEventNamedKey(IDS.macroEventLanded, 'indicator.average-hourly-earnings')]: registeredEventNames['en-US']['average-hourly-earnings'],
    [notificationEventNamedKey(IDS.macroEventLanded, 'indicator.pce')]: registeredEventNames['en-US']['pce'],
    [notificationEventNamedKey(IDS.macroEventLanded, 'indicator.core-pce')]: registeredEventNames['en-US']['core-pce'],
    [notificationEventNamedKey(IDS.macroEventLanded, 'indicator.gdp')]: registeredEventNames['en-US']['gdp'],
    [notificationEventNamedKey(IDS.macroEventLanded, 'indicator.fomc')]: registeredEventNames['en-US']['fomc'],
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
    [BODY(IDS.briefingReady)]: 'The {date} {time} {language} edition is ready; open it for the full text.',
    [REASON(IDS.briefingReady)]: 'You subscribed to briefing-ready notices.',

    [TITLE(IDS.timezoneInvalid)]: 'Invalid time zone, automatic generation paused',
    [BODY(IDS.timezoneInvalid)]: 'Set a valid time zone in settings and the briefing will generate automatically again.',
    [REASON(IDS.timezoneInvalid)]: 'The configured time zone cannot be read.'
  })
})
