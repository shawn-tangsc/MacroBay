import { useEffect, useMemo, useState } from 'react'

import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'

import { LoadingState } from '@platform/ui/components/loading'

import type { MacroIndicatorDrawerText } from './macroIndicatorDrawerText'

/**
 * The drawer's mini release calendar: a month grid whose cells **list the releases by name**
 * (up to three, then a「N 条重要」count), not a dot grid.
 *
 * 契约照 `2026-11-13-K11-b.html` 的 `CALMONTHS`：每格是 `[短名, 状态]` 的数组，格内最多三行
 * 「圆点 + 短名」，第 4 条起在右下角显示「N 条重要」（原型 `mcell__more`）。行高下限 63.8
 * （日期 + 3 行 + 行距 + 内边距 + 边框）；装不下按文档退回正文滚动，不砍事件行。
 *
 * 按钮都是真的：上/下月换月、回到本月当月禁用、刷新走平台等待态、配置去来源配置。
 */
const TODAY = '2026-11-13'
const THIS_MONTH = '2026-11'

type Item = Readonly<{ name: string; state: 'done' | 'todo' }>

/** 月份 → 日 → 事件短名。照原型的 `CALMONTHS` 搬来。 */
const RELEASES: Readonly<Record<string, Readonly<Record<number, readonly Item[]>>>> = {
  '2026-09': {},
  '2026-10': {
    29: [{ name: 'PCE 核心', state: 'done' }],
    30: [{ name: '初请失业金', state: 'done' }]
  },
  '2026-11': {
    5: [{ name: '初请失业金', state: 'done' }],
    6: [{ name: '新增就业', state: 'done' }, { name: '消费者信心', state: 'done' }],
    10: [{ name: 'CPI 年率', state: 'done' }],
    12: [{ name: '初请失业金', state: 'done' }],
    13: [
      { name: 'PPI 年率', state: 'todo' }, { name: '零售销售', state: 'todo' },
      { name: '消费者信心', state: 'todo' }, { name: '初请失业金', state: 'todo' },
      { name: '通胀预期 1 年', state: 'todo' }
    ],
    19: [
      { name: '初请失业金', state: 'todo' }, { name: '零售销售', state: 'todo' },
      { name: '通胀预期 1 年', state: 'todo' }
    ],
    26: [{ name: '初请失业金', state: 'todo' }]
  },
  '2026-12': {
    4: [{ name: '新增就业', state: 'todo' }],
    9: [{ name: '政策利率', state: 'todo' }],
    10: [{ name: 'CPI 年率', state: 'todo' }],
    23: [{ name: 'PCE 核心', state: 'todo' }]
  },
  '2027-01': {},
  '2027-02': {
    4: [{ name: '新增就业', state: 'todo' }],
    19: [{ name: 'CPI 年率', state: 'todo' }]
  }
}

const MONTH_KEYS = Object.keys(RELEASES)
/** 每格最多列三条；第 4 条起只报数。 */
const CELL_ITEM_LIMIT = 3

