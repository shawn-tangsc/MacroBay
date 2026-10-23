import { useState, type ReactElement } from 'react'
import { Button, DatePicker } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { RefreshCw } from 'lucide-react'

import type { MacroEconomicCalendarClient } from '../../../shared/ipc/macroEconomicCalendarClient'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { formatShellTimeZoneLabel } from '@platform/ui/time/shellTimeFormat'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import type { EconomicCalendarText } from './EconomicCalendar'
import type { EconomicCalendarEventView } from './economicCalendarModel'
import { calendarDisplayDate } from './economicCalendarDayModel'
import {
  economicCalendarCaveats,
  formatEconomicCalendarTime,
  fromWallClock,
  wallClockIsAmbiguous
} from './economicCalendarModel'

/**
 * The one detail surface for an official calendar event.
 *
 * It was a private function inside `EconomicCalendar`; it lives on its own because two surfaces
 * now show the same event. The calendar page opens it for a row the reader picked there, and the
 * market dashboard opens it for the event behind a chart's vertical line. Two bodies would drift —
 * the second one would show fewer facts, or name the same fact differently — so both render this
 * one, inside the same drawer shell (`CalendarInspector`).
 */

export type EconomicCalendarRefreshOperation = 'bls' | 'fomc'
export type EconomicCalendarRefreshFeedback = 'updated' | 'unchanged' | 'unavailable'
export type EconomicCalendarRefreshState = {
  eventKey: string
  operation: EconomicCalendarRefreshOperation
  pending: boolean
  feedback?: EconomicCalendarRefreshFeedback
}

/** Renderer-only advisory gate; main process remains the authoritative refresh eligibility boundary. */
const blsRefreshPresentationPolicy = {
  canonicalEligibleFamilies: [
    { eventFamily: 'consumer-price-index', titleKeys: ['cpi', 'core-cpi'] },
    { eventFamily: 'employment-situation', titleKeys: ['nonfarm-payrolls', 'unemployment', 'average-hourly-earnings'] }
  ],
  manualSource: 'blsManualIcs',
  manualCaveat: 'manual-ics-import',
  automaticSource: 'blsAutomaticSchedule',
  automaticCaveat: 'bls-python-schedule',
  cancelledState: 'cancelled'
} as const
/** Renderer-only advisory gate; main process remains the authoritative refresh eligibility boundary. */
const fedFomcRefreshPresentationPolicy = {
  eventKeyPattern: /^US\.FOMC\.\d{4}-\d{2}-\d{2}$/,
  eventFamily: 'fomc',
  labelKey: 'fomc',
  source: 'federalReserve',
  cancelledState: 'cancelled'
} as const

/**
 * The release time, always with where it came from.
 *
 * A time we filled in from the family's convention is not a time the source published, so it is
 * never printed bare: it carries a label saying so, exactly like the row labels the rest of this
 * board uses for a proxy or a synthesis. A published time needs no label, and with neither we print
 * the date and say the time is not published rather than borrowing a number.
 */
function releaseTimeText(event: EconomicCalendarEventView, text: EconomicCalendarText, timeZone: string, timeZoneLabel: string): string {
  if (event.scheduledAt === undefined) return `${event.scheduledDate} ${text.details.scheduledDateOnly}`
  const time = `${calendarDisplayDate(event.scheduledAt, timeZone)} ${formatEconomicCalendarTime(event.scheduledAt, timeZone, timeZoneLabel)}`
  if (event.releaseTimeSource === 'convention-default') return `${time}（${text.details.conventionTime}）`
  if (event.releaseTimeSource === 'user-edited') return `${time}（${text.details.editedTime}）`
  return time
}

