import { useMemo } from 'react'

import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'

import { LoadingState } from '@platform/ui/components/loading'

import type { MarketCalendarEvent } from '../../../contracts/macro/marketCalendarQueryContracts'
import { calendarDisplayDate } from '../../features/macro/economic-calendar/economicCalendarDayModel'
import type { MacroIndicatorDrawerText } from './macroIndicatorDrawerText'

/**
 * 抽屉里的迷你发布日历：一格一个日期，格内按名字列发布（最多三条，第 4 条起「N 条重要」）。
 *
 * 版式照 `2026-11-13-K11-b.html` 的 `CALMONTHS`（格内 `[短名, 状态]`、圆点、`mcell__more`），
 * 但**数据全部来自 props**：本月读到的发布、选中日、今天都由调用方给，这里不画任何示例日程。
 *
 * 格子是原生 `<button>`：它是「一个日期」这个选择单位，格子里还要塞下几条事件行，
 * 平台 `Choice`/`Toggle` 只能表达一个可选项、塞不下行内的名字与圆点，换它会丢掉「这天有什么」。
 * 可访问名就是格的可见内容（日期数字 + 事件名），选中态用 `aria-pressed` 表达。
 */
const CELL_ITEM_LIMIT = 3

export function MiniReleaseCalendar({ text, month, today, selectedDay, events, timeZone, now, state, refreshing, onSelectDay, onMonthChange, onRefresh, onConfigure }: Readonly<{
  text: MacroIndicatorDrawerText
  /** 当前显示的月份 `YYYY-MM`。 */
  month: string
  /** 读者所在时区的今天 `YYYY-MM-DD`。 */
  today: string
  selectedDay?: string
  /** 这个月读到的事件（同一个快照）。 */
  events: readonly MarketCalendarEvent[]
  /** 日期分组用读者所在时区：日期按设置时区切分，不能按 UTC 猜。 */
  timeZone: string
  /** 「已发布 / 待发布」的分界时刻，与上面那份数据同一个快照。 */
  now: string
  state: 'idle' | 'loading' | 'ready' | 'unavailable'
  /** 只有手动刷新才显示等待；换月也在读，那时不该把整格换成转圈。 */
  refreshing: boolean
  onSelectDay: (day: string) => void
  onMonthChange: (month: string) => void
  onRefresh: () => void
  /** 去日历来源配置；没有落点时按钮禁用，而不是画一颗点了没反应的假按钮。 */
  onConfigure?: () => void
}>): React.ReactElement {
  const currentMonth = today.slice(0, 7)
  const weeks = useMemo(() => buildWeeks(month, groupByDay(events, timeZone, now)), [month, events, timeZone, now])
  const noReleases = state === 'ready' && events.length === 0
  const [year, monthNumber] = month.split('-')
  const step = (delta: number) => onMonthChange(shiftMonth(month, delta))

  return <section className="mk-minical" aria-label={text.minicalTitle}>
    <div className="mk-minical__h">
      <h3>{text.minicalMonth.replace('{year}', year!).replace('{month}', String(Number(monthNumber)))} · {text.minicalTitle}</h3>
      <span className="mk-minical__lg">
        <i className="mk-mdot mk-mdot--done" />{text.minicalLegend.done}
        <i className="mk-mdot mk-mdot--todo" />{text.minicalLegend.todo}
        <i className="mk-mdot mk-mdot--today" />{text.minicalLegend.today}
      </span>
      <span className="mk-minical__tools">
        <button className="mk-iconbtn" type="button" aria-label={text.minicalTools.prev}
          onClick={() => step(-1)}><ChevronLeft aria-hidden="true" size={14} /></button>
        <button className="mk-iconbtn" type="button" aria-label={text.minicalTools.next}
          onClick={() => step(1)}><ChevronRight aria-hidden="true" size={14} /></button>
        <button className="mk-textbtn" type="button" aria-label={text.minicalTools.back} disabled={month === currentMonth}
          onClick={() => onMonthChange(currentMonth)}>{text.minicalTools.back}</button>
        <button className="mk-iconbtn" type="button" aria-label={text.minicalTools.refresh} onClick={onRefresh}>
          <RefreshCw aria-hidden="true" size={14} />
        </button>
        <button className="mk-textbtn" type="button" aria-label={text.minicalTools.configure} disabled={onConfigure === undefined}
          {...(onConfigure === undefined ? {} : { onClick: onConfigure })}>{text.minicalTools.configure}</button>
      </span>
    </div>
    {refreshing ? <div className="mk-minical__busy"><LoadingState layout="inline" size="sm" label={text.minicalTools.refreshing} /></div> : <>
      <div className="mk-minical__wk">{text.weekday.map(day => <span key={day}>{day}</span>)}</div>
      <div className="mk-minical__grid">
        {weeks.map((week, rowIndex) => week.map(cell => {
          const isToday = cell.dateKey === today
          const dataState = isToday ? 'today' : !cell.current ? 'outside' : cell.items.length ? 'ready' : 'nodata'
          if (!cell.current) {
            // 月外的格子不是这个月的日期：画出来只为对齐周次，点了会跳到另一个月——所以不可交互。
            return <div className="mk-minical__day" key={`${rowIndex}-${cell.dateKey}`} data-state={dataState}><em>{cell.day}</em></div>
          }
          const shown = cell.items.slice(0, CELL_ITEM_LIMIT)
          const hidden = cell.items.length - shown.length
          return <button className="mk-minical__day" type="button" key={`${rowIndex}-${cell.dateKey}`}
            data-state={dataState} aria-pressed={cell.dateKey === selectedDay}
            onClick={() => onSelectDay(cell.dateKey)}>
            <em>{cell.day}</em>
            {shown.map(item => <span className="mk-mcell__row" key={`${item.name}-${item.at}`}>
              <i className={`mk-mdot mk-mdot--${item.state}`} />{item.name}
            </span>)}
            {hidden > 0 ? <span className="mk-mcell__more" role="img"
              aria-label={text.minicalMoreAria.replace('{count}', String(hidden))}>
              {text.minicalMore.replace('{count}', String(hidden))}
            </span> : null}
          </button>
        }))}
      </div>
      {noReleases ? <p className="mk-minical__nodata">{text.minicalNoData}</p> : null}
      {state === 'unavailable' ? <p className="mk-minical__nodata" role="status">{text.minicalUnavailable}</p> : null}
    </>}
  </section>
}

