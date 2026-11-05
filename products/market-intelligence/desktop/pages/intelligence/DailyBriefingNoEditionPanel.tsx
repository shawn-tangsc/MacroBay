import { formatShellTimeZoneLabel } from '@platform/ui/time/shellTimeFormat'
import { StateView } from '@platform/ui/components/state'

import type { DailyBriefingPageViewState } from './dailyBriefingPageViewState'
import { briefingCutoffPassed } from './briefingPeriodCutoff'
import { DailyBriefingFailurePanel } from './DailyBriefingFailurePanel'
import type { DailyBriefingText } from './dailyBriefingText'

/**
 * 今天的副句：什么时候会出、想现在看怎么走。手动期没有固定时刻，换成对应那句。
 *
 * **过了点还没版次就不许再说"到点会自动出"**（`02` v2.129 G6）：那天不会再出了，那句话
 * 做的是一个做不到的承诺。过了点改说「这一期没有生成」，只留"现在手动生成一次"这条真能走的路。
 */
function noEditionToday(text: DailyBriefingText, timeZone: string, scheduledTime: string | undefined, cutoffPassed: boolean | undefined): string {
  const labels = text.history
  if (scheduledTime === undefined) return labels.emptyTodayManual
  if (cutoffPassed === true) return labels.emptyTodayMissed.replace('{time}', scheduledTime).replace('{zone}', formatShellTimeZoneLabel(timeZone))
  return labels.emptyToday.replace('{time}', scheduledTime).replace('{zone}', formatShellTimeZoneLabel(timeZone))
}

/** What the pane says for one day the reader selected that has nothing to read. */
export function DailyBriefingNoEditionPanel({ view, text, timeZone, scheduledTime, currentPeriodDate, formatTime, now, onOpenSettings }: Readonly<{
  view: Extract<DailyBriefingPageViewState, { status: 'no-edition' }>
  text: DailyBriefingText
  timeZone: string
  scheduledTime?: string
  /** 判断"到点了没有"用的钟；用例注入一个固定时刻，生产不传就是现在。 */
  now?: Date
  /** The issue day the page is on: the same value the list and the generate action use. */
  currentPeriodDate?: string
  formatTime: (value: string, precision?: 'minute' | 'second') => string
  onOpenSettings: () => void
}>): React.ReactElement {
  const labels = text.history
  // 今天与历史日**共用同一块平台空态**（`02` v2.98）：标题由 `ui.state.empty` 提供，两块自动逐字
  // 相同；差异只在副句，副句走 `productReason` 的 key（字面键，守卫要求可判断前缀）。
  const isCurrent = view.date === currentPeriodDate
  if (isCurrent) {
    const cutoffPassed = scheduledTime === undefined ? undefined : briefingCutoffPassed({
      date: view.date, time: scheduledTime, timeZone, now: now ?? new Date()
    })
    return <StateView
      state="empty"
      /* 「还没发生」这一档。**不许 `never-ran`**——它配的动作是"现在跑一次"，而历史日报不支持补生成；
         **不许 `error`**——那会把"还没有"和"读不到"合成一句。 */
      reasonCode="not-yet"
      size="md"
      className="mi-daily-briefing-page__no-edition"
      productReason={{ key: 'mi.dailyBriefing.emptyToday', resolve: () => noEditionToday(text, timeZone, scheduledTime, cutoffPassed) }}
    />
  }
  return <StateView
    state="empty"
    /* 历史日：「那段时间确实没有」，不是"还没跑"。 */
    reasonCode="nothing-in-window"
    size="md"
    className="mi-daily-briefing-page__no-edition"
    productReason={{ key: 'mi.dailyBriefing.emptyHistorical', resolve: () => text.history.emptyBodyHistorical }}
  />
}
