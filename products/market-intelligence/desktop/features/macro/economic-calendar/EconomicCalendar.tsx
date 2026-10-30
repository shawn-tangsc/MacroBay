import { Button, DatePicker } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw, Settings2, Upload } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'

import type { MacroEconomicCalendarClient } from '../../../shared/ipc/macroEconomicCalendarClient'
import { NetworkProxyBanner } from '../../../shared/NetworkProxyBanner'
import { openIntelligenceSourcesSettings, openMacroCalendarSettings, openProxySettings } from '../../../shared/navigation/productShellNavigation'
import {
  createEconomicCalendarProjection,
  createEconomicCalendarQuery,
  economicCalendarCurrentMonth,
  economicCalendarGridMonths,
  isEconomicCalendarMonth,
  selectEconomicCalendarMonth,
  shiftEconomicCalendarMonth,
  type EconomicCalendarEventView,
  type EconomicCalendarProjection
} from './economicCalendarModel'
import { LoadingState } from '@platform/ui/components/loading'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { formatShellTimeZoneLabel } from '@platform/ui/time/shellTimeFormat'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import { CalendarInspector as DetailDrawer } from './CalendarInspector'
import { EconomicCalendarEventDetail as EventDetail, EconomicCalendarEventDetailState as EventDetailState, type EconomicCalendarRefreshState } from './EconomicCalendarEventDetail'
import { CalendarEventRow } from './CalendarEventRow'
import { calendarDayForMonth, calendarDisplayDate, unifiedCalendarDay, type CalendarDayCoverage, type CalendarDayItem } from './economicCalendarDayModel'
import { ImportBlsIcsDialog } from './ImportBlsIcsDialog'
import { useBlsIcsImport } from './useBlsIcsImport'
import { useMarketCalendar } from './useMarketCalendar'
import { MarketCalendarInspector } from './MarketCalendarEvents'
import { MarketCalendarSourceStatus } from './MarketCalendarSourceStatus'
import { CalendarEventStatusPolicy } from './calendarEventStatusModel'
import { useCalendarStatusClock } from './useCalendarStatusClock'
import type { MarketCalendarEvent, MarketCalendarSource } from '../../../../contracts/macro/marketCalendarQueryContracts'
import { shouldShowMarketCalendarProxyNotice } from './marketCalendarProxyNotice'
import { DashboardPanelDrawer } from '../../../pages/intelligence/DashboardPanelDrawer'
import { economicCalendarMonthLoadingPolicy, toDetailEvent } from './economicCalendarMonthResult'
import type { EconomicCalendarText } from './economicCalendarText'
import { useEconomicCalendarMonthWindow, type EconomicCalendarMonthState } from './useEconomicCalendarMonthWindow'

import './economicCalendar.css'

type DetailState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'unavailable'; failureCode: keyof EconomicCalendarText['failures'] }
  | { state: 'available'; event: EconomicCalendarEventView }

type Props = {
  client: MacroEconomicCalendarClient
  now: () => Date
  text: EconomicCalendarText
  onBack: () => void
  /** Set by the dashboard card: the month (and event) the reader asked to see. */
  openTarget?: { month: string; eventKey?: string }
}

const economicCalendarMonthValueAnchorPolicy = {
  day: 15,
  localHour: 12
} as const
const economicCalendarMonthPickerPolicy = {
  allowClear: false,
  format: 'YYYY-MM',
  picker: 'month'
} as const
const economicCalendarEmptyStateActionPolicy = {
  emptyEventCount: 0
} as const
type BlsScheduleFeedback = { year: string; schedule: 'updated' | 'unchanged'; cpi: 'updated' | 'current' | 'not-required' | 'unavailable'; employment: 'updated' | 'current' | 'not-required' | 'unavailable' }

