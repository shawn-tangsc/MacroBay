import { CalendarDays, Copy, RefreshCw } from 'lucide-react'
import { Button, Tooltip } from 'antd'
import type { CrossAssetId } from '../../../contracts/crossAssetObservationContracts'
import { formatReadableAnalysisValue, readableAnalysisName } from '../../../contracts/marketAnalysisReadableText'
import { crossAssetSignedValue } from '../../features/industry/cross-asset/crossAssetFormat'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import { useSampleNow } from './SampleModeProvider'
import { calendarCardReactionPolicy } from './calendarCardReaction'
import type { MarketAnalysisReadableNames } from '../../../contracts/marketAnalysisReadableText'
import type { CalendarCardProjection, CalendarCardRow } from './projectUpcomingCalendarCard'

/**
 * The right column's calendar card: what to watch, read-only.
 *
 * It renders whatever the projection produced and never fetches; opening an event or the
 * full calendar is the caller's business, so this component stays a pure presentation of
 * rows plus two callbacks.
 */

export type MarketCalendarCardText = Readonly<{
  title: string; todaySection: string; upcomingSection: string; empty: string; unavailable: string; refresh: string
  awaitingData: string
  /** 反应行的悬停说明；窗口长度不再作为一个可见标签占位。 */
  reactionHint: string
  openCalendar: string; importanceHigh: string; timePending: string; copyEvent: string; openEventInCalendar: string
  /**
   * 预期差的四种语态。`unavailable` 是「没有一致预期」，`notComparable` 是「有预期但算不出量」；
   * 两者都不得出现任何数字当差值。
   */
  surprise: Readonly<Record<'beat' | 'miss' | 'inline' | 'unavailable' | 'notComparable', string>>
  categories: Readonly<Record<'economic-indicator' | 'financial-event' | 'central-bank-activity', string>>
  /** 三条线的名字：跨资产那份词表（`crossAsset.assets`），卡片不再抄一份。 */
  assets: Readonly<Record<CrossAssetId, string>>
  /** The dollar's own label: it is a macro-proxy curve, not one of the three collected symbols. */
  dxy: string
  /**
   * 指标与事件名的读法。这张卡是日历正文（chrome），跟着界面语言；只有已发布的分析正文才固定用
   * 模型输出语言（见 `conclusionReadableNames`）。
   */
  readableNames: MarketAnalysisReadableNames
}>

