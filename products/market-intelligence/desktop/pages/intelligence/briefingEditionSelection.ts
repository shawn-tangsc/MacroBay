import type { DailyBriefingEditionSummary, DailyBriefingLocale } from '../../../contracts/dailyBriefing'

/**
 * The two ways an edition is chosen: by its day, and by the exact badge on its row.
 *
 * Kept beside the reader hook rather than inline in the page, so the page stays under its size
 * ceiling; the behaviour is one call each — a row click names the date, period and language of that
 * row (a day can hold several), and a badge does the same. `selectEdition` is the fallback for a host
 * that cannot hand over a row's identity; it deliberately takes the day's first issue.
 */
export function briefingEditionSelection(input: Readonly<{
  editions: readonly DailyBriefingEditionSummary[]
  effectiveLocale: () => DailyBriefingLocale
  openEdition: (date: string, locale: DailyBriefingLocale, row?: DailyBriefingEditionSummary, periodId?: string) => void
  setPickedLocale: (locale: DailyBriefingLocale) => void
  setPickedPeriodId: (periodId: string) => void
}>): Readonly<{
  selectEdition: (date: string) => void
  selectLocale: (next: Readonly<{ date: string; periodId: string; locale: DailyBriefingLocale }>) => void
}> {
  return {
    selectEdition(date) {
      const row = input.editions.find((edition) => edition.date === date)
      input.openEdition(date, input.effectiveLocale(), row, row?.periodId)
    },
    selectLocale(next) {
      input.setPickedLocale(next.locale)
      input.setPickedPeriodId(next.periodId)
      input.openEdition(next.date, next.locale, undefined, next.periodId)
    }
  }
}

/**
 * 删掉一版之后，下一版是哪一个——**身份三样一次定全**，不许按日期猜。
 *
 * 同一天里按期号稳定序取被删行的下一个（没有就取上一个）；**当天删空就返回 `undefined`**——
 * 列表停在读者原来那一天给空态，不跨天把读者送走。
 */
export function nextEditionAfterDelete(
  rows: readonly Readonly<{ date: string; periodId: string; locale: 'zh-CN' | 'en-US'; state?: string }>[],
  deletedDate: string,
  deleted?: Readonly<{ periodId: string; locale: 'zh-CN' | 'en-US' }>
): Readonly<{ date: string; periodId: string; locale: 'zh-CN' | 'en-US' }> | undefined {
  const byOrder = (left: { periodId: string }, right: { periodId: string }) => left.periodId < right.periodId ? -1 : left.periodId > right.periodId ? 1 : 0
  // 列表可能把刚删掉的那一行仍旧列出来（`state: 'missing'`，或列表还没刷新），它没有版次可读，
  // 不能当自己的邻居；`state === 'missing'` 的整行也不参与。
  const sameDay = rows
    .filter((row) => row.date === deletedDate && row.state !== 'missing')
    .filter((row) => deleted === undefined || row.periodId !== deleted.periodId || row.locale !== deleted.locale)
    .sort(byOrder)
  const index = deleted === undefined
    ? -1
    : sameDay.findIndex((row) => row.periodId === deleted.periodId && row.locale === deleted.locale)
  const neighbour = sameDay[index + 1] ?? sameDay[index - 1] ?? sameDay[0]
  if (neighbour !== undefined) return { date: neighbour.date, periodId: neighbour.periodId, locale: neighbour.locale }
  return undefined
}
