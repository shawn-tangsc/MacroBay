import { useEffect, useRef, useState, type ReactElement } from 'react'

import type { MarketCalendarEvent, MarketCalendarSource } from '../../../contracts/macro/marketCalendarQueryContracts'
import type { MacroEconomicCalendarClient } from '../../shared/ipc/macroEconomicCalendarClient'
import {
  CalendarInspector,
  EconomicCalendarEventDetail,
  EconomicCalendarEventDetailState,
  MarketCalendarInspector,
  createEconomicCalendarProjection,
  type EconomicCalendarEventView,
  type EconomicCalendarRefreshOperation,
  type EconomicCalendarRefreshState,
  type EconomicCalendarText
} from '../../features/macro/economic-calendar'
import type { SelectedCalendarEvent } from './selectedCalendarEvent'

type DetailState =
  | { state: 'loading' }
  | { state: 'available'; event: EconomicCalendarEventView }
  /** A provider release, with the route's own status for the kind it belongs to. */
  | { state: 'provider'; event: MarketCalendarEvent; source?: MarketCalendarSource }
  | { state: 'unavailable'; failureCode: keyof EconomicCalendarText['failures'] }

/**
 * The calendar event's detail, opened from the market dashboard.
 *
 * It reuses the calendar's own detail surfaces rather than drawing second ones: the same drawer shell
 * (left, unmasked, closable from the header corner, floating off the content area's edges), the same
 * official body — importance, category, period, source, release time, actual/previous, lifecycle and
 * caveats — and, for a release the official route does not hold, the same provider body the calendar's
 * day list uses. A second body would be a second answer to "what did this event say", and the two
 * would drift.
 *
 * The provider body is handed the route's own source status, exactly as the calendar page hands it
 * over: without it the status line can only say 「本次尚未刷新」 and the reader cannot see how the last
 * refresh went, nor be told when the live source has moved past the observation they picked.
 *
 * The read is scoped by an instant frozen when the drawer mounts, which is what makes the detail
 * the reader sees the detail that existed when they asked for it. The page keys this element by the
 * event, so opening another event mounts a fresh read rather than repainting the previous one.
 */
export function SelectedCalendarEventDrawer({ client, selection, now, text, onClose, readMarketMonth }: {
  client: MacroEconomicCalendarClient
  selection: SelectedCalendarEvent
  now: () => Date
  text: EconomicCalendarText
  onClose: () => void
  /**
   * The 0xRouter month, injected by the page: the events **and** the route's per-source status. Asked
   * only when the official route does not hold the event — the chart's lines include the provider's
   * releases, and one of those has no official row to open.
   */
  readMarketMonth?: (month: string, asOf: string) => Promise<Readonly<{ events: readonly MarketCalendarEvent[]; sources: readonly MarketCalendarSource[] }> | null>
}): ReactElement {
  const [asOf, setAsOf] = useState(() => now().toISOString())
  const [detail, setDetail] = useState<DetailState>({ state: 'loading' })
  const [reload, setReload] = useState(0)
  const [refreshState, setRefreshState] = useState<EconomicCalendarRefreshState>()
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    let active = true
    setDetail({ state: 'loading' })
    const unavailable = (failureCode: keyof EconomicCalendarText['failures']): void => {
      if (active) setDetail({ state: 'unavailable', failureCode })
    }
    void Promise.resolve(client.getEventDetail({ eventKey: selection.eventKey, asOf })).then(async (result) => {
      if (!active) return
      if (result.state === 'available' && result.asOf === asOf) {
        // The month comes from the event itself: the projection is what names the event the way the
        // calendar page names it, and an event is only in its own month.
        const events = createEconomicCalendarProjection({ month: result.event.scheduledDate.slice(0, 7), asOf, events: [result.event] }).events
        const event = events.find(candidate => candidate.eventKey === selection.eventKey)
        if (event) { setDetail({ state: 'available', event }); return }
      }
      const failureCode = result.state === 'unavailable' ? result.failureCode : 'calendar-query-unavailable'
      // Not an official row: the provider may be the route that carried it.
      const market = await readMarketMonth?.(selection.month, asOf).catch(() => null) ?? null
      const provider = market?.events.find(event => event.eventKey === selection.eventKey)
      const source = provider ? market?.sources.find(candidate => candidate.eventType === provider.eventType) : undefined
      if (active) setDetail(provider ? { state: 'provider', event: provider, ...(source ? { source } : {}) } : { state: 'unavailable', failureCode })
    }).catch(() => { unavailable('calendar-query-unavailable') })
    return () => { active = false }
  }, [asOf, client, readMarketMonth, reload, selection.eventKey, selection.month])

  /** A refresh that brought new values re-reads the detail from the instant it happened at. */
  const refresh = async (operation: EconomicCalendarRefreshOperation, eventKey: string): Promise<void> => {
    if (refreshState?.pending) return
    setRefreshState({ eventKey, operation, pending: true })
    const result = operation === 'bls'
      ? await client.refreshBlsEmploymentRelease({ eventKey, confirmed: true })
      : await client.refreshFedFomcDecision({ eventKey, confirmed: true })
    if (!mounted.current) return
    setRefreshState({ eventKey, operation, pending: false, feedback: result.state })
    if (result.state === 'updated') setAsOf(now().toISOString())
  }

  return <CalendarInspector open title={text.details.title} onClose={onClose}>
    {detail.state === 'loading' ? <EconomicCalendarEventDetailState text={text.status.loading} /> : null}
    {detail.state === 'available' ? <EconomicCalendarEventDetail
      event={detail.event}
      now={now}
      onRefresh={refresh}
      // The reader's own release time is a fact about the event, so the detail is read again; the
      // instant the read is scoped by does not move, because nothing was released by editing it.
      onReleaseTimeChanged={async () => { setReload(value => value + 1) }}
      releaseTimeClient={client}
      refreshState={refreshState}
      text={text}
    /> : null}
    {detail.state === 'provider' ? <>
      {/* The calendar page puts this above the body for the same reason: when the live source has
          moved past the observation the reader picked, the values and the time belong to that
          observation, and saying so is what stops the newer source's age being attached to it. */}
      {detail.source === undefined || detail.source.sourceObservedAt !== detail.event.sourceObservedAt
        ? <p className="mi-economic-calendar__comparison-rule" data-source-advanced>{text.market.sourceAdvanced}</p>
        : null}
      <MarketCalendarInspector event={detail.event} source={detail.source} text={text} />
    </> : null}
    {detail.state === 'unavailable' ? <EconomicCalendarEventDetailState text={text.failures[detail.failureCode]} /> : null}
  </CalendarInspector>
}
