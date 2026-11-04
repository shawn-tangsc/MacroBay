import type { NotificationCopyTableSet } from '@platform/notifications/contracts/notificationCopyPort'

import {
  MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS as IDS,
  notificationEventBodyKey,
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
    [notificationEventVariantKey(IDS.briefingFailed, 'not-generated')]: '这一期没有生成出来，点开可以重试。',
    [notificationEventVariantKey(IDS.briefingFailed, 'editorial-missing')]: '数据已经齐了，但解读没出来，点开可以重试。',
    [REASON(IDS.briefingFailed)]: '这一期跑完了仍然失败。',

    [TITLE(IDS.signalTriggered)]: '模块信号触发',
    [BODY(IDS.signalTriggered)]: '有一条新信号，点开看该模块的读数。',
    [REASON(IDS.signalTriggered)]: '规则命中，且达到你设的严重度门槛。',

    [TITLE(IDS.macroEventLanded)]: '宏观事件已发布',
    [BODY(IDS.macroEventLanded)]: '有一条宏观数据或事件落地，点开看日历详情。',
    [REASON(IDS.macroEventLanded)]: '事件到了实际发布时刻。',

    [TITLE(IDS.sourceConsecutiveFailed)]: '{sourceName} 连续失败 {failures} 次',
    [BODY(IDS.sourceConsecutiveFailed)]: '这个来源一直取不到数据，去设置检查密钥或代理。',
    [REASON(IDS.sourceConsecutiveFailed)]: '同一个来源连续三次失败，提醒一次。',

    [TITLE(IDS.sourceStale)]: '{sourceName} 很久没有新数据',
    [BODY(IDS.sourceStale)]: '超过这个来源的新鲜度窗口仍没有新数据，去设置检查。',
    [REASON(IDS.sourceStale)]: '最后一次成功采集在窗口之前。',

    [TITLE(IDS.briefingReady)]: '日报已完成',
    [BODY(IDS.briefingReady)]: '今天这一期已经生成，点开可以看全文。',
    [REASON(IDS.briefingReady)]: '你订阅了日报完成提醒。',

    [TITLE(IDS.calibrationResult)]: '预测校准出结果了',
    [BODY(IDS.calibrationResult)]: '校准视图已经更新。',
    [REASON(IDS.calibrationResult)]: '你订阅了校准结果。',

    [TITLE(IDS.timezoneInvalid)]: '时区无效，自动生成已暂停',
    [BODY(IDS.timezoneInvalid)]: '去设置里改成有效的时区，日报会恢复自动生成。',
    [REASON(IDS.timezoneInvalid)]: '设置里的时区读不出来。'
  }),
  'en-US': Object.freeze({
    [TITLE(IDS.briefingFailed)]: 'The daily briefing did not generate',
    [notificationEventVariantKey(IDS.briefingFailed, 'not-generated')]: 'This edition failed to generate. Open it to retry.',
    [notificationEventVariantKey(IDS.briefingFailed, 'editorial-missing')]: 'The data is ready, but the interpretation is missing. Open it to retry.',
    [REASON(IDS.briefingFailed)]: 'This edition finished its run and still failed.',

    [TITLE(IDS.signalTriggered)]: 'Module signal triggered',
    [BODY(IDS.signalTriggered)]: 'A new signal fired. Open it to see the reading for that module.',
    [REASON(IDS.signalTriggered)]: 'A rule matched and cleared your severity threshold.',

    [TITLE(IDS.macroEventLanded)]: 'Macro event released',
    [BODY(IDS.macroEventLanded)]: 'A macro release or event landed. Open it for the calendar detail.',
    [REASON(IDS.macroEventLanded)]: 'The scheduled release time arrived.',

    [TITLE(IDS.sourceConsecutiveFailed)]: '{sourceName} failed {failures} times in a row',
    [BODY(IDS.sourceConsecutiveFailed)]: 'This source keeps returning nothing. Check its key or proxy in settings.',
    [REASON(IDS.sourceConsecutiveFailed)]: 'The same source failed three times in a row, so it is mentioned once.',

    [TITLE(IDS.sourceStale)]: '{sourceName} has no new data',
    [BODY(IDS.sourceStale)]: 'No new data for longer than this source’s freshness window. Check it in settings.',
    [REASON(IDS.sourceStale)]: 'The last successful collection was before the window.',

    [TITLE(IDS.briefingReady)]: 'Daily brief is ready',
    [BODY(IDS.briefingReady)]: 'Today’s edition has been generated; open it for the full text.',
    [REASON(IDS.briefingReady)]: 'You subscribed to briefing-ready notices.',

    [TITLE(IDS.calibrationResult)]: 'Prediction calibration finished',
    [BODY(IDS.calibrationResult)]: 'The calibration view has been updated.',
    [REASON(IDS.calibrationResult)]: 'You subscribed to calibration results.',

    [TITLE(IDS.timezoneInvalid)]: 'Invalid time zone, automatic generation paused',
    [BODY(IDS.timezoneInvalid)]: 'Set a valid time zone in settings and the briefing will generate automatically again.',
    [REASON(IDS.timezoneInvalid)]: 'The configured time zone cannot be read.'
  })
})
