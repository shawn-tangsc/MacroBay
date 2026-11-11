import { CalendarDays, CircleDashed, CircleSlash, Copy, RefreshCw, TriangleAlert } from 'lucide-react'
import { Button, Tooltip } from 'antd'

import { IconButton } from '@platform/ui/components/icon-button'

import { openIntelligenceSourcesSettings } from '../../shared/navigation/productShellNavigation'
import type { CalendarCardSourcesState } from './useCalendarCardData'

import '../../shared/styles/sourceAvailability.css'
import { LoadingState } from '@platform/ui/components/loading'
import { StateView, STATE_VIEW_ACTION_KEYS } from '@platform/ui/components/state'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import { calendarUpcomingPolicy } from './calendarUpcomingPolicy'
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
  /** Shown until the first read answers; never an error on the first frame. */
  loading: string
  /** Shown over rows kept from an earlier successful read, when the newest read failed. */
  staleNotice: string
  /** Says its own window: an empty section must read as «nothing was released in N days», never as «no data». */
  releasedEmpty: string
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

export function MarketCalendarCard({ projection, state = 'ready', stale = false, sourcesState = 'available', text, onOpenCalendar, onRefresh, onSelectEvent, onOpenEventInCalendar, selectedEventKey }: Readonly<{
  projection: CalendarCardProjection
  /** 来源三态：没配置 / 没启用时整卡一句 + 一个动作；只有 `available` 才画事件。 */
  sourcesState?: CalendarCardSourcesState
  /** `loading` is its own state: nothing on screen may turn it into an error. */
  state?: 'loading' | 'ready' | 'error'
  /** Rows came from an earlier read; the newest attempt failed. */
  stale?: boolean
  text: MarketCalendarCardText
  onOpenCalendar: (month: string) => void
  /**
   * Re-reading the card's months. Required, not optional: the failure state carries a retry action, and a
   * retry that does nothing is worse than no retry. The dashboard always passes its reload.
   */
  onRefresh: () => void
  /** Selecting a row is what feeds the agent: the label is the row's own readable line. */
  onSelectEvent?: (eventKey: string, label: string, month: string) => void
  /**
   * Opening the whole calendar at one event. A row click already means "select as context", so
   * this is its own control rather than the row's default action.
   */
  onOpenEventInCalendar?: (eventKey: string, month: string) => void
  selectedEventKey?: string
}>): React.ReactElement {
  const resolveKey = useProductTextKey()
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
          {onOpenEventInCalendar ? <span
            className="mi-calendar-card__row-tool" data-calendar-row-action="open-event"
            onClick={event => { event.stopPropagation() }}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation() }}>
            <IconButton
              ariaLabelKey="pages.intelligence.portal.calendarCard.openEventInCalendar"
              ariaLabelParams={{ name: readableAnalysisName(text.readableNames, 'eventName', entry.titleKey) ?? '' }}
              icon={CalendarDays}
              onSelect={() => onOpenEventInCalendar(entry.eventKey, entry.month)}
              resolveText={resolveKey}
              size="sm"
            />
          </span> : null}
          <span
            className="mi-calendar-card__row-tool" data-calendar-row-action="copy"
            onClick={event => { event.stopPropagation() }}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation() }}>
            {/* Copying is not selecting: the click must not reach the row's own handler. */}
            <IconButton
              ariaLabelKey="pages.intelligence.portal.calendarCard.copyEvent"
              ariaLabelParams={{ name: readableAnalysisName(text.readableNames, 'eventName', entry.titleKey) ?? '' }}
              icon={Copy}
              onSelect={() => { void navigator.clipboard?.writeText(rowText(entry)).catch(() => undefined) }}
              resolveText={resolveKey}
              size="sm"
            />
          </span>
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
  /**
   * 遮罩只在「一条源都用不了」时出现：来源三态（没配置/没启用）或这一读没读出来。
   * 部分可用不遮——那会把能看的事件一起挡掉。
   */
  const veil: 'missing' | 'disabled' | 'unreadable' | undefined = sourcesState !== 'available'
    ? sourcesState
    : state === 'error' ? 'unreadable' : undefined
  return <section className="mi-calendar-card" aria-label={text.title}>
    <header>
      <h2>{text.title}</h2>
      <IconButton icon={CalendarDays} size="md" variant="plain" resolveText={resolveKey}
        ariaLabelKey="pages.intelligence.portal.calendarCard.openCalendar" onSelect={() => onOpenCalendar(month)} />
    </header>
    {/* Only the list scrolls. The header is the card's identity — the reader keeps seeing what
        they are looking at while scanning further down the schedule — so it stays outside the
        scroll region instead of travelling with the rows. */}
    <div className="mi-calendar-card__body" {...(veil === undefined ? {} : { 'data-veiled': 'true' })}>
      {/* 卡内三态（2026-11-11 终稿）：卡框与标题照常，**数据区照常渲染**，只在上面盖一层遮罩；
          遮罩里居中一句 + 恰一颗按钮，底下内容包 `inert`，Tab 只停在按钮上。
          只有一条源都用不了才盖；部分可用就照常列，不遮。
          `data-veiled` 同时打在**滚动容器**上：这一窗比内容矮时，遮罩要钉在窗里，不能跟着内容滚走。 */}
      <div className="mi-source-veil-host" {...(veil === undefined ? {} : { 'data-veiled': 'true' })}>
        <div {...(veil === undefined ? {} : { inert: true })}>
          {/* state-ternary: reviewed — 加载面板本身就是这一阶段唯一的呈现，没有第二个内容容器被状态位藏起 */}
          {veil === undefined && state === 'loading' ? <LoadingState label={text.loading} /> : null}
          {/* state-ternary: reviewed — 错误态用 StateView 呈现，此时没有可显示的行，不存在“藏内容” */}
          {veil === undefined && state === 'error' ? <StateView state="error" reasonCode="unreadable" size="md"
            action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: onRefresh }} /> : null}
          {/* state-ternary: reviewed — 这是一行 stale 提示，不决定任何内容容器画不画 */}
          {state === 'ready' && stale ? <p className="mi-calendar-card__state" data-calendar-card-stale>{text.staleNotice}</p> : null}
          {/* state-ternary: reviewed — 空态就是读数区的内容；由投影的 empty 判定，不是用状态位藏表格 */}
          {state === 'ready' && projection.state === 'empty' ? <p className="mi-calendar-card__state">{text.empty}</p> : null}
          {/* state-ternary: reviewed — 无发布事件时给说明；有行时走下面按长度的分支，内容不会被状态位藏掉 */}
          {state === 'ready' && projection.state === 'available' && projection.today.length === 0
            ? <p className="mi-calendar-card__state">{text.releasedEmpty.replace('{days}', String(calendarUpcomingPolicy.releasedWindowDays))}</p>
            : null}
          {/* state-ternary: reviewed — 按数据长度渲染（length > 0），state 只表示读取阶段，未就绪时上面已有 loading/error 分支 */}
          {state === 'ready' && projection.today.length > 0 ? <>
            <p className="mi-calendar-card__section">{text.todaySection}</p>
            <ul className="mi-calendar-card__list">{projection.today.map(row)}</ul>
          </> : null}
          {/* state-ternary: reviewed — 按数据长度渲染（upcoming.length > 0），state 只表示读取阶段，未就绪时上面已有 loading/error 分支 */}
          {state === 'ready' && projection.upcoming.length > 0 ? <>
            <p className="mi-calendar-card__section">{text.upcomingSection}</p>
            <ul className="mi-calendar-card__list">{projection.upcoming.map(row)}</ul>
          </> : null}
        </div>
        {veil === undefined ? null : <div className="mi-source-veil" data-state={veil}>
          <p className="mi-source-state" data-state={veil}>
            {veil === 'missing' ? <CircleDashed aria-hidden className="mi-source-state__icon" size={14} />
              : veil === 'disabled' ? <CircleSlash aria-hidden className="mi-source-state__icon" size={14} />
                : <TriangleAlert aria-hidden className="mi-source-state__icon" size={14} />}
            {resolveKey(veil === 'missing'
              ? 'pages.intelligence.portal.data.sourcesNotConfigured'
              : veil === 'disabled'
                ? 'pages.intelligence.portal.data.sourcesNotEnabled'
                : 'pages.intelligence.portal.data.temporarilyUnavailable')}
          </p>
          <Button onClick={veil === 'unreadable' ? onRefresh : () => openIntelligenceSourcesSettings()} size="small">
            {resolveKey(veil === 'missing'
              ? 'pages.intelligence.portal.data.configureSources'
              : veil === 'disabled'
                ? 'pages.intelligence.portal.data.enableSources'
                : 'pages.intelligence.portal.data.retry')}
          </Button>
        </div>}
      </div>
    </div>
  </section>
}
