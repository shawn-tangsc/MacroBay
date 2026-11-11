import type { BriefingPeriod } from '../../../contracts/dailyBriefingPeriod'
import { DEFAULT_PERIOD_ID, type DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { briefingScheduledCutoff } from './dailyBriefingWindow'
import type { DailyBriefingStore } from './dailyBriefingService'

/**
 * 今天「到点时没能生成」的排期期（`02` v2.149 甲案，用户 2026-11-06 定）。
 *
 * 为什么要建这一行：按「后面那期已到点就不补」和「超过一小时不补」，今天 07:00 可能真的没有任何
 * 一版中文；不建行的话列表只剩英文一行，读者既看不出中文缺了，也看不出是没跑还是被跳过。
 *
 * 建行条件四条同时成立：**有配置的排期期** + **今天** + **已过计划时刻** + 零版次、零尝试、
 * 审计里没有成功删除。四种情况不建行：未到点（不预告失败）、历史日（否则 14 天全铺满）、
 * 手动期（没有配置就不存在"该有"）、读者成功删过（否则删完又冒一行，等于删不掉）。
 */
export async function missedScheduledPeriods(input: Readonly<{
  store: Pick<DailyBriefingStore, 'get'> & Pick<Partial<DailyBriefingStore>, 'listAttempts' | 'wasEditionDeleted'>
  periods: () => Promise<readonly BriefingPeriod[]>
  today: string
  now: string
  readerTimeZone: string
  fallbackLocale: DailyBriefingLocale
}>): Promise<readonly Readonly<{ date: string; periodId: string; locale: DailyBriefingLocale }>[]> {
  const periods = await input.periods().catch(() => [])
  const missed: Array<Readonly<{ date: string; periodId: string; locale: DailyBriefingLocale }>> = []
  for (const period of periods) {
    const id = period.id || DEFAULT_PERIOD_ID
    const zone = input.readerTimeZone
    // 未到点：别预告失败。计划时刻按读者的钟算——期只写时刻，不写钟。
    const cutoff = briefingScheduledCutoff(input.today, period.generationTime, zone)
    if (cutoff === undefined || Date.parse(cutoff) > Date.parse(input.now)) continue
    const locale = period.language
    // 读者成功删过的：不建行，否则删完又冒出来，等于删不掉。
    if (await input.store.wasEditionDeleted?.(input.today, id, locale).catch(() => false) === true) continue
    // 有版次 / 有尝试：那一行由版次或尝试自己说，不在这里造。
    const edition = await input.store.get(input.today, locale, id).catch(() => undefined)
    if (edition !== undefined) continue
    const attempts = await input.store.listAttempts?.(input.today, locale, id).catch(() => undefined)
    if (attempts !== undefined && attempts.length > 0) continue
    missed.push(Object.freeze({ date: input.today, periodId: id, locale }))
  }
  return Object.freeze(missed)
}
