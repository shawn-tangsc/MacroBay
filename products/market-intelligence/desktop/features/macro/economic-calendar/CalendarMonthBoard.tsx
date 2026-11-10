import { Button } from 'antd'
import type { ReactElement } from 'react'

import { LoadingState } from '@platform/ui/components/loading'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'

import type { MarketCalendarEvent, MarketCalendarSource } from '../../../../contracts/macro/marketCalendarQueryContracts'
import { StateView } from '@platform/ui/components/state'
import { CalendarEmptyMonthState } from './CalendarEmptyMonthState'
import { CalendarNoSourceEnabledState } from './CalendarNoSourceEnabledState'
import { CalendarEventRow } from './CalendarEventRow'
import { unifiedCalendarDay, type CalendarDayCoverage, type CalendarDayItem } from './economicCalendarDayModel'
import { createEconomicCalendarProjection, type EconomicCalendarEventView, type EconomicCalendarProjection } from './economicCalendarModel'
import type { EconomicCalendarText } from './economicCalendarText'
import type { EconomicCalendarMonthState } from './useEconomicCalendarMonthWindow'
import type { MarketCalendarMonthRead } from './useMarketCalendar'

/**
 * A month with no events is not a failed read: it is a reading, and it carries no action (nothing the
 * reader could press would produce events). The count is the "empty month" boundary for the board.
 */
const economicCalendarEmptyStateActionPolicy = { emptyEventCount: 0 } as const

/**
 * The board half of the page: the month grid, plus the shell that shows why the grid is not there.
 *
 * It was inside `EconomicCalendar.tsx`, which is the page's orchestration (queries, selection,
 * selection identity, the detail panel) and had grown past its size gate. Nothing here reads page
 * state: every value arrives as a prop, so the grid can be reasoned about — and tested — without the
 * page's effects.
 */
export function CalendarMonthBoard({ month, asOf, today, statusNow, onOpenDay, onSelectItem, selectedEventKey, state, text, events, marketEvents, marketSources, coverage, officialUnavailable, officialFeeds, onRetryMonth, onOpenSettings, marketMonthRead, marketLoading, onRetryMarket }: {
  statusNow: string
  today: string
  asOf: string
  events: readonly EconomicCalendarEventView[]
  marketEvents: readonly MarketCalendarEvent[]
  marketSources: readonly MarketCalendarSource[]
  onSelectItem: (item: CalendarDayItem) => void
  coverage: CalendarDayCoverage
  month: string
  onOpenDay: (day: string) => void
  selectedEventKey: string | undefined
  state: EconomicCalendarMonthState
  text: EconomicCalendarText
  /** 官方源停用时那一句；有它就按「拿不到」画，而不是按「没有」。 */
  officialUnavailable?: string
  /** 官方日历腿的三态（注册表那侧算好的）：全关 / 可用 / 取不到。 */
  officialFeeds?: 'disabled' | 'enabled' | 'unavailable'
  /** 重读这个月：`unavailable` 那句旁边的「重试」按它，重试是再读一次，不是再跑一次采集。 */
  onRetryMonth?: () => void
  /** 「去启用」的去处：与页头那颗设置同一个目的地（宿主接的配置抽屉）。 */
  onOpenSettings?: () => void
  /** 市场侧**命名月自己**的读取结论（按月；相邻月失败不进来）。 */
  marketMonthRead?: MarketCalendarMonthRead
  /** 窗口级 loading：命名月还没轮到读时，这里不许下任何结论。 */
  marketLoading?: boolean
  /** 市场侧读不到时的重试：重新读取，不是拿窗口整体状态顶替。 */
  onRetryMarket?: () => void
}): ReactElement {
  const surface = monthSurface({
    officialUnavailable: officialUnavailable !== undefined,
    officialCount: events.length,
    marketCount: marketEvents.length,
    monthRead: state.state,
    marketMonthRead,
    marketLoading,
    marketSources,
    officialFeeds
  })
  const monthFailure = state.state === 'unavailable' ? text.failures[state.failureCode] : undefined
  const marketFailure = marketMonthRead?.status === 'failed' ? marketMonthFailureSentence(marketMonthRead.reason, text) : undefined
  if (surface === 'disabled') return <CalendarNoSourceEnabledState text={text} {...(onOpenSettings === undefined ? {} : { onOpenSettings })} />
  if (surface === 'loading') return <CalendarState month={month} text={text.status.loading} loading />
  if (surface === 'official-unavailable') return <CalendarState month={month} text={officialUnavailable!} loading={false} unavailable />
  // 「读不到」：错误态 + 原因 + 重试。原因取这一侧真正失败的那一句；两侧都失败时官方那句在前。
  if (surface === 'error') {
    return <CalendarState month={month} text={(monthFailure ?? marketFailure)!} loading={false}
      onRetry={monthFailure !== undefined ? onRetryMonth : onRetryMarket} />
  }
  /**
   * 说明行是**常驻注解**，不是状态变更：`role="note"`，别用活区。三种原因各一句、只画有的那些：
   * 官方月读不到 / 市场命名月读不到 / 官方腿停用。空态从不与它们同屏。
   */
  const notes = [...new Set([monthFailure, marketFailure, surface === 'note' ? officialUnavailable : undefined]
    .filter((line): line is string => line !== undefined))]
  const projection = state.state === 'available' ? state.projection : createEconomicCalendarProjection({ month, asOf, events: [] })
  return <div className="mi-calendar-month-scroll">{notes.map(note => <p className="mi-economic-calendar__comparison-rule" key={note} role="note">{note}</p>)}{state.state === 'loading' ? <LoadingState layout="inline" size="sm" label={text.status.loading} /> : null}{surface === 'no-locale' ? <p className="mi-economic-calendar__comparison-rule" data-calendar-no-locale role="note">{text.noLocaleRowsNote}</p> : null}<CalendarMonth statusNow={statusNow} today={today} events={events} marketEvents={marketEvents} marketSources={marketSources} onSelectItem={onSelectItem} coverage={coverage} month={month} projection={projection} selectedEventKey={selectedEventKey} onOpenDay={onOpenDay} text={text} showEmpty={surface === 'empty'} /></div>
}

