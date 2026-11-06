import type { NotificationContentByLanguage } from '@platform/notifications/contracts/notificationContracts'

import {
  MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS as IDS,
  notificationEventBodyKey,
  notificationEventReasonKey,
  notificationEventTitleKey,
  notificationEventVariantKey
} from '../../../contracts/notificationEventKeys'
import { marketIntelligenceNotificationCopy } from '../../../desktop/shared/i18n/text/notifications'
import type { DailyBriefingLocale } from '../../../contracts/dailyBriefing'

/**
 * 日报三条通知的**成品句子**（契约 v2.56）：源头把骨架填成话，平台只挑一份发。
 *
 * 骨架不在这里另写一份——句子仍取自产品文案表（`text/notifications.ts`），旧记录的读取路径也用它；
 * 这个文件只负责「取骨架 + 填事实」，所以改措辞仍然只有一处。
 *
 * 平台手里不再有「缺哪一格」这回事：填不出来的值按空串处理（句子照样通顺），而**缺整份语言**才是
 * 源头没拼完，由提交回执 `copy-missing` 拒收。
 */

const copy = marketIntelligenceNotificationCopy

function fill(template: string | undefined, values: Readonly<Record<string, string>>): string {
  if (template === undefined) return ''
  return template.replace(/\{(\w+)\}/gu, (match, name: string) => values[name] ?? match)
}

function sentence(language: DailyBriefingLocale, key: string, values: Readonly<Record<string, string>> = {}): string {
  const table = copy[language] as Readonly<Record<string, string | undefined>>
  return fill(table[key], values)
}

/** 读者看到的「哪一期」三件：日期、时刻、这一期的语言词。 */
export type EditionMoment = Readonly<{ date: string; time: string; locale: DailyBriefingLocale }>

function momentValues(moment: EditionMoment): Readonly<Record<string, string>> {
  return {
    date: monthDay(moment.date),
    time: moment.time,
    language: moment.locale === 'en-US' ? 'English' : '中文'
  }
}

/** 版次日期写成读者一眼能认的形状（`11/06`）：ISO 串在通知里太长，也太像机器。 */
export function monthDay(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date)
  return match === null ? date : `${match[2]}/${match[3]}`
}

/**
 * 完成类：**只交那一期自己的语言**（契约 v2.56 的例外；平台按 `edition.locale` 挑那一份）。
 *
 * 正文 = 事实句 + 空行 + 导读。导读为空（或只有空白）就**整段不拼**——没有「暂无导读」这种占位。
 */
export function readyCopy(input: EditionMoment & Readonly<{ lede?: string }>): NotificationContentByLanguage {
  const values = momentValues(input)
  const lede = input.lede?.trim() ?? ''
  const body = lede === ''
    ? sentence(input.locale, notificationEventBodyKey(IDS.briefingReady), values)
    : `${sentence(input.locale, notificationEventBodyKey(IDS.briefingReady), values)}\n\n${lede}`
  const entry = {
    title: sentence(input.locale, notificationEventTitleKey(IDS.briefingReady)),
    body,
    reason: sentence(input.locale, notificationEventReasonKey(IDS.briefingReady))
  }
  return Object.freeze(input.locale === 'en-US' ? { 'en-US': entry } : { 'zh-CN': entry })
}

/** 失败类两种变体：不带 edition 的事件，两份语言都要齐（中心按读者语言挑，与今天一致）。 */
export function failureCopy(input: EditionMoment & Readonly<{ variant: 'not-generated' | 'editorial-missing' }>): NotificationContentByLanguage {
  const values = momentValues(input)
  const build = (language: DailyBriefingLocale) => ({
    title: sentence(language, notificationEventTitleKey(IDS.briefingFailed)),
    body: sentence(language, notificationEventVariantKey(IDS.briefingFailed, input.variant), values),
    reason: sentence(language, notificationEventReasonKey(IDS.briefingFailed))
  })
  return Object.freeze({ 'zh-CN': build('zh-CN'), 'en-US': build('en-US') })
}

/** 时区无效：同样两份都齐（它没有期次）。 */
export function timezoneCopy(): NotificationContentByLanguage {
  const build = (language: DailyBriefingLocale) => ({
    title: sentence(language, notificationEventTitleKey(IDS.timezoneInvalid)),
    body: sentence(language, notificationEventBodyKey(IDS.timezoneInvalid)),
    reason: sentence(language, notificationEventReasonKey(IDS.timezoneInvalid))
  })
  return Object.freeze({ 'zh-CN': build('zh-CN'), 'en-US': build('en-US') })
}
