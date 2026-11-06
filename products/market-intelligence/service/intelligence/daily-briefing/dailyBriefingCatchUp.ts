import { DEFAULT_PERIOD_ID, type DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { briefingScheduledCutoff, localDate } from './dailyBriefingWindow'
import type { DailyBriefingPeriod } from './dailyBriefingGenerationSettings'

/**
 * 错过了就补跑一次。
 *
 * 用户 2026-11-06 遇到的那天：07:00 那期一次都没跑，因为修时区那一刻今天的 07:00 已经过去，
 * 下一次触发直接排到明天——中间没有任何人补。规则：**启动或排期重排时，某一期今天已过生成时刻、
 * 且今天一次都没跑过，就立刻补跑一次**。
 *
 * 判据只用两样能查证的事实：「到点了没有」和「今天有没有留下过任何跑的痕迹」。痕迹就是 attempt 行
 * ——它在开工前就写下，比运行记录和版次都早，所以"跑了一半崩掉"也算跑过，不会被重复补。
 * 版次另算一道：有版次就不可能一次都没跑过。
 *
 * 这一条**不是**"重跑历史上缺的天"：只补今天、只补到点的那一期，过去的日子不动（历史补生成是另一件事）。
 */
export type BriefingCatchUpDue = Readonly<{ date: string; cutoff: string }> | undefined

/** 这一期今天到点了没有；到点了才谈得上补。 */
export function briefingCatchUpDue(
  period: DailyBriefingPeriod & Readonly<{ language?: DailyBriefingLocale }>,
  readerTimeZone: string,
  now: string
): BriefingCatchUpDue {
  // 期自己的时区优先：它在哪个钟上排期，就在哪个钟上判"今天到点没有"。
  const zone = period.generationTimeZone ?? readerTimeZone
  const today = localDate(now, zone)
  if (today === undefined) return undefined
  // 只问"今天这一期的计划时刻过去了没有"。补跑不回头补昨天：历史补生成是另一件事。
  const cutoff = briefingScheduledCutoff(today, period.generationTime, zone)
  if (cutoff === undefined || Date.parse(cutoff) > Date.parse(now)) return undefined
  return Object.freeze({ date: today, cutoff })
}

export type BriefingCatchUpDeps = Readonly<{
  /** The saved periods, read at the moment of the check — never a cached copy from startup. */
  getPeriods: () => Promise<readonly (DailyBriefingPeriod & Readonly<{ language?: DailyBriefingLocale }>)[]>
  getLocale: () => Promise<DailyBriefingLocale>
  readerTimeZone: () => string
  now: () => string
  /** 这一期今天已经有版次（读得到就说明跑成了）。 */
  hasEdition: (input: Readonly<{ date: string; locale: DailyBriefingLocale; periodId: string }>) => Promise<boolean>
  /** 这一期今天留下过几条尝试记录（任何状态都算"跑过"）。 */
  attemptCount: (input: Readonly<{ date: string; locale: DailyBriefingLocale; periodId: string }>) => Promise<number>
  /** 真的跑：与定时那条路同一个入口，只是把触发记成补跑。 */
  run: (input: Readonly<{
    date: string
    locale: DailyBriefingLocale
    periodId: string
    timeZone: string
    generationTime: string
    windowHours: 12 | 24 | 48
  }>) => Promise<unknown>
}>

/** 补跑今天错过了的那期；返回真的补了哪几期。失败不抛：启动与重排都不能被它挡住。 */
export async function catchUpMissedDailyBriefings(deps: BriefingCatchUpDeps): Promise<readonly string[]> {
    const periods = await deps.getPeriods().catch(() => [])
    if (periods.length === 0) return Object.freeze([])
    const readerTimeZone = deps.readerTimeZone()
    const now = deps.now()
    const fallbackLocale = await deps.getLocale().catch(() => 'zh-CN' as const)
    const caughtUp: string[] = []
    for (const period of periods) {
      const due = briefingCatchUpDue(period, readerTimeZone, now)
      if (!due) continue
      const locale = period.language ?? fallbackLocale
      const id = period.id || DEFAULT_PERIOD_ID
      // 跑过的证据：有版次，或者留下过任何一条 attempt。两者都不必再跑一遍。
      if (await deps.hasEdition({ date: due.date, locale, periodId: id }).catch(() => true)) continue
      if (await deps.attemptCount({ date: due.date, locale, periodId: id }).catch(() => 1) > 0) continue
      // 同一刻重复调用是安全的：服务端按 (日期, 期号, 语言) 合并，第二次会并进正在跑的那一次。
      await deps.run({
        date: due.date, locale, periodId: id,
        timeZone: period.generationTimeZone ?? readerTimeZone,
        generationTime: period.generationTime,
        windowHours: period.windowHours
      })
      caughtUp.push(id)
    }
    return Object.freeze(caughtUp)
}