export function EconomicCalendarEventDetail({ event, now, onRefresh, onReleaseTimeChanged, releaseTimeClient, refreshState, text }: {
  event: EconomicCalendarEventView; now: () => Date
  onRefresh: (operation: EconomicCalendarRefreshOperation, eventKey: string) => Promise<void>
  onReleaseTimeChanged: () => Promise<void>
  releaseTimeClient: Pick<MacroEconomicCalendarClient, 'setReleaseTime' | 'clearReleaseTime'>
  refreshState: EconomicCalendarRefreshState | undefined; text: EconomicCalendarText
}): ReactElement {
  const timeZone = useShellTimeZone()
  const timeZoneLabel = formatShellTimeZoneLabel(timeZone, useShellLanguage())
  const formatTime = useShellTimeFormat()
  const valueRows: { id: 'actual' | 'previous'; label: string }[] = [
    { id: 'actual', label: text.details.actual }, { id: 'previous', label: text.details.previous }
  ]
  const blsRefreshAction = refreshActionPresentation(refreshState, event.eventKey, 'bls')
  const fomcRefreshAction = refreshActionPresentation(refreshState, event.eventKey, 'fomc')
  const period = economicCalendarCaveats(event).includes('official-period-not-published-in-ics')
    ? text.periods.officialNotPublished
    : event.periodKey

  return <aside className="mi-economic-calendar__inspector" aria-live="polite">
    {/* The drawer's own header already names the surface; the body starts with the event. */}
    <h2>{text.events[event.labelKey]}</h2>
    <dl className="mi-economic-calendar__metadata">
      <Meta label={text.details.category} value={text.categories[event.category]} />
      <Meta label={text.details.period} value={period} />
      <Meta label={text.details.source} value={event.sources.map((source) => text.sources[source]).join(', ')} />
      <ReleaseTimeRow client={releaseTimeClient} event={event} onChanged={onReleaseTimeChanged} text={text} timeZone={timeZone} timeZoneLabel={timeZoneLabel} />
      {event.sources.includes(fedFomcRefreshPresentationPolicy.source) && event.publishedAt ? <Meta label={text.fomcRefresh.publishedAt} value={formatTime(event.publishedAt, 'second')} /> : null}
      <Meta label={text.details.importance} value={text.importance.high} />
      <Meta label={text.details.state} value={text.states[event.lifecycleState]} />
    </dl>
    <div className="mi-economic-calendar__values">
      {valueRows.map((row) => <div key={row.id}><span>{row.label}</span><strong>{event[row.id]?.displayValue ?? text.details.unavailable}</strong></div>)}
    </div>
    {isBlsRefreshEligible(event, now()) ? <BlsRefreshAction disabled={blsRefreshAction.disabled} eventKey={event.eventKey} onRefresh={onRefresh} pending={blsRefreshAction.pending} text={text} /> : null}
    {isFedFomcRefreshEligible(event, now()) ? <FedFomcRefreshAction disabled={fomcRefreshAction.disabled} eventKey={event.eventKey} onRefresh={onRefresh} pending={fomcRefreshAction.pending} text={text} /> : null}
    {refreshState?.feedback && isRefreshStateFor(refreshState, event.eventKey, 'bls') ? <p className="mi-economic-calendar__comparison-rule" role="status">{text.blsRefresh[refreshState.feedback]}</p> : null}
    {refreshState?.feedback && isRefreshStateFor(refreshState, event.eventKey, 'fomc') ? <p className="mi-economic-calendar__comparison-rule" role="status">{refreshState.feedback === 'unavailable' && event.actual
      ? <>{text.fomcRefresh.retained} <time>{formatTime(event.detectedAt, 'second')}</time></>
      : text.fomcRefresh[refreshState.feedback]}</p> : null}
    {economicCalendarCaveats(event).map((caveat) => <p className="mi-economic-calendar__comparison-rule" key={caveat}>{text.caveats[caveat as keyof EconomicCalendarText['caveats']]}</p>)}
  </aside>
}
/**
 * The release time is the control.
 *
 * The reader clicks the value they are already looking at — the same row, the same place — and it
 * becomes an antd date **and** time picker, because a release that moves to another day has to be
 * expressible: storing only a time-of-day would pin the edit to the day the source announced.
 *
 * The value shown and edited is wall-clock in the workspace's display zone; what is stored is the
 * instant it names, converted through `Intl` so the hour follows daylight saving. Two cases are
 * refused with a reason rather than rounded to a nearby hour: an instant that occurs twice, and an
 * edit whose two halves disagree.
 */