export function MarketCalendarCard({ projection, text, onOpenCalendar, onRefresh, onSelectEvent, onOpenEventInCalendar, selectedEventKey }: Readonly<{
  projection: CalendarCardProjection
  text: MarketCalendarCardText
  onOpenCalendar: (month: string) => void
  onRefresh?: () => void
  /** Selecting a row is what feeds the agent: the label is the row's own readable line. */
  onSelectEvent?: (eventKey: string, label: string, month: string) => void
  /**
   * Opening the whole calendar at one event. A row click already means "select as context", so
   * this is its own control rather than the row's default action.
   */
  onOpenEventInCalendar?: (eventKey: string, month: string) => void
  selectedEventKey?: string
}>): React.ReactElement {
  const formatTime = useShellTimeFormat()
  // 示例模式下月份兜底走场景时钟，否则卡片会去查一个没有示例数据的月份。
  const sampleNow = useSampleNow()
  // `formatShellInstant` returns `YYYY-MM-DD HH:mm GMT±n`; the card column is narrow, so it
  // shows the day and the clock and leaves the zone to the settings that produced it.
  const stamp = (entry: CalendarCardRow): string => {
    if (!entry.at) return `${entry.date.slice(5)} ${text.timePending}`
    const formatted = formatTime(entry.at, 'minute')
    return `${formatted.slice(5, 10)} ${formatted.slice(11, 16)}`
  }
  const month = projection.upcoming[0]?.month ?? projection.today[0]?.month ?? sampleNow().toISOString().slice(0, 7)
  const locale = useShellLanguage()
  const valuesOf = (entry: CalendarCardRow): string => [
    entry.kind === 'released-changed' && entry.actual ? `${readableAnalysisName(text.readableNames, 'metric', 'actual')} ${entry.actual}` : null,
    entry.consensus ? `${readableAnalysisName(text.readableNames, 'metric', 'consensus')} ${entry.consensus}` : null,
    entry.previous ? `${readableAnalysisName(text.readableNames, 'metric', 'previous')} ${entry.previous}` : null
  ].filter(Boolean).join(' · ')
  /**
   * The row's surprise sentence. It never prints a number when there is no comparable magnitude:
   * "无一致预期" and "预期差不可比" are statements about missing data, not a difference of zero.
   */
  const surpriseText = (entry: CalendarCardRow): string => {
    const surprise = entry.surprise
    if (surprise.direction === 'consensus-unavailable') {
      return surprise.reason === 'missing-consensus' ? text.surprise.unavailable : text.surprise.notComparable
    }
    if (surprise.direction === 'inline') return text.surprise.inline
    const number = surprise.value !== null && surprise.unit !== null
      ? formatReadableAnalysisValue(surprise.value, surprise.unit, locale)
      : null
    return number === null ? text.surprise[surprise.direction] : `${text.surprise[surprise.direction]} ${number}`
  }
  const surpriseState = (entry: CalendarCardRow): 'beat' | 'miss' | 'inline' | 'unavailable' =>
    entry.surprise.direction === 'consensus-unavailable' ? 'unavailable' : entry.surprise.direction
  /**
   * When the row can state a concrete surprise, the verdict replaces the three readings.
   *
   * `3.4%` and `3.1%` are what the reader would subtract themselves; the card's job is the answer,
   * not the arithmetic. The readings stay in the drawer, and they stay on the card when there is no
   * displayable magnitude (a bare expectation of zero, no consensus, or an in-line print).
   */
  const statesSurprise = (entry: CalendarCardRow): boolean =>
    (entry.surprise.direction === 'beat' || entry.surprise.direction === 'miss') &&
    entry.surprise.value !== null && entry.surprise.unit !== null
  /**
   * "No consensus" is not a verdict, it is the absence of one; when the readings are shown they
   * already say that, so the row does not repeat it as a badge. An incomparable pair keeps its
   * badge: the readings are there but the reader still needs to know why no difference is stated.
   */
  const showsSurpriseBadge = (entry: CalendarCardRow): boolean =>
    entry.actual !== null &&
    !(entry.surprise.direction === 'consensus-unavailable' && entry.surprise.reason === 'missing-consensus')
  /** A reaction row is only worth drawing when at least one line actually moved. */
  const hasReactionSignal = (entry: CalendarCardRow): boolean =>
    entry.reaction !== undefined && calendarCardReactionPolicy.displayOrder.some(asset => {
      const value = entry.reaction?.[asset]
      return value !== null && value !== undefined && value !== 0
    })
  /** What a reader gets on the clipboard: the same line they are looking at, plus the verdict. */
  const rowText = (entry: CalendarCardRow): string => [
    stamp(entry),
    text.categories[entry.category],
    readableAnalysisName(text.readableNames, 'eventName', entry.titleKey),
    statesSurprise(entry) ? null : valuesOf(entry),
    // The verdict is its own line on screen; on the clipboard it is appended so a pasted row still
    // says whether the print surprised the market.
    showsSurpriseBadge(entry) ? surpriseText(entry) : null
  ].filter(Boolean).join(' ')
  const row = (entry: CalendarCardRow) => (
    <li key={entry.eventKey}>
      {/* A row is selectable as the agent's context, and its text is also copyable; the copy
          button lives inside, so the row itself is a div with button semantics rather than a
          nested button (which would be invalid markup). */}
      <div className="mi-calendar-card__row" data-calendar-card-row={entry.kind}
        data-selected={selectedEventKey === entry.eventKey ? 'true' : undefined}
        role={onSelectEvent ? 'button' : undefined} tabIndex={onSelectEvent ? 0 : undefined}
        aria-pressed={onSelectEvent ? selectedEventKey === entry.eventKey : undefined}
        onClick={onSelectEvent ? () => onSelectEvent(entry.eventKey, rowText(entry), entry.month) : undefined}
        onKeyDown={onSelectEvent ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectEvent(entry.eventKey, rowText(entry), entry.month) } } : undefined}>
        {/* Two semantic columns. Left is the row's metadata rail: when it is, and what kind of
            event it is — both right-aligned to the same gutter so the reader scans a clean time
            axis. Right is the event itself: its name, the three values, the verdict, the reaction. */}
        <span className="mi-calendar-card__row-when">
          {/* Date and clock when the source published a time; day plus an explicit "pending" when
              it did not, rather than a fabricated hour. */}
          <time>{stamp(entry)}</time>
          {/* The category is colour-coded so indicators, financial events and central-bank
              activity are told apart at a glance. */}
          <em className="mi-calendar-card__row-kind" data-kind={entry.category}>{text.categories[entry.category]}</em>
        </span>
        <span className="mi-calendar-card__row-main">
          <span className="mi-calendar-card__row-title">
            {/* Where the event is, which the 0xRouter route publishes and the official one does not:
                a list of indicators without countries is unreadable once two of them share a name. */}
            {entry.countryName ? <em className="mi-calendar-card__row-country" data-country>{entry.countryName}</em> : null}
            {readableAnalysisName(text.readableNames, 'eventName', entry.titleKey)}
          </span>
          {statesSurprise(entry) ? null : <span className="mi-calendar-card__row-value">{valuesOf(entry)}</span>}
          {/* 预期差单独一行：三种语态共用同一个契约判断，且「无一致预期 / 不可比」都不出现数字。 */}
          {showsSurpriseBadge(entry) ? <em className="mi-calendar-card__row-surprise" data-calendar-surprise={surpriseState(entry)}>
            {surpriseText(entry)}
          </em> : null}
          {/* 计划时刻已过、值还没到：说在等，而且就写在这一行上——读者要的是「哪一个在等」。 */}
          {entry.awaitingData ? <small className="mi-calendar-card__row-waiting" data-calendar-card-waiting>{text.awaitingData}</small> : null}
        </span>
        <span className="mi-calendar-card__row-tools">
          {/* The row's own click selects this event for the agent, so opening it in the calendar
              needs its own control. Like copying, it must not reach the row's handler. */}
          {onOpenEventInCalendar ? <button aria-label={`${text.openEventInCalendar} ${readableAnalysisName(text.readableNames, 'eventName', entry.titleKey)}`}
            className="mi-calendar-card__open-event" type="button"
            onClick={event => {
              event.stopPropagation()
              onOpenEventInCalendar(entry.eventKey, entry.month)
            }}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation() }}>
            <CalendarDays aria-hidden="true" size={12} />
          </button> : null}
          <button aria-label={`${text.copyEvent} ${readableAnalysisName(text.readableNames, 'eventName', entry.titleKey)}`}
            className="mi-calendar-card__copy" type="button"
            onClick={event => {
              // Copying is not selecting: the click must not reach the row's own handler.
              event.stopPropagation()
              void navigator.clipboard?.writeText(rowText(entry)).catch(() => undefined)
            }}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation() }}>
            <Copy aria-hidden="true" size={12} />
          </button>
          {/* Only the top tier gets a marker; medium rows stay quiet rather than being badged. */}
          <em aria-hidden={entry.importance !== 'high'} aria-label={entry.importance === 'high' ? text.importanceHigh : undefined}
            className="mi-calendar-card__importance" data-importance={entry.importance} />
        </span>
        {/* 反应行从内容列起、跨到卡片右缘：与标题/读数同一条左基线，又借用工具列那一点宽度，
            四条线才不会被拆成孤行；真的不够时才允许换行。零值不印，整行都平就不画。 */}
        {entry.kind === 'released-changed' && hasReactionSignal(entry) ? <Tooltip mouseEnterDelay={0.05} placement="top" title={text.reactionHint}>
          <small className="mi-calendar-card__row-reaction" data-calendar-card-reaction>
            {calendarCardReactionPolicy.displayOrder.map(asset => {
              const value = entry.reaction?.[asset]
              if (value === null || value === undefined || value === 0) return null
              const label = asset === 'dxy' ? text.dxy : text.assets[asset]
              return <span key={asset} data-reaction-asset={asset}>{label} {crossAssetSignedValue(value, '%')}</span>
            })}
          </small>
        </Tooltip> : null}
      </div>
    </li>
  )
  return <section className="mi-calendar-card" aria-label={text.title}>
    <header>
      <h2>{text.title}</h2>
      <button aria-label={text.openCalendar} className="mi-calendar-card__open" onClick={() => onOpenCalendar(month)} type="button"><CalendarDays aria-hidden="true" size={15} /></button>
    </header>
    {projection.state === 'unavailable' ? <p className="mi-calendar-card__state">{text.unavailable}
      {onRefresh ? <Button icon={<RefreshCw aria-hidden="true" size={13} />} onClick={onRefresh} size="small" type="link">{text.refresh}</Button> : null}
    </p> : null}
    {projection.state === 'empty' ? <p className="mi-calendar-card__state">{text.empty}</p> : null}
    {projection.today.length > 0 ? <>
      <p className="mi-calendar-card__section">{text.todaySection}</p>
      <ul className="mi-calendar-card__list">{projection.today.map(row)}</ul>
    </> : null}
    {projection.upcoming.length > 0 ? <>
      <p className="mi-calendar-card__section">{text.upcomingSection}</p>
      <ul className="mi-calendar-card__list">{projection.upcoming.map(row)}</ul>
    </> : null}
  </section>
}
