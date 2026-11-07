import { readTestNoticeCandidates, registerTestNoticeCandidates } from '@platform/notifications/runtime/testNoticeCandidatesSlot'

import type { CalendarEventReminderWiring } from './intelligence/macro-calendar/registerCalendarEventReminder'
import {
  calendarLandedTestCandidate,
  calendarUpcomingTestCandidate,
  type CalendarTestSourceState
} from './intelligence/macro-calendar/calendarNotificationTestCandidates'
import { createIntelligenceSelfTestPort } from './intelligence/notificationSelfTestCandidates'
import { readSentimentTestCandidate } from './intelligence/news-sentiment/newsSentimentTestCandidate'
import type { IntelligenceModule } from './intelligence/intelligenceModule'

/**
 * 三枚「测试」按钮的**唯一装配点**（技术方案 §3）。单独成文件，让 `bootstrap.ts`（718 行、基线 718）
 * 只增一行调用，不把这段塞进那个被体积门禁盯住的文件。
 *
 * 三个 kind 各接哪份数据（复审对照这张）：
 * - **舆情**：`newsSentiment.store.listLatestSentiment` + `pipeline.listItems` + 启用源
 *   （`sourceProfileStore.listProfiles().filter(enabled)`）+ 门槛 `scoring.readPushThreshold()`（同一 store
 *   实例，缺省 `medium`）+ 读者时区。
 * - **日历事后**：`publicQueryService.queryMarketCalendarMonth`——与日历页、与真实「结果公布」推送同源
 *   （bootstrap 同一点绑定的 `marketCalendar.queryMonth`）；`month` 用 `YYYY-MM`，本月 + 上月各一次；
 *   `actual` 取事件上的 `providerActual` 原文。
 * - **日历事前**：`calendarReminder.readEvents()`（wiring 原样暴露的那个）+ `calendarReminderSettings.read()`。
 *
 * `source` 只按日历线规则判：**启用源为空 → `disabled`；读取抛错或查询 `unavailable` → `unreadable`**；
 * 其余 `available`。「没有」与「拿不到」不许互相顶替。
 */
export function wireNotificationSelfTest(deps: Readonly<{
  intelligence: IntelligenceModule
  calendarReminder: CalendarEventReminderWiring
  readEnabledCalendarFeeds: () => Promise<readonly string[]>
  timeZone: () => string
  getAppLanguage?: () => Promise<'zh-CN' | 'en-US'>
  now?: () => string
}>): void {
  // 同一进程里模块可能被重建（测试、热重载）：装配侧幂等；平台槽仍然拒绝第二个**产品**。
  if (readTestNoticeCandidates() !== undefined) return
  const now = deps.now ?? (() => new Date().toISOString())

  const calendarSource = async (): Promise<CalendarTestSourceState> => {
    try {
      const feeds = await deps.readEnabledCalendarFeeds()
      return feeds.length === 0 ? 'disabled' : 'available'
    } catch {
      return 'unreadable'
    }
  }
  const monthOf = (asOf: string): string => asOf.slice(0, 7)
  const previousMonthOf = (asOf: string): string => {
    const date = new Date(`${monthOf(asOf)}-01T00:00:00.000Z`)
    date.setUTCMonth(date.getUTCMonth() - 1)
    return date.toISOString().slice(0, 7)
  }

  registerTestNoticeCandidates(createIntelligenceSelfTestPort({
    now,
    readSentiment: () => readSentimentTestCandidate({
      store: deps.intelligence.newsSentiment.store!,
      pipeline: deps.intelligence.pipeline,
      readEnabledSourceIds: async () =>
        (await deps.intelligence.sourceProfileStore.listProfiles()).filter((profile) => profile.enabled).map((profile) => profile.sourceId),
      readThreshold: () => deps.intelligence.newsSentiment.scoring?.readPushThreshold() ?? 'medium',
      getTimeZone: deps.timeZone,
      now
    }),
    readUpcoming: async () => calendarUpcomingTestCandidate({
      now: now(),
      source: await calendarSource(),
      settings: deps.calendarReminder.read(),
      events: deps.calendarReminder.readEvents()
    }),
    readLanded: async () => {
      const source = await calendarSource()
      if (source !== 'available') return { kind: source === 'disabled' ? 'source-disabled' : 'unreadable' } as const
      const asOf = now()
      const locale = await (deps.getAppLanguage ?? (async () => 'zh-CN' as const))()
      for (const month of [monthOf(asOf), previousMonthOf(asOf)]) {
        const page = deps.intelligence.publicQueryService.queryMarketCalendarMonth({ month, locale, asOf })
        if ((page as { state?: string }).state === 'unavailable') return { kind: 'unreadable' } as const
        const landed = calendarLandedTestCandidate({ now: asOf, source, events: ((page as { events?: readonly unknown[] }).events ?? []) as never })
        if (landed.kind === 'landed') return landed
      }
      return { kind: 'none-landed' } as const
    }
  }))
}
