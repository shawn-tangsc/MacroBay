import type { NotificationContentByLanguage } from '@platform/notifications/contracts/notificationContracts'

import { indicatorNames, indicatorNameOf, resolveIndicatorNameId } from '../../../contracts/indicatorNames'
import { macroEventNotificationSentences } from '../../../contracts/macroEventNotificationSentences'
import { composeBothLanguages, fillTemplate } from './notificationSentenceTemplate'
import type { SurprisePeriodicity } from './macroEventCopy'

/**
 * 源头拼宏观落地通知的成品句子（契约 v2.56，情报需求 §十二）。
 *
 * 三件事必须在这里定死，因为读者只看得到成品：
 * - **国家**：表里翻（`美国` / `US`），表外就用代码本身（`JP`）——**不许留空、不许退回源站 `countryName`**；
 * - **指标名**：一张表（`contracts/indicatorNames.ts`）一个入口；表外就用源站原文，**绝不因为查不到而整条降级**；
 * - **数值**：源串原样进句子，不重排、不补单位（`MarketCalendarValue` 只有 `displayValue`，精度与单位我们不知道）。
 *
 * 结构化读数的真源是日历数据，不是这条通知记录：将来详情页要数值请回源里取，别反解析句子。
 */

export type MacroEventSentenceInput = Readonly<{
  countryCode: string
  /** 已注册指标的稳定标识；0xRouter 那条路没有它，指标名用源站原文。 */
  eventNameKey?: string
  /** 源站标题原文（没有稳定标识时就是指标名本身）。 */
  title: string
  actual: string
  consensus: string
  previous?: string
  comparison: 'above' | 'below'
  periodicity?: SurprisePeriodicity
}>

/** 指标名一个入口：稳定标识优先、其次源站标题，都不中就用原文。 */
function indicatorText(
  input: MacroEventSentenceInput,
  language: 'zh-CN' | 'en-US'
): string {
  const id = resolveIndicatorNameId({
    ...(input.eventNameKey === undefined ? {} : { eventNameKey: input.eventNameKey }),
    title: input.title
  })
  if (id === undefined || indicatorNameOf(id) === undefined) return input.title.trim()
  const names = indicatorNames[id]
  return language === 'en-US' ? names.en : names.zh
}

export function renderMacroEventSentence(
  input: MacroEventSentenceInput
): NotificationContentByLanguage | undefined {
  if (input.title.trim() === '') return undefined
  if (input.actual.trim() === '' || input.consensus.trim() === '') return undefined
  return composeBothLanguages((language) => {
    const sheet = macroEventNotificationSentences[language]
    const country = sheet.country[input.countryCode] ?? input.countryCode
    const title = fillTemplate(sheet.title, {
      country,
      indicator: indicatorText(input, language),
      direction: sheet.direction[input.comparison]
    })
    if (title === undefined) return undefined
    // 缺前值是今天唯一会出现的缺值：换句子，不拼「—」，也不留空括号。
    const body = input.previous === undefined
      ? fillTemplate(sheet.body.noPrevious, {
          actual: input.actual,
          consensus: input.consensus,
          periodLabel: input.periodicity === undefined ? '' : sheet.periodicity[input.periodicity]
        })
      : fillTemplate(sheet.body.values, {
          actual: input.actual,
          consensus: input.consensus,
          previous: input.previous,
          periodLabel: input.periodicity === undefined ? '' : sheet.periodicity[input.periodicity]
        })
    if (body === undefined) return undefined
    return { title, body, reason: sheet.reason }
  })
}
