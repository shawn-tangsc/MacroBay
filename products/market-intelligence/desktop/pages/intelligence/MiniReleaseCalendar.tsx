import { useEffect, useMemo, useRef, useState } from 'react'

import { ChevronLeft, ChevronRight, ListTree, RefreshCw } from 'lucide-react'
import { IconButton } from '@platform/ui/components/icon-button'

import { LoadingState } from '@platform/ui/components/loading'

import type { MarketCalendarEvent } from '../../../contracts/macro/marketCalendarQueryContracts'
import { filterVisibleByTier } from '../../../service/intelligence/macro-calendar/marketCalendarTierVisibility'
import { calendarDisplayDate } from '../../features/macro/economic-calendar/economicCalendarDayModel'
import { calendarCountryLabel } from '../../features/macro/economic-calendar/calendarCountryLabel'
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
/**
 * 格子放不下时最多放几条的**兜底值**：真实条数按格子高度算（`visibleRowsFor`），
 * 只有拿不到高度（首帧、无布局环境）才用它。
 */
const CELL_ITEM_LIMIT = 3
/** 一行事件的估高（`--font-meta` + 1px 行距）；只用来把格子高度换算成能放几行。 */
const CELL_ROW_HEIGHT = 16
/** 格子里日期号那一行占的高度（含内距）。 */
const CELL_HEADER_HEIGHT = 22

/**
 * 一个格子能放几条：用网格自身高度除以周数得到单格高度，再扣掉日期号那一行。
 * 拿不到高度时退回兜底值；最少 1 条，免得矮窗口把名字全藏掉。
 */
export function visibleRowsFor(gridHeight: number, weekCount: number): number {
  if (!Number.isFinite(gridHeight) || gridHeight <= 0 || weekCount <= 0) return CELL_ITEM_LIMIT
  return Math.max(1, Math.floor((gridHeight / weekCount - CELL_HEADER_HEIGHT) / CELL_ROW_HEIGHT))
}

