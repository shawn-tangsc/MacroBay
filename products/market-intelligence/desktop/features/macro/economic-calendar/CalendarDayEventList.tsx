import { Tabs } from '@platform/ui/components/tabs'
import type { ChoiceItem } from '@platform/ui/components/choice/choiceItem'
import type { MarketCalendarSource } from '../../../../contracts/macro/marketCalendarQueryContracts'
import type { UnmappedCalendarObservation } from '../../../../service/intelligence/macro-calendar/rendering/marketCalendarUnmappedMonthRead'
import { CalendarEventRow } from './CalendarEventRow'
import { UnmappedCalendarEventRow } from './UnmappedCalendarEventRow'
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
export function CalendarDayEventList({ label, title, summary, groups, emptyText, listRef, hideGroupHeadings, missingValueLabel, marketSources, text, statusNow, selectedEventKey, selectedMarketKey, onSelect, sourceTabs, repeatCountLabel }: Readonly<{
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
  groups: readonly Readonly<{
    eventType: keyof EconomicCalendarText['market']['kinds']
    /** 覆盖默认的「类型 · N 条」标题（抽屉在组内再分了子组时，总数要从外面给）。 */
    title?: string
    items: readonly CalendarDayItem[]
    /**
     * 组内再分的小组（抽屉里只有「经济指标」这一组用：一级/二级/未分级）。
     * 有子组时这一组自己不直接放行，行都在子组里——两层标题，不是两个平行的组。
     */
    subgroups?: readonly Readonly<{ title: string; items: readonly CalendarDayItem[] }>[]
  }>[]
  /** Shown only when the sources answered and the answer is zero; omitted means no sentence. */
  emptyText?: string
  /**
   * 展开态用：把分组标题也省掉（`true`）。抽屉右列展开「其他 N 条」时是一张平铺清单——
   * 再分三组标题会把 12 条撑成 15 行，展开就失去「临时看一眼」的意义。
   */
  hideGroupHeadings?: boolean
  /** 行尾「未提供」的文案；不给就不显示（日历页默认不给，抽屉右列给）。 */
  missingValueLabel?: string
  /** 「本期 N 次」的模板（含 `{count}`）；不给就不显示。 */
  repeatCountLabel?: string
  marketSources: readonly MarketCalendarSource[]
  text: EconomicCalendarText
  statusNow: string
  selectedEventKey: string | undefined
  selectedMarketKey: string | undefined
  /** `undefined` = 这一列没有可去的地方：行渲染成非交互形态，不画点头没反应的按钮。 */
  onSelect?: (item: CalendarDayItem) => void
  /**
   * 当天列表上方的两个 tab（用户 2026-11-16：两个来源不要混在一列，分 tab 切换看）。
   *
   * 分组只在渲染层：合并函数只管排序、去重、计数，`tab` 这个概念不进去。
   * 读不到时 `items` 里那项**不带计数**——数量未知写 `(0)` 就是把「读不到」画成「没有」。
   */
  sourceTabs?: Readonly<{
    value: string
    onChange: (value: string) => void
    items: readonly ChoiceItem[]
    ariaLabelKey: string
    resolveText: (key: string) => string
    unmapped: Readonly<{
      observations: readonly UnmappedCalendarObservation[]
      timeZone: string
      /** 读屏补的那句（行内不写：视觉上已经在那个 tab 里了）。 */
      aria: string
      emptyText: string
      emptyNote: string
      unavailableText: string
      unavailableNote: string
      /** 读不到：**不给 0 条**，给两句「读不到」。 */
      unavailable: boolean
    }>
  }>
}>): React.ReactElement {
  // One row body for both layers: a type heading over rows, or a type heading over tier subheadings.
  const renderRow = (item: CalendarDayItem): React.ReactElement => <div role="listitem" key={item.key}>
    <CalendarEventRow item={item} marketSources={marketSources} text={text} statusNow={statusNow}
      {...(missingValueLabel === undefined ? {} : { missingValueLabel })}
      {...(repeatCountLabel === undefined ? {} : { repeatCountLabel })}
      selected={item.source === 'market' ? item.event.eventKey === selectedMarketKey : item.event.eventKey === selectedEventKey}
      onSelect={onSelect} />
  </div>
  const standardBody = <>
    <div role="list">{groups.map(group => <section data-calendar-group={group.title ?? group.eventType} key={group.title ?? group.eventType}>
      {hideGroupHeadings ? null : <h3>{group.title ?? text.unifiedDay.groupCount.replace('{type}', text.market.kinds[group.eventType]).replace('{count}', String(group.items.length))}</h3>}
      {group.subgroups === undefined
        ? group.items.map(renderRow)
        : group.subgroups.map(subgroup => <section data-calendar-subgroup={subgroup.title} key={subgroup.title}>
            {hideGroupHeadings ? null : <h4>{subgroup.title}</h4>}
            {subgroup.items.map(renderRow)}
          </section>)}
    </section>)}</div>
    {/* A quiet day is a reading, not a missing block: the sources answered and the answer is
        zero. It carries no action because nothing the reader can press would produce events, and a
        button that does nothing is worse than none. The sentence stays visible so a blank area
        cannot be mistaken for "not loaded yet". */}
    {emptyText === undefined ? null : <p>{emptyText}</p>}
  </>
  const unmapped = sourceTabs?.unmapped
  const unmappedBody = unmapped === undefined ? null : unmapped.unavailable
    // 读不到：两句都说清「不是没有」。**不出 0 条**。
    ? <div data-unmapped-unavailable>
      <p>{unmapped.unavailableText}</p>
      <p className="mi-calendar-day-list__note">{unmapped.unavailableNote}</p>
    </div>
    : unmapped.observations.length === 0
      // 确实为空：与「读不到」是两件事，句子不许复用。
      ? <div data-unmapped-empty>
        <p>{unmapped.emptyText}</p>
        <p className="mi-calendar-day-list__note">{unmapped.emptyNote}</p>
      </div>
      : <div role="list">{unmapped.observations.map(observation => <div role="listitem" key={observation.key}>
        <UnmappedCalendarEventRow observation={observation} text={text} timeZone={unmapped.timeZone} unmappedAria={unmapped.aria} />
      </div>)}</div>
  return <section aria-label={label} className="mi-calendar-day-list" data-calendar-day-list ref={listRef}>
    {/* 标题行两端对齐：左边标题、右边计数。计数原来单独占一段，窄栏（抽屉右列 300px）里会换行、
        和下面的分组标题挤在一起——用户看到的就是「几条重要什么的字样和内容重叠」。
        计数右对齐、不换行；放不下时**标题先省略**，计数保完整——它是读者判断「有没有被截断」的唯一依据。
        读序不变：标题在前、计数在后，仍在同一个标题行里。 */}
    <div className="mi-calendar-day-list__head">
      <h2>{title}</h2>
      {summary === undefined || summary === '' ? null : <p data-day-summary>{summary}</p>}
    </div>
    {/* 两个来源分两个 tab（用户 2026-11-16）：全部渲染、非活动的只加 `hidden`，切回来时
        选中项与会话都还在——那是 `Tabs` 已经订好的行为，这里不重写。 */}
    {sourceTabs === undefined ? standardBody : <Tabs items={sourceTabs.items} value={sourceTabs.value}
      onChange={sourceTabs.onChange} ariaLabelKey={sourceTabs.ariaLabelKey} resolveText={sourceTabs.resolveText}
      panels={{ standard: standardBody, unmapped: unmappedBody }} />}
  </section>
}

/** The one sentence above the groups: a partial read says so instead of claiming a total. */
export function calendarDaySummary(coverage: CalendarDayCoverage, count: number, text: EconomicCalendarText): string {
  return `${coverage === 'complete' ? text.unifiedDay.total.replace('{count}', String(count)) : text.unifiedDay[coverage]} · ${text.unifiedDay.grouped}`
}