export const blsScheduleAndValuesAggregateUpdatePolicy = Object.freeze({
  changed: (result: Awaited<ReturnType<MacroEconomicCalendarClient['syncBlsEmploymentSchedule']>>): boolean => result.state === 'completed' &&
    (result.schedule === 'updated' || result.values.cpi === 'updated' || result.values.employment === 'updated')
})

function toEconomicCalendarMonthPickerValue(month: string): Dayjs {
  return dayjs(`${month}-${economicCalendarMonthValueAnchorPolicy.day}T${economicCalendarMonthValueAnchorPolicy.localHour}:00:00`)
}

export function EconomicCalendar({ client, now, text, onBack, openTarget }: Props): ReactElement {
  const [initialQuery] = useState(() => createEconomicCalendarQuery(now()))
  const [statusNow, updateStatusClock] = useCalendarStatusClock(now)
  const timeZone = useShellTimeZone()
  const today = calendarDisplayDate(statusNow, timeZone)
  const [selectedMonth, setSelectedMonth] = useState(initialQuery.month)
  const selectedMonthRef = useRef(selectedMonth)
  /**
   * Whether the page is following the current month.
   *
   * True while the reader is looking at it, false once they pick another month. The clock can
   * only move a page that is following; a month the reader chose stays where they put it.
   */
  const [followCurrentMonth, setFollowCurrentMonth] = useState(() =>
    !openTarget?.month || openTarget.month === economicCalendarCurrentMonth(initialQuery.asOf))
  const [calendarPanelOpen, setCalendarPanelOpen] = useState(false)
  const gridMonths = economicCalendarGridMonths(selectedMonth)
  // The named month leads the read: it owns the grid and is what a manual refresh targets.
  const readMonths = [selectedMonth, ...gridMonths.filter(month => month !== selectedMonth)]
  const market = useMarketCalendar({ months: readMonths, locale: text.market.locale, now })
  const [selectedMarket, setSelectedMarket] = useState<MarketCalendarEvent>()
  const [selectedLinkedMarket, setSelectedLinkedMarket] = useState<MarketCalendarEvent>()
  useEffect(() => { setSelectedMarket(undefined); setSelectedLinkedMarket(undefined) }, [selectedMonth, text.market.locale])
  const [asOf, setAsOf] = useState(initialQuery.asOf)
  const { monthState, loadMonth } = useEconomicCalendarMonthWindow({ client, asOf, selectedMonthRef })
  const [selectedEventKey, setSelectedEventKey] = useState<string>()
  // The reader's own selection survives a re-read; nothing is picked or dropped on their behalf.
  useEffect(() => {
    if (monthState.state === 'loading') return
    if (monthState.state === 'unavailable') { setSelectedEventKey(undefined); return }
    setSelectedEventKey((current) => monthState.events.some((event) => event.eventKey === current) ? current : undefined)
  }, [monthState])
  const [detailState, setDetailState] = useState<DetailState>({ state: 'idle' })
  /** Bumped after the reader edits a release time, to re-read the detail and the month. */
  const [detailReload, setDetailReload] = useState(0)
  // Design 122 §2.2: newly read values and their release status share a fresh local clock.
  useEffect(() => { updateStatusClock() }, [market.events, monthState, detailState, updateStatusClock])
  /**
   * The right column always stands: it shows one day's grouped events, and the detail never replaces
   * it. The day is the reader's own until they open another one — by asking for its cell's remaining
   * events, or by picking one of its rows.
   */
  const [selectedDay, setSelectedDay] = useState(() => calendarDisplayDate(initialQuery.asOf, timeZone))
  /**
   * A caller can name one event as well as one month (the dashboard card's rows do).
   *
   * A row's key can come from either route the page reads, so it is matched against both month
   * pages and the first match wins. Until a page holds the key — the month may still be loading,
   * or the previous month's page may still be in state — nothing is applied and nothing is
   * remembered, so the selection lands on the same render the event actually arrives.
   */
  const appliedOpenTargetEvent = useRef<string | undefined>(undefined)
  useEffect(() => {
    const targetKey = openTarget?.eventKey
    if (!targetKey || appliedOpenTargetEvent.current === targetKey) return
    const officialTarget = monthState.state === 'available'
      ? monthState.events.find(event => event.eventKey === targetKey) : undefined
    if (officialTarget) {
      appliedOpenTargetEvent.current = targetKey
      setSelectedMarket(undefined)
      setSelectedEventKey(targetKey)
      setSelectedDay(calendarEventDay(officialTarget, timeZone))
      return
    }
    const providerEvent = market.events.find(event => event.eventKey === targetKey)
    if (!providerEvent || market.loading || market.failure) return
    appliedOpenTargetEvent.current = targetKey
    setSelectedEventKey(undefined)
    setSelectedMarket(providerEvent)
    setSelectedDay(calendarDisplayDate(providerEvent.scheduledAt, timeZone))
  }, [openTarget?.eventKey, monthState, market.events, market.loading, market.failure, timeZone])
  useEffect(() => {
    if (!selectedMarket || market.loading || market.failure) return
    const current = market.events.find(event => event.eventKey === selectedMarket.eventKey)
    if (current) {
      if (current !== selectedMarket) setSelectedMarket(current)
    } else {
      // The observation is gone, so its detail goes with it.
      setSelectedMarket(undefined)
    }
  }, [market.events, market.loading, market.failure, selectedMarket])
  useEffect(() => {
    if (!selectedLinkedMarket || market.loading || market.failure) return
    // An expired observation is not a stable cross-refresh identity. Require re-selection.
    const current = market.events.find(event => event.eventKey === selectedLinkedMarket.eventKey)
    if (current !== selectedLinkedMarket) setSelectedLinkedMarket(current)
  }, [market.events, market.loading, market.failure, selectedLinkedMarket])
  const [refreshState, setRefreshState] = useState<EconomicCalendarRefreshState>()
  const [blsScheduleFeedback, setBlsScheduleFeedback] = useState<BlsScheduleFeedback>()
  const mountedRef = useRef(true)
  const loadedInitialRef = useRef(false)
  const syncedYearsRef = useRef(new Set<string>())

  const syncBlsYear = useCallback(async (year: string): Promise<boolean> => {
    if (typeof client.syncBlsEmploymentSchedule !== 'function') return false
    if (syncedYearsRef.current.has(year)) return false
    syncedYearsRef.current.add(year)
    const result = await client.syncBlsEmploymentSchedule({ year: year as `${number}` })
    if (result.state === 'unavailable') syncedYearsRef.current.delete(year)
    if (result.state === 'completed' && mountedRef.current && selectedMonthRef.current.slice(0, 4) === year) {
      setBlsScheduleFeedback({ year, schedule: result.schedule, cpi: result.values.cpi, employment: result.values.employment })
    }
    return blsScheduleAndValuesAggregateUpdatePolicy.changed(result)
  }, [client])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])


  useEffect(() => {
    if (loadedInitialRef.current) return
    loadedInitialRef.current = true
    // A caller that named another month owns the first load: running the initial month as well
    // would race it, and whichever query settled last would decide what the reader sees.
    if (openTarget?.month && openTarget.month !== initialQuery.month) return
    // Otherwise the month to open with is whatever the page is currently pointing at.
    const month = selectedMonthRef.current
    void syncBlsYear(month.slice(0, 4)).then((updated) => {
      const queryAsOf = updated ? toCanonicalUtcMillis(now()) : initialQuery.asOf
      if (updated) setAsOf(queryAsOf)
      loadMonth(month, true, queryAsOf)
    }).catch(() => loadMonth(month, true, initialQuery.asOf))
  }, [initialQuery.asOf, initialQuery.month, loadMonth, syncBlsYear])

  const blsIcsImport = useBlsIcsImport({
    client,
    onImported: async () => {
      // The import just wrote rows with a later detection time; reading with the as-of the page
      // opened with would hide them until the reader switched months.
      const importedAsOf = toCanonicalUtcMillis(now())
      setAsOf(importedAsOf)
      loadMonth(selectedMonthRef.current, true, importedAsOf)
    }
  })

  const selectedEvent = readSelectedEvent(monthState, selectedEventKey)
  /**
   * A paged read advances a source past the observation the reader picked, and the inspector then
   * refuses to render rather than label an old reading with a new source time. That refusal is
   * correct and tested; leaving the pane blank was not, so the reader is told why it is empty.
   */
  const selectedMarketSource = selectedMarket ? market.sources.find(source => source.eventType === selectedMarket.eventType) : undefined
  const selectedMarketSourceAdvanced = selectedMarket !== undefined &&
    (selectedMarketSource === undefined || selectedMarketSource.sourceObservedAt !== selectedMarket.sourceObservedAt)

  useEffect(() => {
    if (!selectedEvent) {
      setDetailState({ state: 'idle' })
      return
    }
    let active = true
    setDetailState({ state: 'loading' })
    const detailAsOf = asOf
    void client.getEventDetail({ eventKey: selectedEvent.event.eventKey, asOf: detailAsOf }).then((result) => {
      if (!active) return
      const event = toDetailEvent(result, selectedEvent.event.eventKey, detailAsOf)
      setDetailState(event ? { state: 'available', event } : { state: 'unavailable', failureCode: economicCalendarMonthLoadingPolicy.unavailableFailureCode })
    }).catch(() => {
      if (active) setDetailState({ state: 'unavailable', failureCode: economicCalendarMonthLoadingPolicy.unavailableFailureCode })
    })
    return () => { active = false }
  }, [asOf, client, detailReload, selectedEvent?.event.eventKey, selectedEvent?.version, selectedMonth])

  const selectMonth = (month: string, follow?: boolean): void => {
    if (month === selectedMonthRef.current || !isEconomicCalendarMonth(month)) return
    selectedMonthRef.current = month
    setSelectedMonth(month)
    setFollowCurrentMonth(follow ?? month === economicCalendarCurrentMonth(toCanonicalUtcMillis(now())))
    setSelectedEventKey(undefined)
    setSelectedDay(calendarDayForMonth(month, today))
    setDetailState({ state: 'idle' })
    // A read is what the reader is looking at now. Keeping the mount-time as-of hid every
    // row collected since the page opened, including a month-end prefetch of the next month.
    const read = (): void => {
      const queryAsOf = toCanonicalUtcMillis(now())
      setAsOf(queryAsOf)
      loadMonth(month, true, queryAsOf)
    }
    void syncBlsYear(month.slice(0, 4)).then(read).catch(read)
  }
  /**
   * A caller (the dashboard card) can ask for a specific month.
   *
   * It goes through `selectMonth` rather than setting the state directly: the month query is
   * keyed off `selectedMonthRef`, so a bare `setSelectedMonth` left the ref on the initial month
   * and every result for the requested month was discarded as stale — the calendar stayed on the
   * month it opened with. The ref guard also makes this idempotent, so a re-render cannot loop.
   */
  useEffect(() => {
    if (openTarget?.month) selectMonth(openTarget.month)
  }, [openTarget?.month]) // eslint-disable-line react-hooks/exhaustive-deps
  /**
   * The month boundary the reader does not have to press.
   *
   * The status clock already ticks once a minute for release statuses; the same tick is what
   * moves a page that is following the current month into the next one. It carries a fresh
   * as-of, so the month it lands on is read as of now rather than as of page entry.
   */
  useEffect(() => {
    if (!followCurrentMonth) return
    const current = economicCalendarCurrentMonth(statusNow)
    if (current === selectedMonthRef.current) return
    selectMonth(current, true)
  }, [statusNow, followCurrentMonth]) // eslint-disable-line react-hooks/exhaustive-deps
  const coverage: CalendarDayCoverage = market.loading || monthState.state === 'loading' ? 'loading'
    : market.failure || monthState.state !== 'available' || monthState.incomplete ? 'incomplete' : 'complete'
  const timeZoneLabel = formatShellTimeZoneLabel(timeZone, useShellLanguage())
  const formatTime = useShellTimeFormat()
  const dayEvents = unifiedCalendarDay(selectedDay, monthState.state === 'available' ? monthState.events : [], market.events, coverage, timeZone,
    new Set(market.events.filter(event => event.officialLink).map(event => event.eventKey)))
  const dayList = useRef<HTMLElement>(null)
  // A day the reader leaves keeps its scroll position, so coming back to it resumes where it was.
  const dayScroll = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const scroller = dayList.current
    if (scroller) scroller.scrollTop = dayScroll.current.get(selectedDay) ?? 0
  }, [selectedDay])
  const showDay = (day: string): void => {
    if (day === selectedDay) return
    const scroller = dayList.current
    if (scroller) dayScroll.current.set(selectedDay, scroller.scrollTop)
    setSelectedDay(day)
  }
  /** Closing the drawer drops the reading it was showing, never the day list behind it. */
  const clearDetail = () => {
    setSelectedEventKey(undefined)
    setSelectedMarket(undefined)
    setSelectedLinkedMarket(undefined)
    setDetailState({ state: 'idle' })
  }
  /** Picking the same event again is how the reader puts the drawer away. */
  const selectItem = (item: CalendarDayItem) => {
    const alreadyOpen = item.source === 'market'
      ? selectedMarket?.eventKey === item.event.eventKey
      : selectedEventKey === item.event.eventKey
    showDay(item.date)
    if (alreadyOpen) {
      clearDetail()
      return
    }
    if (item.source === 'market') { setSelectedEventKey(undefined); setSelectedMarket(item.event); setSelectedLinkedMarket(undefined) }
    else { setSelectedMarket(undefined); setSelectedLinkedMarket(item.linkedMarket); setSelectedEventKey(item.event.eventKey) }
  }

  return (
    <main className="intelligence-page mi-economic-calendar" aria-label={text.title}>
      <header className="mi-economic-calendar__header">
        <div className="mi-economic-calendar__heading">
          <h1>{text.title}</h1>
          {blsScheduleFeedback?.year === selectedMonth.slice(0, 4) ? <p className="mi-economic-calendar__comparison-rule" role="status">{`${text.blsScheduleSync.schedule[blsScheduleFeedback.schedule]} · ${text.blsScheduleSync.cpi[blsScheduleFeedback.cpi]} · ${text.blsScheduleSync.employment[blsScheduleFeedback.employment]}`}</p> : null}
          <Button aria-label={text.manualImport.action} className="mi-economic-calendar__import" icon={<Upload aria-hidden="true" size={15} />} onClick={() => void blsIcsImport.selectFile()} size="small">
            {text.manualImport.action}
          </Button>
        </div>
        <div className="mi-economic-calendar__tools">
          <span data-calendar-time-zone={timeZone}>{timeZoneLabel}</span>
          <button aria-label={text.monthNavigation.previous} onClick={() => selectMonth(shiftEconomicCalendarMonth(selectedMonth, -1))} type="button"><ChevronLeft aria-hidden="true" size={15} />{text.monthNavigation.previous}</button>
          <DatePicker
            allowClear={economicCalendarMonthPickerPolicy.allowClear}
            aria-label={text.monthNavigation.picker}
            className="mi-economic-calendar__month-picker"
            format={economicCalendarMonthPickerPolicy.format}
            inputReadOnly
            onChange={(_, candidate) => {
              if (typeof candidate !== 'string') return
              const nextMonth = selectEconomicCalendarMonth(candidate, selectedMonth)
              if (nextMonth !== selectedMonth) selectMonth(nextMonth)
            }}
            picker={economicCalendarMonthPickerPolicy.picker}
            value={toEconomicCalendarMonthPickerValue(selectedMonth)}
          />
          <button aria-label={text.monthNavigation.next} onClick={() => selectMonth(shiftEconomicCalendarMonth(selectedMonth, 1))} type="button"><ChevronRight aria-hidden="true" size={15} />{text.monthNavigation.next}</button>
          <button aria-label={text.monthNavigation.current} onClick={() => selectMonth(economicCalendarCurrentMonth(toCanonicalUtcMillis(now())), true)} type="button">{text.monthNavigation.current}</button>
          <Button aria-label={text.calendarSettings} icon={<Settings2 aria-hidden="true" size={15} />} onClick={() => setCalendarPanelOpen(true)}>{text.calendarSettings}</Button>
          <Button aria-label={text.market.refresh} disabled={market.pending} icon={<RefreshCw size={15} />} onClick={() => void market.refresh()}>{text.market.refresh}</Button>
          <button onClick={onBack} type="button"><ArrowLeft aria-hidden="true" size={15} />{text.backToDashboard}</button>
        </div>
      </header>
      {shouldShowMarketCalendarProxyNotice(market.sources) ? <NetworkProxyBanner onOpenProxySettings={openProxySettings} /> : null}
      <section className="mi-market-calendar__status" aria-live="polite">
        <span>{text.unifiedDay.coverage.replace('{months}', gridMonths.join(' · '))}</span>
        {market.pending ? <span>{text.market.pending}</span> : market.feedback ? <span>{text.market[market.feedback.state]}</span> : null}
        {market.feedback?.failureCode === 'storage-unavailable' || market.feedback?.failureCode === 'storage-pressure' ? <span>{text.unifiedDay.storageUnavailable}</span> : null}
        {market.loading ? <LoadingState layout="inline" size="sm" label={text.market.loading} /> : null}
        {market.failure ? <span>{text.market.queryUnavailable}</span> : null}
        {market.sources.map(source => <MarketCalendarSourceStatus key={source.eventType} source={source} text={text} />)}
        {market.feedback?.failureCode === 'disabled' || market.feedback?.failureCode === 'credential-not-configured' ?
          <Button size="small" onClick={openIntelligenceSourcesSettings}>{text.market.settings}</Button> : null}
      </section>
      <div className="mi-calendar-status-legend" aria-label={text.eventStatus.label}>{CalendarEventStatusPolicy.states.map(status => <span key={status} data-event-status={status}>{text.eventStatus[status]}</span>)}</div>

      <div className="mi-economic-calendar__workspace">
        <CalendarMonthState
          statusNow={statusNow}
          asOf={asOf}
          today={today}
          month={selectedMonth}
          onImportBlsIcs={() => void blsIcsImport.selectFile()}
          onOpenDay={day => showDay(day)}
          onSelectItem={item => selectItem(item)}
          coverage={coverage}
          events={monthState.state === 'available' ? monthState.events : []}
          marketEvents={market.events}
          marketSources={market.sources}
          selectedEventKey={selectedEventKey}
          state={monthState}
          text={text}
        />
        <section aria-label={text.dayEvents.listLabel} className="mi-calendar-day-list" data-calendar-day-list ref={dayList}>
          <h2>{text.dayEvents.title.replace('{date}', selectedDay)}</h2>
          <p data-day-summary>{coverage === 'complete' ? text.unifiedDay.total.replace('{count}', String(dayEvents.items.length)) : text.unifiedDay[coverage]} · {text.unifiedDay.grouped}</p>
          <div role="list">{dayEvents.groups.map(group => <section data-calendar-group={group.eventType} key={group.eventType}>
            <h3>{text.unifiedDay.groupCount.replace('{type}', text.market.kinds[group.eventType]).replace('{count}', String(group.items.length))}</h3>
            {group.items.map(item => <div role="listitem" key={item.key}><CalendarEventRow item={item} marketSources={market.sources} text={text} statusNow={statusNow} selected={item.source === 'market' ? item.event.eventKey === selectedMarket?.eventKey : item.event.eventKey === selectedEventKey} onSelect={value => selectItem(value)} /></div>)}
          </section>)}</div>
          {coverage === 'complete' && !dayEvents.items.length ? <p>{text.unifiedDay.empty}</p> : null}
        </section>
      </div>
      <DashboardPanelDrawer open={calendarPanelOpen} panelId="economic-calendar" title={text.calendarSettings} onClose={() => setCalendarPanelOpen(false)} />
      <DetailDrawer open={selectedMarket !== undefined || selectedEventKey !== undefined} title={text.details.title} onClose={clearDetail}>
        {selectedMarket && selectedMarketSourceAdvanced ? <p className="mi-economic-calendar__comparison-rule" data-source-advanced>{text.market.sourceAdvanced}</p> : null}
        {selectedMarket ? <MarketCalendarInspector event={selectedMarket} source={market.sources.find(source => source.eventType === selectedMarket.eventType)} text={text} /> : null}
        {selectedLinkedMarket ? <MarketCalendarInspector event={selectedLinkedMarket} source={market.sources.find(source => source.eventType === selectedLinkedMarket.eventType)} text={text} /> : null}
        {!selectedMarket && detailState.state === 'loading' ? <EventDetailState text={text.status.loading} /> : null}
        {!selectedMarket && detailState.state === 'available' ? <EventDetail event={detailState.event} now={now} onRefresh={async (operation, eventKey) => {
          if (refreshState?.pending) return
          setRefreshState({ eventKey, operation, pending: true })
          const result = operation === 'bls'
            ? await client.refreshBlsEmploymentRelease({ eventKey, confirmed: true })
            : await client.refreshFedFomcDecision({ eventKey, confirmed: true })
          if (!mountedRef.current) return
          setRefreshState({ eventKey, operation, pending: false, feedback: result.state })
          if (result.state === 'updated') {
            const nextAsOf = toCanonicalUtcMillis(now())
            setAsOf(nextAsOf)
            loadMonth(selectedMonthRef.current, true, nextAsOf)
          }
        }} onReleaseTimeChanged={async () => {
          if (!mountedRef.current) return
          loadMonth(selectedMonthRef.current, true, toCanonicalUtcMillis(now()))
          setDetailReload((value) => value + 1)
        }} releaseTimeClient={client} refreshState={refreshState} text={text} /> : null}
        {!selectedMarket && detailState.state === 'unavailable' ? <EventDetailState text={text.failures[detailState.failureCode]} /> : null}
      </DetailDrawer>
      <ImportBlsIcsDialog
        dialogState={blsIcsImport.dialogState}
        onClose={blsIcsImport.closeDialog}
        onConfirm={() => void blsIcsImport.confirmImport()}
        text={text}
      />
    </main>
  )
}