/** 命名月读不到时读者看到的那一句：`query-unavailable` 与状态行共用一句，其余按码各一句。 */
export function marketMonthFailureSentence(reason: NonNullable<Extract<MarketCalendarMonthRead, { status: 'failed' }>>['reason'], text: EconomicCalendarText): string {
  return reason === 'query-unavailable' ? text.market.queryUnavailable : text.market.marketReadFailure[reason]
}

/**
 * 这一个月该怎么画，一句话判完——四行表（界面设计 2026-11-09）的唯一判据处。
 *
 * 判据顺序是固定的，先判前面：
 * 1. **还在读** → 加载态，不给任何「有/没有/读不到」的结论；
 * 2. **来源全关**（读者自己关的）→ 不可用态 + 去启用；
 * 3. **命名月读不到**（市场侧）→ 整块空＝错误态 + 原因 + 重试；另一侧有内容＝说明行；
 * 4. **官方月读不到** → 同上；
 * 5. **官方腿已判定不可用**（今天只有 BLS 403）→ 整块空＝不可用态（重试必失败，不给动作），有行＝说明行；
 * 6. **来源不发布读者语言** → 说明行（不是「本月没有」）；
 * 7. **都读到、确实为空** → 空态，**无动作**。
 *
 * 市场侧只读 `marketMonthRead`（命名月自己的结论），**不读窗口级 `failure`**：三个月合一的布尔会把
 * 「相邻月读不到」写成「本月读不到」，和「把读不到说成没有」是同一个错换方向。
 */
export function monthSurface(input: Readonly<{
  officialUnavailable: boolean
  officialCount: number
  marketCount: number
  /** 官方月读；未传＝已读完（只关心官方腿那一轴的调用点）。 */
  monthRead?: 'loading' | 'unavailable' | 'available'
  /** 命名月自己的读取结论；未传＝读到了。 */
  marketMonthRead?: MarketCalendarMonthRead
  /** 窗口级 loading；未传＝没有在读。 */
  marketLoading?: boolean
  /** 已投影的来源状态（只为「来源不发布读者语言」这一条）。 */
  marketSources?: readonly MarketCalendarSource[]
  /** 官方日历腿的三态（注册表那侧算好的）。 */
  officialFeeds?: 'disabled' | 'enabled' | 'unavailable'
}>): 'board' | 'note' | 'official-unavailable' | 'loading' | 'error' | 'disabled' | 'no-locale' | 'empty' {
  const monthRead = input.monthRead ?? 'available'
  const marketMonthRead = input.marketMonthRead ?? { status: 'read' as const }
  const marketLoading = input.marketLoading ?? false
  const empty = input.officialCount === 0 && input.marketCount === 0
  if (monthRead === 'loading' && input.marketCount === 0) return 'loading'
  if (marketLoading && empty && monthRead === 'available') return 'loading'
  if (input.officialFeeds === 'disabled' && monthRead === 'available' && empty) return 'disabled'
  if (marketMonthRead.status === 'failed') return empty ? 'error' : 'note'
  if (monthRead === 'unavailable') return empty ? 'error' : 'note'
  if (input.officialUnavailable) {
    if (empty) return 'official-unavailable'
    return input.marketCount > 0 ? 'note' : 'board'
  }
  if (empty && (input.marketSources ?? []).some(source => source.status === 'no-locale-rows')) return 'no-locale'
  if (empty) return 'empty'
  return 'board'
}

