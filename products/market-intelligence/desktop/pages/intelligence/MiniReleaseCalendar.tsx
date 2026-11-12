import { useEffect, useMemo, useState } from 'react'

import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'

import { LoadingState } from '@platform/ui/components/loading'

import type { MacroIndicatorDrawerText } from './macroIndicatorDrawerText'

/**
 * The drawer's mini release calendar: a 62px-cell dot grid, **not** the page's 200px month board.
 *
 * 数据是静的（`RELEASES`），但按钮都是真的：上/下月真的换月、回到本月真的回、刷新真的走一次
 * 等待态、配置真的跳到日历来源配置。静态页不等于假按钮——用户 2026-11-13 明确要求这一条。
 *
 * 月份与圆点数据照 `2026-11-13-K11-b.html` 里的 `CALMONTHS` 原样搬来。
 */
const TODAY = '2026-11-13'
const THIS_MONTH = '2026-11'

const RELEASES: Readonly<Record<string, readonly Readonly<{ day: number; state: 'done' | 'todo' }>[]>> = {
  '2026-09': [],
  '2026-10': [{ day: 29, state: 'done' }, { day: 30, state: 'done' }],
  '2026-11': [
    { day: 5, state: 'done' }, { day: 6, state: 'done' }, { day: 10, state: 'done' }, { day: 12, state: 'done' },
    { day: 13, state: 'todo' }, { day: 19, state: 'todo' }, { day: 26, state: 'todo' }
  ],
  '2026-12': [{ day: 4, state: 'todo' }, { day: 9, state: 'todo' }, { day: 10, state: 'todo' }, { day: 23, state: 'todo' }],
  '2027-01': [],
  '2027-02': [{ day: 4, state: 'todo' }, { day: 19, state: 'todo' }]
}

const MONTH_KEYS = Object.keys(RELEASES)

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

  const weeks = useMemo(() => buildWeeks(monthKey, RELEASES[monthKey] ?? []), [monthKey])
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
        {weeks.map((week, rowIndex) => week.map(cell => <div className="mk-minical__day" key={`${rowIndex}-${cell.dateKey}`}
          data-state={cell.current ? (cell.dateKey === TODAY && monthKey === THIS_MONTH ? 'today' : cell.mark ?? 'none') : 'outside'}>
          <em>{cell.day}</em>
          {cell.current && cell.mark !== undefined ? <i className={`mk-mdot mk-mdot--${cell.mark}`} /> : null}
        </div>))}
      </div>
      {refreshDone ? <p className="mk-minical__note" role="status">{text.minicalTools.refreshed}</p> : null}
      {weeks.every(week => week.every(cell => cell.mark === undefined)) ? <p className="mk-minical__empty">{text.minicalEmpty}</p> : null}
    </>}
  </section>
}

type Cell = Readonly<{ dateKey: string; day: number; current: boolean; mark?: 'done' | 'todo' }>

/** Six Monday-first weeks centred on the month, the same grid the design draws. */
function buildWeeks(monthKey: string, marks: readonly Readonly<{ day: number; state: 'done' | 'todo' }>[]): readonly (readonly Cell[])[] {
  const [year, month] = monthKey.split('-').map(Number) as [number, number]
  const first = new Date(Date.UTC(year, month - 1, 1))
  const startOffset = (first.getUTCDay() + 6) % 7
  const start = new Date(Date.UTC(year, month - 1, 1 - startOffset))
  const markByDay = new Map(marks.map(mark => [mark.day, mark.state]))
  const weeks: Cell[][] = []
  for (let row = 0; row < 6; row += 1) {
    const week: Cell[] = []
    for (let column = 0; column < 7; column += 1) {
      const at = new Date(start.getTime() + (row * 7 + column) * 86_400_000)
      const inMonth = at.getUTCMonth() === month - 1
      const day = at.getUTCDate()
      const dateKey = at.toISOString().slice(0, 10)
      week.push({ dateKey, day, current: inMonth, ...(inMonth && markByDay.has(day) ? { mark: markByDay.get(day)! } : {}) })
    }
    weeks.push(week)
  }
  return weeks
}