type Item = Readonly<{ name: string; at: string; state: 'done' | 'todo' }>
type Cell = Readonly<{ dateKey: string; day: number; current: boolean; items: readonly Item[] }>

/** 事件按**读者时区**的日期分组，同一天内按时刻升序。 */
function groupByDay(events: readonly MarketCalendarEvent[], timeZone: string, now: string): ReadonlyMap<string, readonly Item[]> {
  const nowMs = Date.parse(now)
  const byDay = new Map<string, Item[]>()
  for (const event of events) {
    const at = Date.parse(event.scheduledAt)
    if (!Number.isFinite(at)) continue
    const day = calendarDisplayDate(event.scheduledAt, timeZone)
    const items = byDay.get(day) ?? []
    items.push({ name: event.title, at: event.scheduledAt, state: at <= nowMs ? 'done' : 'todo' })
    byDay.set(day, items)
  }
  for (const items of byDay.values()) items.sort((left, right) => Date.parse(left.at) - Date.parse(right.at))
  return byDay
}

/** Six Monday-first weeks centred on the month. */
function buildWeeks(month: string, byDay: ReadonlyMap<string, readonly Item[]>): readonly (readonly Cell[])[] {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number]
  const first = new Date(Date.UTC(year, monthNumber - 1, 1))
  const startOffset = (first.getUTCDay() + 6) % 7
  const start = new Date(Date.UTC(year, monthNumber - 1, 1 - startOffset))
  const weeks: Cell[][] = []
  for (let row = 0; row < 6; row += 1) {
    const week: Cell[] = []
    for (let column = 0; column < 7; column += 1) {
      const at = new Date(start.getTime() + (row * 7 + column) * 86_400_000)
      const dateKey = at.toISOString().slice(0, 10)
      const current = at.getUTCMonth() === monthNumber - 1
      week.push({ dateKey, day: at.getUTCDate(), current, items: current ? (byDay.get(dateKey) ?? []) : [] })
    }
    weeks.push(week)
  }
  return weeks
}

/** `YYYY-MM` 加减月：跨年交给 `Date`，不手写进位。 */
export function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number]
  return new Date(Date.UTC(year, monthNumber - 1 + delta, 1)).toISOString().slice(0, 7)
}