export function MiniReleaseCalendar({ text, onConfigure }: Readonly<{
  text: MacroIndicatorDrawerText
  /** 去日历来源配置；没有落点时按钮禁用，而不是画一颗点了没反应的假按钮。 */
  onConfigure?: () => void
}>): React.ReactElement {
  const [monthKey, setMonthKey] = useState(THIS_MONTH)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshDone, setRefreshDone] = useState(false)

  const index = MONTH_KEYS.indexOf(monthKey)
  const atStart = index <= 0
  const atEnd = index === MONTH_KEYS.length - 1
  const backDisabled = monthKey === THIS_MONTH

  useEffect(() => {
    if (!refreshing) return
    const timer = setTimeout(() => { setRefreshing(false); setRefreshDone(true) }, 600)
    return () => clearTimeout(timer)
  }, [refreshing])

  useEffect(() => {
    if (!refreshDone) return
    const timer = setTimeout(() => setRefreshDone(false), 1600)
    return () => clearTimeout(timer)
  }, [refreshDone])

  const weeks = useMemo(() => buildWeeks(monthKey, RELEASES[monthKey] ?? {}), [monthKey])
  const noReleases = Object.keys(RELEASES[monthKey] ?? {}).length === 0
  const [year, month] = monthKey.split('-')

  return <section className="mk-minical" aria-label={text.minicalTitle}>
    <div className="mk-minical__h">
      <h3>{text.minicalMonth.replace('{year}', year!).replace('{month}', String(Number(month)))} · {text.minicalTitle}</h3>
      <span className="mk-minical__lg">
        <i className="mk-mdot mk-mdot--done" />{text.minicalLegend.done}
        <i className="mk-mdot mk-mdot--todo" />{text.minicalLegend.todo}
        <i className="mk-mdot mk-mdot--today" />{text.minicalLegend.today}
      </span>
      <span className="mk-minical__tools">
        <button className="mk-iconbtn" type="button" aria-label={text.minicalTools.prev} disabled={atStart}
          onClick={() => setMonthKey(MONTH_KEYS[Math.max(0, index - 1)]!)}><ChevronLeft aria-hidden="true" size={14} /></button>
        <button className="mk-iconbtn" type="button" aria-label={text.minicalTools.next} disabled={atEnd}
          onClick={() => setMonthKey(MONTH_KEYS[Math.min(MONTH_KEYS.length - 1, index + 1)]!)}><ChevronRight aria-hidden="true" size={14} /></button>
        <button className="mk-textbtn" type="button" aria-label={text.minicalTools.back} disabled={backDisabled}
          onClick={() => setMonthKey(THIS_MONTH)}>{text.minicalTools.back}</button>
        <button className="mk-iconbtn" type="button" aria-label={text.minicalTools.refresh} onClick={() => setRefreshing(true)}>
          <RefreshCw aria-hidden="true" size={14} />
        </button>
        <button className="mk-textbtn" type="button" aria-label={text.minicalTools.configure} disabled={onConfigure === undefined}
          {...(onConfigure === undefined ? {} : { onClick: onConfigure })}>{text.minicalTools.configure}</button>
      </span>
    </div>
    {refreshing ? <div className="mk-minical__busy"><LoadingState layout="inline" size="sm" label={text.minicalTools.refreshing} /></div> : null}
    {refreshing ? null : <>
      <div className="mk-minical__wk">{text.weekday.map(day => <span key={day}>{day}</span>)}</div>
      <div className="mk-minical__grid">
        {weeks.map((week, rowIndex) => week.map(cell => {
          const shown = cell.items.slice(0, CELL_ITEM_LIMIT)
          const hidden = cell.items.length - shown.length
          const isToday = cell.current && cell.dateKey === TODAY && monthKey === THIS_MONTH
          return <div className="mk-minical__day" key={`${rowIndex}-${cell.dateKey}`}
            data-state={isToday ? 'today' : !cell.current ? 'outside' : noReleases ? 'nodata' : 'ready'}>
            <em>{cell.day}</em>
            {shown.map(item => <span className="mk-mcell__row" key={item.name}>
              <i className={`mk-mdot mk-mdot--${item.state}`} />{item.name}
            </span>)}
            {hidden > 0 ? <span className="mk-mcell__more">{text.minicalMore.replace('{count}', String(hidden))}</span> : null}
          </div>
        }))}
      </div>
      {noReleases ? <p className="mk-minical__nodata">{text.minicalNoData}</p> : null}
      {refreshDone ? <p className="mk-minical__note" role="status">{text.minicalTools.refreshed}</p> : null}
    </>}
  </section>
}

type Cell = Readonly<{ dateKey: string; day: number; current: boolean; items: readonly Item[] }>

/** Six Monday-first weeks centred on the month. */
function buildWeeks(monthKey: string, releases: Readonly<Record<number, readonly Item[]>>): readonly (readonly Cell[])[] {
  const [year, month] = monthKey.split('-').map(Number) as [number, number]
  const first = new Date(Date.UTC(year, month - 1, 1))
  const startOffset = (first.getUTCDay() + 6) % 7
  const start = new Date(Date.UTC(year, month - 1, 1 - startOffset))
  const weeks: Cell[][] = []
  for (let row = 0; row < 6; row += 1) {
    const week: Cell[] = []
    for (let column = 0; column < 7; column += 1) {
      const at = new Date(start.getTime() + (row * 7 + column) * 86_400_000)
      const inMonth = at.getUTCMonth() === month - 1
      const day = at.getUTCDate()
      week.push({
        dateKey: at.toISOString().slice(0, 10), day, current: inMonth,
        items: inMonth ? (releases[day] ?? []) : []
      })
    }
    weeks.push(week)
  }
  return weeks
}
