import type { BriefingPeriod } from '../../../contracts/dailyBriefingPeriod'
import type { DailyBriefingEditionSummary, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { dailyBriefingPolicy } from '../../../contracts/dailyBriefing'
import { briefingScheduledTimeFor, readBriefingHistory } from './dailyBriefingHistory'
import { missedScheduledPeriods } from './dailyBriefingMissedPeriods'

/**
 * 历史列表的读取装配：把窗口、排期时刻、漏期、正在跑、以及「这一版用哪条会话」拼成一次读。
 *
 * 抽出来只为一件事：`dailyBriefingService.ts` 已经顶在体积门禁上，而这段是**一次读**的装配，
 * 不是服务的职责；挪出来以后它的入参也把「列表需要哪些事实」写明了。
 */
export async function readBriefingListHistory(input: Readonly<{
  store: Parameters<typeof readBriefingHistory>[0]['store'] & Parameters<typeof missedScheduledPeriods>[0]['store']
  locale: DailyBriefingLocale
  today: string
  timeZone: string
  generationTime: string
  now: string
  /** 期配置：排期时刻与「今天该有却没有」都从这一份读，不在两处各读一次。 */
  periods: readonly BriefingPeriod[]
  /** 这台进程里正在跑的期（`date:periodId:` 前缀），"生成中"是活体事实。 */
  progressKeys: () => Iterable<string>
  /** E9：这一版最新一次生成用的会话 id；`null` 与读失败都在列表里不显示入口。 */
  sessionIdOf?: (input: Readonly<{ date: string; periodId: string; locale: DailyBriefingLocale }>) => Promise<string | null>
}>): Promise<Readonly<{ editions: readonly DailyBriefingEditionSummary[]; dates: readonly string[] }>> {
  const sessionIdOf = input.sessionIdOf
  return readBriefingHistory({
    store: input.store,
    locale: input.locale,
    today: input.today,
    retentionDays: dailyBriefingPolicy.retentionDays,
    scheduledTime: briefingScheduledTimeFor(input.periods, input.generationTime),
    // 排期期今天该有却没有 → 也要留一行说明（`02` v2.149 甲案），否则它悄悄没有。
    missedPeriods: await missedScheduledPeriods({
      store: input.store,
      periods: async () => input.periods,
      today: input.today,
      now: input.now,
      readerTimeZone: input.timeZone,
      fallbackLocale: input.locale
    }),
    isRunning: (date, periodId) => [...input.progressKeys()].some((key) => key.startsWith(`${date}:${periodId}:`)),
    ...(sessionIdOf ? { sessionId: (date, periodId, locale) => sessionIdOf({ date, periodId, locale }) } : {})
  })
}