function CalendarMonthState({ month, asOf, today, statusNow, onImportBlsIcs, onOpenDay, onSelectItem, selectedEventKey, state, text, events, marketEvents, marketSources, coverage }: {
  statusNow: string
  today: string
  asOf: string
  events: readonly EconomicCalendarEventView[]
  marketEvents: readonly MarketCalendarEvent[]
  marketSources: readonly MarketCalendarSource[]
  onSelectItem: (item: CalendarDayItem) => void
  coverage: CalendarDayCoverage
  month: string
  onImportBlsIcs: () => void
  onOpenDay: (day: string) => void
  selectedEventKey: string | undefined
  state: EconomicCalendarMonthState
  text: EconomicCalendarText
}): ReactElement {
  const status = state.state === 'loading' ? text.status.loading : state.state === 'unavailable' ? text.failures[state.failureCode] : undefined
  if (state.state !== 'available' && !marketEvents.length) return <CalendarState month={month} text={status!} loading={state.state === 'loading'} />
  const projection = state.state === 'available' ? state.projection : createEconomicCalendarProjection({ month, asOf, events: [] })
  return <div className="mi-calendar-month-scroll">{status ? (state.state === 'loading' ? <LoadingState layout="inline" size="sm" label={status} /> : <p role="status">{status}</p>) : null}<CalendarMonth statusNow={statusNow} today={today} events={events} marketEvents={marketEvents} marketSources={marketSources} onSelectItem={onSelectItem} coverage={coverage} month={month} onImportBlsIcs={onImportBlsIcs} projection={projection} selectedEventKey={selectedEventKey} onOpenDay={onOpenDay} text={text} /></div>
}

