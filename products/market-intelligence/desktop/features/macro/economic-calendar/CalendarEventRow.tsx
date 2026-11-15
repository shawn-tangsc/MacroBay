import { Landmark, Newspaper, TrendingUp, type LucideIcon } from 'lucide-react'
import { Tooltip } from '@platform/ui/components/tooltip'
import type { MarketCalendarEvent, MarketCalendarSource } from '../../../../contracts/macro/marketCalendarQueryContracts'
import { useProductTextKey } from '../../../shared/i18n/productTextKey'
import type { EconomicCalendarText } from './economicCalendarText'
import { calendarItemType, isHighImportanceCalendarItem, type CalendarDayItem } from './economicCalendarDayModel'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { calendarEventStatus } from './calendarEventStatusModel'
import { calendarCountryLabel } from './calendarCountryLabel'

/* 这份样式表是这一族行与列表的**加载点**：以前由旧日历页 import，页面一删就没人加载，
   抽屉里的时刻与标题会挤成一行（用户 2026-11-15 报的正是这个）。挂着的是最终会渲染的那片叶子
   组件，页面层加不加都不影响它。守卫 `economicCalendarCssLoaded.test.ts` 盯着它不许变成「只被测试读」。 */
import './economicCalendar.css'

/**
 * One glyph per kind, so a cell that mixes kinds says which row is which at a glance. The day list
 * groups by kind under headings instead, but its rows are the same rows.
 */
const calendarKindGlyphs: Record<MarketCalendarEvent['eventType'], LucideIcon> = {
  'economic-indicator': TrendingUp,
  'financial-event': Newspaper,
  'central-bank-activity': Landmark
}

