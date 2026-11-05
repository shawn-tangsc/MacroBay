import { briefingCompleteness, briefingEditionPeriod, type DailyBriefingDocument, type DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
import { productText } from '../../shared/i18n/productText'
import { buildEditionCompletenessNote } from './dailyBriefingCompletenessNote'
import type { DailyBriefingText } from './dailyBriefingText'

/**
 * The exported image's inputs, kept out of the page.
 *
 * The image follows the edition it shows, not the interface: an English window may export a
 * Chinese edition, so its labels — and the completeness sentence — come from that edition's own
 * language. This is the only place that decides it; the poster component renders what it is given.
 */
export function posterProps(input: Readonly<{
  document: DailyBriefingDocument | undefined
  editions: readonly DailyBriefingEditionSummary[]
  fallbackText: DailyBriefingText
}>): Readonly<{ text: DailyBriefingText; locale: DailyBriefingDocument['edition']['locale']; completenessNote?: string }> {
  const document = input.document
  if (!document) return Object.freeze({ text: input.fallbackText, locale: 'zh-CN' })
  const locale = document.edition.locale
  const text = productText[locale].pages.intelligence.portal.dashboard.dailyBriefing
  // 期号也参与匹配（`02` `A0.12` 之后一天可以多期）：只按日期找，会把同一天另一期/另一种语言的
  // 行当成这一版的完整性依据，导出的说明句就指错版了。
  const periodId = briefingEditionPeriod(document.edition).periodId
  const summary = input.editions.find((edition) =>
    edition.date === document.edition.date && edition.periodId === periodId && edition.locale === locale)
  const completenessNote = buildEditionCompletenessNote(
    briefingCompleteness({
      ...(summary?.expectedLocales ? { expectedLocales: summary.expectedLocales } : {}),
      publishedLocales: summary?.availableLocales ?? [locale],
      readingsAvailable: document.status.readingsAvailable,
      readingsTotal: 4
    }),
    text
  )
  return Object.freeze({ text, locale, ...(completenessNote ? { completenessNote } : {}) })
}
