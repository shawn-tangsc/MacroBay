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
  const byOrder = (left: Readonly<{ periodId: string; locale: string }>, right: Readonly<{ periodId: string; locale: string }>) =>
    left.periodId !== right.periodId
      ? (left.periodId < right.periodId ? -1 : 1)
      : (left.locale < right.locale ? -1 : left.locale > right.locale ? 1 : 0)
  // 列表可能把刚删掉的那一行仍旧列出来（`state: 'missing'`，或列表还没刷新），它没有版次可读，
  // 不能当自己的邻居；`state === 'missing'` 的整行也不参与。
  const sameDay = rows.filter((row) => row.date === deletedDate && row.state !== 'missing').sort(byOrder)
  const isDeleted = (row: Readonly<{ periodId: string; locale: string }>): boolean =>
    deleted !== undefined && row.periodId === deleted.periodId && row.locale === deleted.locale
  // 先在**被删行原来的位置**上找下一个（没有就上一个）。不能在"排除掉被删行之后"的列表里从头数——
  // 那样删掉第二期会又选回第一期。
  const index = deleted === undefined ? -1 : sameDay.findIndex(isDeleted)
  if (index >= 0) {
    for (let after = index + 1; after < sameDay.length; after += 1) {
      const candidate = sameDay[after]!
      if (!isDeleted(candidate)) return { date: candidate.date, periodId: candidate.periodId, locale: candidate.locale }
    }
    for (let before = index - 1; before >= 0; before -= 1) {
      const candidate = sameDay[before]!
      if (!isDeleted(candidate)) return { date: candidate.date, periodId: candidate.periodId, locale: candidate.locale }
    }
    return undefined
  }
  const first = sameDay.find((row) => !isDeleted(row))
  return first === undefined ? undefined : { date: first.date, periodId: first.periodId, locale: first.locale }
}