function ReleaseTimeRow({ client, event, onChanged, text, timeZone, timeZoneLabel }: {
  client: Pick<MacroEconomicCalendarClient, 'setReleaseTime' | 'clearReleaseTime'>
  event: EconomicCalendarEventView; onChanged: () => Promise<void>; text: EconomicCalendarText
  timeZone: string; timeZoneLabel: string
}): ReactElement {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Dayjs | null>(null)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'rejected' | 'ambiguous'>('idle')
  const edited = event.releaseTimeSource === 'user-edited'
  const shown = releaseTimeText(event, text, timeZone, timeZoneLabel)
  /**
   * A row that carries an actual value has already been released: the time it happened is history,
   * and letting the reader move it would be editing the past. Those rows show the time as plain text.
   */
  const canEdit = event.actual === undefined && event.lifecycleState === 'scheduled'

  const open = (): void => {
    const instant = event.scheduledAt
    // The picker shows the instant in the browser's own zone; the value that is saved is
    // re-derived from the wall-clock text through the checked conversion below, so the two
    // never disagree about what the reader picked.
    setDraft(instant === undefined ? null : dayjs(instant))
    setState('idle')
    setEditing(true)
  }

  async function save(): Promise<void> {
    if (draft === null) return
    const wallClock = draft.format('YYYY-MM-DDTHH:mm')
    if (wallClockIsAmbiguous(wallClock, timeZone)) { setState('ambiguous'); return }
    const instant = fromWallClock(wallClock, timeZone)
    if (instant === undefined) { setState('rejected'); return }
    setState('saving')
    const result = await client.setReleaseTime({ eventKey: event.eventKey, scheduledAt: instant, scheduledDate: wallClock.slice(0, 10) })
    if (result.state !== 'saved') { setState('rejected'); return }
    setState('saved')
    setEditing(false)
    await onChanged()
  }

  async function restore(): Promise<void> {
    setState('saving')
    const result = await client.clearReleaseTime({ eventKey: event.eventKey })
    if (result.state !== 'cleared') { setState('rejected'); return }
    setState('saved')
    setEditing(false)
    await onChanged()
  }

  return <div className="mi-economic-calendar__release-time" data-release-time-row={event.releaseTimeSource}>
    <dt>{text.details.time}</dt>
    <dd>
      {editing
        ? <DatePicker
            allowClear={false}
            aria-label={text.details.editTime.label}
            className="mi-economic-calendar__release-time-picker"
            format="YYYY-MM-DD HH:mm"
            minuteStep={1}
            onChange={(value) => { setDraft(value); setState('idle') }}
            showTime={{ format: 'HH:mm' }}
            value={draft}
          />
        : canEdit
          ? <button aria-label={text.details.time} className="mi-economic-calendar__release-time-value" onClick={open} type="button">{shown}</button>
          : <span className="mi-economic-calendar__release-time-value" data-release-time-fixed="true">{shown}</span>}
      {editing
        ? <span className="mi-economic-calendar__release-time-actions">
            <Button aria-label={text.details.editTime.save} disabled={state === 'saving' || draft === null} onClick={() => void save()} size="small" type="primary">{text.details.editTime.save}</Button>
            {edited ? <Button aria-label={text.details.editTime.restore} disabled={state === 'saving'} onClick={() => void restore()} size="small">{text.details.editTime.restore}</Button> : null}
            <Button aria-label={text.details.editTime.cancel} onClick={() => { setEditing(false); setState('idle') }} size="small" type="text">{text.details.editTime.cancel}</Button>
          </span>
        : edited && canEdit ? <Button aria-label={text.details.editTime.restore} onClick={() => void restore()} size="small" type="text">{text.details.editTime.restore}</Button> : null}
      {state === 'saved' ? <span role="status">{text.details.editTime.saved}</span> : null}
      {state === 'rejected' ? <span role="alert">{text.details.editTime.rejected}</span> : null}
      {state === 'ambiguous' ? <span role="alert">{text.details.editTime.ambiguous}</span> : null}
    </dd>
  </div>
}

