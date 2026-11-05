import { formatShellTimeZoneLabel } from '@platform/ui/time/shellTimeFormat'
import { StateView } from '@platform/ui/components/state'

import type { DailyBriefingPageViewState } from './dailyBriefingPageViewState'
import { DailyBriefingFailurePanel } from './DailyBriefingFailurePanel'
import type { DailyBriefingText } from './dailyBriefingText'

/** 今天的副句：什么时候会出、想现在看怎么走。手动期没有固定时刻，换成对应那句。 */
function noEditionToday(text: DailyBriefingText, timeZone: string, scheduledTime?: string): string {
  const labels = text.history
  if (scheduledTime === undefined) return labels.emptyTodayManual
  return labels.emptyToday.replace('{time}', scheduledTime).replace('{zone}', formatShellTimeZoneLabel(timeZone))
}

/** What the pane says for one day the reader selected that has nothing to read. */
export function DailyBriefingNoEditionPanel({ view, text, timeZone, scheduledTime, currentPeriodDate, formatTime, onOpenSettings }: Readonly<{
  view: Extract<DailyBriefingPageViewState, { status: 'no-edition' }>
  text: DailyBriefingText
  timeZone: string
  scheduledTime?: string
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
    return <StateView
      state="empty"
      /* 「还没发生」这一档。**不许 `never-ran`**——它配的动作是"现在跑一次"，而历史日报不支持补生成；
         **不许 `error`**——那会把"还没有"和"读不到"合成一句。 */
      reasonCode="not-yet"
      size="md"
      className="mi-daily-briefing-page__no-edition"
      productReason={{ key: 'mi.dailyBriefing.emptyToday', resolve: () => noEditionToday(text, timeZone, scheduledTime) }}
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