export function MiniReleaseCalendar({ text, month, today, selectedDay, events, timeZone, now, state, refreshing, onSelectDay, onMonthChange, onRefresh, onConfigure, onOpenCatalog, catalogAriaOf, unmappedCountByDay }: Readonly<{
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
  /** 打开事件目录弹框：**日历组件头部**的那颗按钮（用户 2026-11-16）。 */
  onOpenCatalog?: () => void
  /** 读屏名解析器：由调用方给真表查找（`mkDay` 那一份），不在组件里拼句子。 */
  catalogAriaOf?: (key: string) => string
  /**
   * 未映射观测**按天**的条数（读者看到的是「今天有几件事」，两个来源都算，Chief 2026-11-16）。
   * 只进计数、不进名字：格子里只写标准表那些有分级的名字，未映射的名字在当天列表里读。
   */
  unmappedCountByDay?: ReadonlyMap<string, number>
}>): React.ReactElement {
  const currentMonth = today.slice(0, 7)
  const weeks = useMemo(() => buildWeeks(month, groupByDay(events, timeZone, now)), [month, events, timeZone, now])
  /**
   * **每格放几条由格子高度决定**（用户 2026-11-19）：窗口越高、格子越高，就多放一条；
   * 放不下的折进右上角 `+N`。不用固定 px 阈值拍脑袋——量的是网格自己的高度除以周数。
   */
  const gridRef = useRef<HTMLDivElement>(null)
  const [visibleRows, setVisibleRows] = useState(CELL_ITEM_LIMIT)
  useEffect(() => {
    const grid = gridRef.current
    if (grid === null || typeof ResizeObserver !== 'function') return undefined
    /**
     * 没有真实布局时（首帧、测试环境）量到的高度不可信：**低于一格的底线就当没量到**，
     * 保持兜底值——否则会把格子算成只放得下 1 条，名字都看不见。
     */
    const measure = (): void => {
      if (grid.clientHeight >= CELL_HEADER_HEIGHT + CELL_ROW_HEIGHT) {
        setVisibleRows(visibleRowsFor(grid.clientHeight, weeks.length))
      }
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(grid)
    return () => observer.disconnect()
  }, [weeks.length])
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
        {onOpenCatalog === undefined ? null : <IconButton ariaLabelKey="intelligence.calendar.mappingRules.open" size="sm" icon={ListTree}
          onSelect={() => onOpenCatalog()} resolveText={(key) => catalogAriaOf?.(key) ?? key} />}
        <button className="mk-textbtn" type="button" aria-label={text.minicalTools.configure} disabled={onConfigure === undefined}
          {...(onConfigure === undefined ? {} : { onClick: onConfigure })}>{text.minicalTools.configure}</button>
      </span>
    </div>
    {refreshing ? <div className="mk-minical__busy"><LoadingState layout="inline" size="sm" label={text.minicalTools.refreshing} /></div> : <>
      <div className="mk-minical__wk">{text.weekday.map(day => <span key={day}>{day}</span>)}</div>
      <div className="mk-minical__grid" ref={gridRef}>
        {weeks.map((week, rowIndex) => week.map(cell => {
          const isToday = cell.dateKey === today
          const unmappedCount = unmappedCountByDay?.get(cell.dateKey) ?? 0
          // 只有未映射观测的那天也是「有事」：它确实有一条事件等着读，不能被画成空日。
          const hasAny = cell.items.length + unmappedCount > 0
          const dataState = isToday ? 'today' : !cell.current ? 'outside' : hasAny ? 'ready' : 'nodata'
          if (!cell.current) {
            // 月外的格子不是这个月的日期：画出来只为对齐周次，点了会跳到另一个月——所以不可交互。
            return <div className="mk-minical__day" key={`${rowIndex}-${cell.dateKey}`} data-state={dataState}><em>{cell.day}</em></div>
          }
          // **格子里只写一级、二级指标与决议类事件的名字**，其余（未标级的讲话、库存这类）全部
          // 折进右上角那个数字——判据是 `filterVisibleByTier` 一处实现，不在这里另写一套。
          const tiered = filterVisibleByTier(cell.items.map(item => ({ metricKey: item.metricKey, item })),
            { maximumVisible: visibleRows })
          const shown = tiered.visible
          // 未映射的名字不进格子（格子里只放有分级的名字），但**条数要算**。
          const hidden = tiered.hiddenTotal + unmappedCount
          return <button className="mk-minical__day" type="button" key={`${rowIndex}-${cell.dateKey}`}
            data-state={dataState} aria-pressed={cell.dateKey === selectedDay}
            onClick={() => onSelectDay(cell.dateKey)}>
            <em>{cell.day}</em>
            {shown.map(item => <span className="mk-mcell__row" key={`${item.name}-${item.at}`}>
              <i className={`mk-mdot mk-mdot--${item.state}`} />
              {/* 国家在名字前、次级色紧挨名字；只有国名会被截，事件名不截。 */}
              <em className="mk-mcell__country" data-mcell-country>{item.country}</em>
              {item.name}
              {/* 格内用紧凑记号（`×2`）：整句「本期 2 次」在当日列表那一行里，格子里塞句子会挤掉名字。 */}
              {item.releaseCount !== undefined && item.releaseCount > 1
                ? <em className="mk-mcell__repeat" data-release-count={item.releaseCount}>{`×${item.releaseCount}`}</em>
                : null}
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

type Item = Readonly<{ name: string; at: string; state: 'done' | 'todo'; metricKey: string; releaseCount?: number
  /** 短国名（与右列、卡片同一份解析）；没有国家就是 `—`。 */
  country: string }>
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
    items.push({
      name: event.title, at: event.scheduledAt, state: at <= nowMs ? 'done' : 'todo',
      metricKey: event.eventNameKey ?? event.measureKeys?.[0] ?? '',
      /**
       * 格子里也要看得到国家（用户 2026-11-19：「没国家我哪里知道谁是谁」）。
       * 走**同一份** `calendarCountryLabel`，只把兜底词换成 `—`——格子里不写「未知国家」。
       */
      country: calendarCountryLabel(event, { market: { unknownCountry: '—' } }),
      // 合并后同一期可能发过不止一次：次数跟着条目走，格子里才不会被当成一次。
      ...(event.releaseCount === undefined ? {} : { releaseCount: event.releaseCount })
    })
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