function BlsRefreshAction({ disabled, eventKey, onRefresh, pending, text }: { disabled: boolean; eventKey: string; onRefresh: (operation: EconomicCalendarRefreshOperation, eventKey: string) => Promise<void>; pending: boolean; text: EconomicCalendarText }): ReactElement {
  return <Button disabled={disabled} onClick={() => { if (confirmRefresh(text.blsRefresh.confirmation)) void onRefresh('bls', eventKey) }} size="small">{pending ? text.blsRefresh.pending : text.blsRefresh.action}</Button>
}

function FedFomcRefreshAction({ disabled, eventKey, onRefresh, pending, text }: { disabled: boolean; eventKey: string; onRefresh: (operation: EconomicCalendarRefreshOperation, eventKey: string) => Promise<void>; pending: boolean; text: EconomicCalendarText }): ReactElement {
  return <Button disabled={disabled} icon={<RefreshCw aria-hidden="true" size={14} />} onClick={() => { if (confirmRefresh(text.fomcRefresh.confirmation)) void onRefresh('fomc', eventKey) }} size="small">{pending ? text.fomcRefresh.pending : text.fomcRefresh.action}</Button>
}

function isBlsRefreshEligible(event: EconomicCalendarEventView, now: Date): boolean {
  if (event.lifecycleState === blsRefreshPresentationPolicy.cancelledState) return false
  const caveats = economicCalendarCaveats(event)
  const isManual = event.sources.length === 1 && event.sources[0] === blsRefreshPresentationPolicy.manualSource &&
    caveats.includes(blsRefreshPresentationPolicy.manualCaveat) && !caveats.includes(blsRefreshPresentationPolicy.automaticCaveat) &&
    Boolean(event.scheduledAt) && Date.parse(event.scheduledAt!) <= now.getTime()
  const isAutomatic = event.sources.length === 1 && event.sources[0] === blsRefreshPresentationPolicy.automaticSource &&
    caveats.includes(blsRefreshPresentationPolicy.automaticCaveat) && !caveats.includes(blsRefreshPresentationPolicy.manualCaveat) &&
    event.scheduledDate <= dateOnly(now)
  const families = isManual || isAutomatic ? blsRefreshPresentationPolicy.canonicalEligibleFamilies : []
  const family = families.find((candidate) => candidate.eventFamily === event.eventFamily)
  return Boolean(family && (family.titleKeys as readonly string[]).includes(event.labelKey))
}

function isFedFomcRefreshEligible(event: EconomicCalendarEventView, now: Date): boolean {
  return event.lifecycleState !== fedFomcRefreshPresentationPolicy.cancelledState &&
    fedFomcRefreshPresentationPolicy.eventKeyPattern.test(event.eventKey) &&
    event.eventFamily === fedFomcRefreshPresentationPolicy.eventFamily && event.labelKey === fedFomcRefreshPresentationPolicy.labelKey &&
    event.sources.length === 1 && event.sources[0] === fedFomcRefreshPresentationPolicy.source &&
    event.scheduledAt === undefined && event.scheduledDate <= dateOnly(now)
}

function isRefreshStateFor(state: EconomicCalendarRefreshState, eventKey: string, operation: EconomicCalendarRefreshOperation): boolean {
  return state.eventKey === eventKey && state.operation === operation
}

function refreshActionPresentation(state: EconomicCalendarRefreshState | undefined, eventKey: string, operation: EconomicCalendarRefreshOperation): { disabled: boolean; pending: boolean } {
  return {
    disabled: Boolean(state?.pending),
    pending: Boolean(state?.pending && isRefreshStateFor(state, eventKey, operation))
  }
}

function dateOnly(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`
}

function confirmRefresh(message: string): boolean {
  try { return typeof window.confirm === 'function' && window.confirm(message) } catch { return false }
}

/** The detail surface with nothing to show: its state, never a blank pane. */
export function EconomicCalendarEventDetailState({ text }: { text: string }): ReactElement {
  return <aside className="mi-economic-calendar__inspector" aria-live="polite"><p className="mi-economic-calendar__more">{text}</p></aside>
}

function Meta({ label, value }: { label: string; value: string }): ReactElement {
  return <div><dt>{label}</dt><dd>{value}</dd></div>
}