function CalendarState({ month, text, loading }: { month: string; text: string; loading: boolean }): ReactElement {
  return <section className="mi-economic-calendar__month" aria-live="polite" data-month-key={month}>
    {loading ? <LoadingState label={text} minHeight={220} /> : <p className="mi-economic-calendar__more">{text}</p>}
  </section>
}

function CalendarMonth({ month, today, statusNow, onImportBlsIcs, projection, events, selectedEventKey, onOpenDay, onSelectItem, text, marketEvents, marketSources, coverage }: {
  statusNow: string
  today: string
  events: readonly EconomicCalendarEventView[]
  marketEvents: readonly MarketCalendarEvent[]
  marketSources: readonly MarketCalendarSource[]
  onSelectItem: (item: CalendarDayItem) => void
  coverage: CalendarDayCoverage
  month: string
  onImportBlsIcs: () => void
  projection: EconomicCalendarProjection
  selectedEventKey: string | undefined
  onOpenDay: (day: string) => void
  text: EconomicCalendarText
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
            {unified.coverage !== 'complete' || unified.remaining ? <button data-calendar-more className="mi-economic-calendar__more mi-economic-calendar__more-button" onClick={() => onOpenDay(day.dateKey)} type="button">{unified.coverage === 'complete' ? text.unifiedDay.more.replace('{count}', String(unified.remaining)) : text.unifiedDay[unified.coverage]}</button> : null}
          </div>
        </article>
      })}
    </div>
    {events.length === economicCalendarEmptyStateActionPolicy.emptyEventCount && !marketEvents.length ? <CalendarEmptyState onImportBlsIcs={onImportBlsIcs} text={text} /> : null}
  </section>
}

