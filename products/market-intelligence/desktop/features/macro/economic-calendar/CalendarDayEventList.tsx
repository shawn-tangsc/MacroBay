import type { MarketCalendarSource } from '../../../../contracts/macro/marketCalendarQueryContracts'
import { CalendarEventRow } from './CalendarEventRow'
import type { CalendarDayCoverage, CalendarDayItem } from './economicCalendarDayModel'
import type { EconomicCalendarText } from './economicCalendarText'

/**
 * The day list under the month grid: one section per event type, sticky headings, one row per event.
 *
 * It was inline JSX inside `EconomicCalendar.tsx`. The 关键指标 drawer draws the same list, so the
 * structure moved here instead of being written twice — two copies drift the first time one of them
 * changes a heading, a truncation rule or the sticky top.
 *
 * It is presentational: every value arrives as a prop, and the caller keeps the selection state.
 */
export function CalendarDayEventList({ label, title, summary, groups, emptyText, listRef, hideGroupHeadings, missingValueLabel, marketSources, text, statusNow, selectedEventKey, selectedMarketKey, onSelect }: Readonly<{
  label: string
  /** The page scrolls this list to the top when the selected day changes; the drawer passes nothing. */
  listRef?: React.RefObject<HTMLElement | null>
  /** Already filled with the day; the caller owns the sentence. */
  title: string
  /**
   * 标题行右侧的计数。**只写一个数**（例如「与利率相关 2 条」），不放第二个数——
   * 300px 里两个数会把标题挤掉，而第二个数本来就有自己那行可点展开。
   * 缺省（核心为 0）时右上角留白，不写「0 条」。
   */
  summary?: string
  groups: readonly Readonly<{ eventType: keyof EconomicCalendarText['market']['kinds']; items: readonly CalendarDayItem[] }>[]
  /** Shown only when the sources answered and the answer is zero; omitted means no sentence. */
  emptyText?: string
  /**
   * 展开态用：把分组标题也省掉（`true`）。抽屉右列展开「其他 N 条」时是一张平铺清单——
   * 再分三组标题会把 12 条撑成 15 行，展开就失去「临时看一眼」的意义。
   */
  hideGroupHeadings?: boolean
  /** 行尾「未提供」的文案；不给就不显示（日历页默认不给，抽屉右列给）。 */
  missingValueLabel?: string
  marketSources: readonly MarketCalendarSource[]
  text: EconomicCalendarText
  statusNow: string
  selectedEventKey: string | undefined
  selectedMarketKey: string | undefined
  /** `undefined` = 这一列没有可去的地方：行渲染成非交互形态，不画点头没反应的按钮。 */
  onSelect?: (item: CalendarDayItem) => void
}>): React.ReactElement {
  return <section aria-label={label} className="mi-calendar-day-list" data-calendar-day-list ref={listRef}>
    {/* 标题行两端对齐：左边标题、右边计数。计数原来单独占一段，窄栏（抽屉右列 300px）里会换行、
        和下面的分组标题挤在一起——用户看到的就是「几条重要什么的字样和内容重叠」。
        计数右对齐、不换行；放不下时**标题先省略**，计数保完整——它是读者判断「有没有被截断」的唯一依据。
        读序不变：标题在前、计数在后，仍在同一个标题行里。 */}
    <div className="mi-calendar-day-list__head">
      <h2>{title}</h2>
      {summary === undefined || summary === '' ? null : <p data-day-summary>{summary}</p>}
    </div>
    <div role="list">{groups.map(group => <section data-calendar-group={group.eventType} key={group.eventType}>
      {hideGroupHeadings ? null : <h3>{text.unifiedDay.groupCount.replace('{type}', text.market.kinds[group.eventType]).replace('{count}', String(group.items.length))}</h3>}
      {group.items.map(item => <div role="listitem" key={item.key}><CalendarEventRow item={item} marketSources={marketSources} text={text} statusNow={statusNow} {...(missingValueLabel === undefined ? {} : { missingValueLabel })} selected={item.source === 'market' ? item.event.eventKey === selectedMarketKey : item.event.eventKey === selectedEventKey} onSelect={onSelect} /></div>)}
    </section>)}</div>
    {/* A quiet day is a reading, not a missing block: the sources answered and the answer is
        zero. It carries no action because nothing the reader can press would produce events, and a
        button that does nothing is worse than none. The sentence stays visible so a blank area
        cannot be mistaken for "not loaded yet". */}
    {emptyText === undefined ? null : <p>{emptyText}</p>}
  </section>
}

/** The one sentence above the groups: a partial read says so instead of claiming a total. */
export function calendarDaySummary(coverage: CalendarDayCoverage, count: number, text: EconomicCalendarText): string {
  return `${coverage === 'complete' ? text.unifiedDay.total.replace('{count}', String(count)) : text.unifiedDay[coverage]} · ${text.unifiedDay.grouped}`
}
