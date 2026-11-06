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
  /** 读者今天亲手删过这一行（成功那次）→ 不许补，否则删了又长回来。 */
  wasDeleted: (input: Readonly<{ date: string; locale: DailyBriefingLocale; periodId: string }>) => Promise<boolean>
  /** 真的跑：与定时那条路同一个入口，只是把触发记成补跑。返回那一次的结果，好判成功还是失败。 */
  run: (input: Readonly<{
    date: string
    locale: DailyBriefingLocale
    periodId: string
    timeZone: string
    generationTime: string
    windowHours: 12 | 24 | 48
  }>) => Promise<Readonly<{ state: string; failureCode?: string }>>
}>

/**
 * 一次补跑检查的结果：补了谁、跳过了谁（为什么）、谁补了但没成功。
 *
 * 以前只返回"补了哪几期"，跳过和失败都没有出口——于是"补跑没发生"在日志和返回值里都查不到
 * （2026-11-06 用户那天就是这样：库里零尝试，没人知道是没跑还是跑失败了）。现在三样都交出来，
 * 调用方打一行带 marker 的日志。
 */
export type BriefingCatchUpOutcome = Readonly<{
  ran: readonly string[]
  skipped: readonly Readonly<{ periodId: string; why: 'not-due' | 'has-edition' | 'has-attempt' | 'deleted-by-reader' }>[]
  failed: readonly Readonly<{ periodId: string; failureCode?: string }>[]
}>

/** 补跑今天错过了的那期。失败不抛：启动与重排都不能被它挡住。 */
export async function catchUpMissedDailyBriefings(deps: BriefingCatchUpDeps): Promise<BriefingCatchUpOutcome> {
    const periods = await deps.getPeriods().catch(() => [])
    const readerTimeZone = deps.readerTimeZone()
    const now = deps.now()
    const fallbackLocale = await deps.getLocale().catch(() => 'zh-CN' as const)
    const ran: string[] = []
    const skipped: Array<{ periodId: string; why: 'not-due' | 'has-edition' | 'has-attempt' | 'deleted-by-reader' }> = []
    const failed: Array<{ periodId: string; failureCode?: string }> = []
    for (const period of periods) {
      const id = period.id || DEFAULT_PERIOD_ID
      const due = briefingCatchUpDue(period, readerTimeZone, now)
      if (!due) {
        skipped.push({ periodId: id, why: 'not-due' })
        continue
      }
      const locale = period.language ?? fallbackLocale
      // 跑过的证据：有版次，或者留下过任何一条 attempt。两者都不必再跑一遍。
      if (await deps.hasEdition({ date: due.date, locale, periodId: id }).catch(() => true)) {
        skipped.push({ periodId: id, why: 'has-edition' })
        continue
      }
      if (await deps.attemptCount({ date: due.date, locale, periodId: id }).catch(() => 1) > 0) {
        skipped.push({ periodId: id, why: 'has-attempt' })
        continue
      }
      // 读者删过这一行：删完之后「已过点 + 零 attempt + 零版次」三条全成立，不认这条的话，下次
      // 启动就会把它重新生成回来，读者只会认为删除没生效（用户 2026-11-06）。
      if (await deps.wasDeleted({ date: due.date, locale, periodId: id }).catch(() => false)) {
        skipped.push({ periodId: id, why: 'deleted-by-reader' })
        continue
      }
      // 同一刻重复调用是安全的：服务端按 (日期, 期号, 语言) 合并，第二次会并进正在跑的那一次。
      const result = await deps.run({
        date: due.date, locale, periodId: id,
        timeZone: period.generationTimeZone ?? readerTimeZone,
        generationTime: period.generationTime,
        windowHours: period.windowHours
      }).catch((error: unknown) => ({ state: 'threw', failureCode: error instanceof Error ? error.message : String(error) }))
      // 补跑了不等于补成了：跑失败要说出来，否则"今天少了一期"永远没人知道。
      if (result.state === 'available') ran.push(id)
      else failed.push({ periodId: id, ...(result.failureCode === undefined ? {} : { failureCode: result.failureCode }) })
    }
    return Object.freeze({ ran: Object.freeze(ran), skipped: Object.freeze(skipped), failed: Object.freeze(failed) })
}