function CalendarEmptyState({ onImportBlsIcs, text }: { onImportBlsIcs: () => void; text: EconomicCalendarText }): ReactElement {
  return <section className="mi-economic-calendar__empty-state" aria-live="polite">
    <div>
      <p className="mi-economic-calendar__empty-state-title">{text.emptyState.title}</p>
      <p className="mi-economic-calendar__more">{text.status.empty}</p>
    </div>
    <div className="mi-economic-calendar__empty-state-actions">
      <Button onClick={openMacroCalendarSettings} size="small" type="primary">{text.emptyState.manageAction}</Button>
      <Button icon={<Upload aria-hidden="true" size={15} />} onClick={onImportBlsIcs} size="small">{text.manualImport.action}</Button>
    </div>
  </section>
}

function toCanonicalUtcMillis(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}T${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}:${String(date.getUTCSeconds()).padStart(2, '0')}.${String(date.getUTCMilliseconds()).padStart(3, '0')}Z`
}

/** The calendar day an official event is drawn on, in the workspace's display zone. */
function calendarEventDay(event: EconomicCalendarEventView, timeZone: string): string {
  return event.scheduledAt ? calendarDisplayDate(event.scheduledAt, timeZone) : event.scheduledDate
}

function readSelectedEvent(state: EconomicCalendarMonthState, eventKey: string | undefined): { event: EconomicCalendarEventView; version: number } | undefined {
  if (!eventKey) return undefined
  if (state?.state !== 'available') return undefined
  const event = state.events.find((candidate) => candidate.eventKey === eventKey)
  return event ? { event, version: state.version } : undefined
}