export function CalendarEventRow({ item, text, statusNow, onSelect, marketSources = [], selected = false, missingValueLabel }: {
  item: CalendarDayItem; text: EconomicCalendarText; statusNow: string
  /**
   * `undefined` = 这一行**没有动作**：渲染成非交互的行，不画按钮、不可聚焦、没有悬停指针。
   * 用它比传一个 `() => undefined` 好——后者长得像能点，点了什么也不发生（假控件）。
   */
  onSelect?: (item: CalendarDayItem) => void
  /** Source-level state for this page. Only the market route can carry a storage-limit verdict. */
  marketSources?: readonly MarketCalendarSource[]; selected?: boolean
  /**
   * 行尾「未提供」的文案。给了才显示，且**只给经济指标行**——事件型（讲话/会议/报告）本来就没有
   * 「缺值」这个概念，标上会把「源说发布了却没给数」和「这类事件永远没有数」混成一团。
   */
  missingValueLabel?: string
}) {
  const title = item.source === 'market' ? item.event.title : text.events[item.event.labelKey]
  const time = item.time ?? text.unifiedDay.timePending
  const attempt = item.source === 'market'
    ? marketSources.find(source => source.eventType === item.event.eventType)?.latestAttempt
    : undefined
  const status = calendarEventStatus(item, statusNow, useShellTimeZone(), attempt)
  // `dataText` still takes the resolver: the type keeps both branches the same shape, and a caller
  // that switches this hint to a key later must not also have to find a new resolver.
  const resolveText = useProductTextKey()
  // The 0xRouter route carries the country; the official route is US-only and says so in its own
  // copy, so a country chip there would be noise. 名字优先，查不到就**原样显示源给的国家码**
  // （`calendarCountryLabel`）：名字 → 原始码 → 「未知国家」，三级只在那里判一次
  // （用户 2026-11-16 定了两次：先「名字是什么就显示什么」，再「没有国家数据时显示未知国家」）。
  const country = item.source === 'market' ? calendarCountryLabel(item.event, text) : undefined
  const kind = calendarItemType(item)
  const KindGlyph = calendarKindGlyphs[kind]
  const important = isHighImportanceCalendarItem(item)
  // The kind and the importance ride in the description so the marks have names: the accessible label
  // and the hover text both say them, rather than leaving the reader to decode two glyphs.
  const importanceNote = important ? ` · ${text.details.importance} ${text.importance.high}` : ''
  // 「已发布却没值」：时刻已过、来源没给实际值，且这是**指标**行。事件型永远不加。
  const missingValue = missingValueLabel !== undefined && status === 'awaiting-data' && kind === 'economic-indicator'
  const description = `${time} ${text.market.kinds[kind]} ${country ? `${country} ` : ''}${title}${missingValue ? ` · ${missingValueLabel}` : ''} · ${text.eventStatus[status]}${importanceNote}`
  // The description is runtime data (time, title, status), not a sentence from the text table, so it
  // goes through `dataText`. The hint is the same line on hover and on focus; the accessible name is
  // that same line — it used to repeat the time, because the template added it a second time.
  //
  // 整行即动作，平台组件表达不了：`Choice` 会把一条已发布的事件变成「可选中项」（语义错），换平台
  // 按钮又会把行内的时间、种类字形、标题一起包成一颗文字按钮——那正是用户否过的样子。所以这里保留
  // 原生 `<button>`：`aria-label` 给名字（同一句也做悬停提示）、原生按钮自带键盘可达、
  // `.mi-economic-calendar__event:hover` 给悬停反馈。用户 2026-11-09 判决：保留，别当漏换的裸按钮。
  //
  // 没有 `onSelect` 时没有动作可做，就**不能**画成按钮：同样的内容用 `div` 渲染，行高与栅格不变，
  // 但不可聚焦、无悬停反馈、无障碍树里也不是控件。
  const shared = {
    className: 'mi-economic-calendar__event',
    'data-market-event': item.source === 'market' ? item.event.eventKey : undefined,
    'data-calendar-row': true,
    'data-importance': important ? 'high' : item.source === 'market' ? item.event.importance : undefined,
    'data-event-status': status
  } as const
  const titleText = missingValue ? `${title} · ${missingValueLabel}` : title
  return <Tooltip dataText={description} resolveText={resolveText}>
    {onSelect === undefined
      ? <div {...shared}>
        <RowContent time={time} kind={kind} important={important} country={country} title={titleText} KindGlyph={KindGlyph} />
      </div>
      : <button {...shared} data-event-key={item.source === 'official' ? item.event.eventKey : undefined}
        type="button" aria-label={description} aria-pressed={selected} onClick={() => onSelect(item)}>
        <RowContent time={time} kind={kind} important={important} country={country} title={titleText} KindGlyph={KindGlyph} />
      </button>}
  </Tooltip>
}

/** 行内内容：按钮态与非交互态必须一模一样，所以只有一份。 */
function RowContent({ time, kind, important, country, title, KindGlyph }: {
  time: string; kind: MarketCalendarEvent['eventType']; important: boolean
  country: string | undefined; title: string; KindGlyph: LucideIcon
}) {
  return <>
      <span className="mi-economic-calendar__event-time">{time}</span>
      {/*
        国家是**固定的第二列**（用户 2026-11-16 第二次要求「事件前面要显示国家」）：列宽由
        `--mi-calendar-country-width` 给，这一格**永远渲染**——没有国家时是空串。少了这个元素，
        标题会掉进这一列、整列错位；有了它，有没有国家的事件标题都从同一个 x 开始。

        以前它是标题内的行内片段（当时为了省下窄月格里的宽度），代价是「查不到名字就整格消失」，
        而用户要的正是「事件前面必须显示国家」。所以那一版判断在 2026-11-16 被推翻：宁可少几像素
        标题宽度，也不让国家列时有时无。
      */}
      <span className="mi-economic-calendar__event-country" data-event-country={country ?? undefined}>{country}</span>
      {/* The marks sit inside the title: the kind glyph leads the run so it lines up down the column,
          and the importance dot follows it directly ahead of the name. */}
      <span className="mi-economic-calendar__event-title">
        <span aria-hidden="true" className="mi-economic-calendar__event-kind" data-event-kind={kind}><KindGlyph size={11} /></span>
        {important ? <span aria-hidden="true" className="mi-economic-calendar__event-marker" data-importance-marker="high" /> : null}
        {title}
      </span>
  </>
}