function CalendarState({ month, text, loading, unavailable = false, onRetry }: { month: string; text: string; loading: boolean; unavailable?: boolean; onRetry?: () => void }): ReactElement {
  return <section className="mi-economic-calendar__month" aria-live="polite" data-month-key={month}>
    {loading
      ? <LoadingState label={text} minHeight={220} />
      // 官方腿已判定不可用：不可用态 + 原因，**不给动作按钮**——403 再试必失败，假动作比没有更坏。
      : unavailable
        ? <StateView className="mi-economic-calendar__official-unavailable" productReason={{ key: 'mi.calendar.official-unavailable', resolve: () => text }}
            reasonCode="capability-not-wired" size="lg" state="disabled" />
        // 「读不到」：错误态 + 原因 + 重试（界面设计 2026-11-09 四行表的第二行）。重试重读这个月。
        : onRetry !== undefined
          ? <StateView action={{ labelKey: 'ui.state.action.retry', onSelect: onRetry }} className="mi-economic-calendar__read-failed"
              productReason={{ key: 'mi.calendar.month-read-failed', resolve: () => text }} reasonCode="unavailable" size="lg" state="error" />
          : <p className="mi-economic-calendar__more">{text}</p>}
  </section>
}

function CalendarMonth({ month, today, statusNow, projection, events, selectedEventKey, onOpenDay, onSelectItem, text, marketEvents, marketSources, coverage, showEmpty }: {
  statusNow: string
  today: string
  events: readonly EconomicCalendarEventView[]
  marketEvents: readonly MarketCalendarEvent[]
  marketSources: readonly MarketCalendarSource[]
  onSelectItem: (item: CalendarDayItem) => void
  coverage: CalendarDayCoverage
  month: string
  projection: EconomicCalendarProjection
  selectedEventKey: string | undefined
  onOpenDay: (day: string) => void
  text: EconomicCalendarText
  /** 整块空的时候画不画那个「本月没有任何事件」的空态：来源不提供读者语言时由说明行替代。 */
  showEmpty: boolean
}): ReactElement {
  const timeZone = useShellTimeZone()
  const linkedMarketKeys = new Set(marketEvents.filter(event => event.officialLink).map(event => event.eventKey))
  return <section className="mi-economic-calendar__month" aria-label={projection.month} data-month-key={month}>
    <div className="mi-economic-calendar__weekdays">{text.weekdays.map((day) => <span key={day}>{day}</span>)}</div>
    <div className="mi-economic-calendar__grid">
      {projection.days.map((day) => {
        const unified = unifiedCalendarDay(day.dateKey, events, marketEvents, coverage, timeZone, linkedMarketKeys)
        return <article className="mi-economic-calendar__day" data-date={day.dateKey} data-month={day.month} key={day.dateKey}>
          <span className="mi-economic-calendar__date" aria-current={day.dateKey === today ? 'date' : undefined}>{day.day}</span>
          <div className="mi-economic-calendar__events">
            {unified.visible.map(item => <CalendarEventRow key={item.key} item={item} marketSources={marketSources} text={text} statusNow={statusNow} selected={item.event.eventKey === selectedEventKey} onSelect={onSelectItem} />)}
            {unified.coverage !== 'complete' || unified.remaining ? <Button className="mi-economic-calendar__more mi-economic-calendar__more-button" data-calendar-more onClick={() => onOpenDay(day.dateKey)} size="small" type="text">{unified.coverage === 'complete' ? text.unifiedDay.more.replace('{count}', String(unified.remaining)) : text.unifiedDay[unified.coverage]}</Button> : null}
          </div>
        </article>
      })}
    </div>
    {showEmpty && events.length === economicCalendarEmptyStateActionPolicy.emptyEventCount && !marketEvents.length ? <CalendarEmptyMonthState text={text} /> : null}
  </section>
}
