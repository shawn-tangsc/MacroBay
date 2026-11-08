import { useState, type ReactElement } from 'react'
import { Button, DatePicker } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { Pencil, RefreshCw } from 'lucide-react'

import type { MacroEconomicCalendarClient } from '../../../shared/ipc/macroEconomicCalendarClient'
import { resolveCalendarConsensus, type CalendarConsensusValue } from '../../../../contracts/macro/calendarConsensus'
import { useConfirm } from '@platform/ui/components/confirm'
import { IconButton } from '@platform/ui/components/icon-button'
import { LoadingState } from '@platform/ui/components/loading'
import { StateView, STATE_VIEW_ACTION_KEYS } from '@platform/ui/components/state'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { formatShellTimeZoneLabel } from '@platform/ui/time/shellTimeFormat'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import { useProductTextKey } from '../../../shared/i18n/productTextKey'
import type { EconomicCalendarText } from './economicCalendarText'
import type { EconomicCalendarEventView } from './economicCalendarModel'
import { calendarDisplayDate } from './economicCalendarDayModel'
import {
  economicCalendarCaveats,
  formatEconomicCalendarTime,
  fromWallClock,
  resolveReleaseTimeWrite,
  toWallClock,
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

export function EconomicCalendarEventDetail({ event, officialConsensus, linkedConsensus, linkedConsensusFailure, now, onRefresh, onReleaseTimeChanged, releaseTimeClient, refreshState, text, blsUnavailableNotice }: {
  event: EconomicCalendarEventView
  /**
   * The official consensus, when the view carries one. The projection does not surface it today —
   * the three official sources publish none — but the resolver's order is official first, and the
   * caller decides what it has rather than this component assuming a source.
   */
  officialConsensus?: CalendarConsensusValue | null
  /**
   * The market observation linked to this official event, when the page has one. It is the only
   * possible source of an expectation here: the official three publish no consensus.
   */
  linkedConsensus?: CalendarConsensusValue | null
  /**
   * The market read itself failed, as opposed to finding an observation whose field is empty. The
   * two produce different reasons: "we could not read it this time" is not "the field is empty".
   */
  linkedConsensusFailure?: boolean
  now: () => Date
  onRefresh: (operation: EconomicCalendarRefreshOperation, eventKey: string) => Promise<void>
  onReleaseTimeChanged: () => Promise<void>
  releaseTimeClient: Pick<MacroEconomicCalendarClient, 'setReleaseTime' | 'clearReleaseTime'>
  refreshState: EconomicCalendarRefreshState | undefined; text: EconomicCalendarText
  /** 官方日历已停用时那一句说明；有它就把 BLS 刷新置灰，不再发请求。 */
  blsUnavailableNotice?: string
}): ReactElement {
  const timeZone = useShellTimeZone()
  const timeZoneLabel = formatShellTimeZoneLabel(timeZone, useShellLanguage())
  const formatTime = useShellTimeFormat()
  const valueRows: { id: 'actual' | 'previous'; label: string }[] = [
    { id: 'actual', label: text.details.actual }, { id: 'previous', label: text.details.previous }
  ]
  /*
   * 缺值不许写成一句「暂无」：那是把「还没到」「源没给」「读不到」三件事并成一个。
   * 这一层能分的是前两种——发布时刻还没到写「尚未公布」，已到点而源没给值写「源未给出」。
   * 第三种（读不到）由整块的读失败态给句子，它不是某一行缺值，整页都不该有内容。
   */
  const releaseInstantPassed = event.scheduledAt !== undefined
    ? Date.parse(event.scheduledAt) <= now().getTime()
    : event.scheduledDate <= calendarDisplayDate(now().toISOString(), timeZone)
  const missingValueSentence = event.lifecycleState === 'scheduled' && !releaseInstantPassed
    ? text.details.valueNotYet
    : text.details.valueNotProvided
  // 停用是现状，不是这次点击失败：按钮置灰、点不动，也不发请求（服务侧也已立刻回 unavailable）。
  const blsRefreshAction = refreshActionPresentation(refreshState, event.eventKey, 'bls', blsUnavailableNotice !== undefined)
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
      {/* 两个时刻都是"记录本身"的时间，不是发布时刻：创建时间在修订后不变；实际值时间取第一次
          拿到非空现值那刻的**来源观测时刻**。缺就不画，不拿别的时刻顶上。 */}
      {event.createdAt ? <Meta label={text.recordTimes.createdAt} value={formatTime(event.createdAt, 'second')} /> : null}
      {event.actualDetectedAt ? <Meta label={text.recordTimes.actualDetectedAt} value={formatTime(event.actualDetectedAt, 'second')} /> : null}
      <Meta label={text.details.importance} value={text.importance.high} />
      <Meta label={text.details.state} value={text.states[event.lifecycleState]} />
    </dl>
    <div className="mi-economic-calendar__values">
      {valueRows.map((row) => <div key={row.id}><span>{row.label}</span><strong>{event[row.id]?.displayValue ?? missingValueSentence}</strong></div>)}
      {/* 官方三源（Fed/BLS/BEA）不提供预期；能用的只有挂着的那条市场观测，所以标出来源。
          两边都没有时写「预期值未提供」——不是「没有超预期」，那会把未知说成结论。 */}
      {(() => {
        const consensus = resolveCalendarConsensus(officialConsensus, linkedConsensus)
        // 「没有观测」与「有观测但读不出来」必须是两句话：后者是数据缺口，不是「没有预期」。
        const shown = consensus.state === 'value' ? consensus.value
          : consensus.state === 'unreadable' ? text.details.consensusUnreadable
            : text.details.consensusMissing
        return <>
          <div data-consensus={consensus.state === 'value' ? consensus.source : consensus.state}>
            <span>{text.market.consensus}</span>
            <strong>{shown}</strong>
            {consensus.state === 'value' && consensus.source === 'market'
              ? <em className="mi-economic-calendar__consensus-source">{text.details.consensusFromMarket}</em>
              : null}
          </div>
          {consensus.state === 'unreadable'
            ? <p className="mi-economic-calendar__comparison-rule" data-consensus-gap>{linkedConsensusFailure === true
              ? text.details.consensusReadFailedReason
              : text.details.consensusUnreadableReason}</p>
            : null}
        </>
      })()}
    </div>
    {blsUnavailableNotice ? <p className="mi-economic-calendar__comparison-rule" data-bls-unavailable role="status">{blsUnavailableNotice}</p> : null}
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
  /** Wall-clock text in the display zone; the picker is naive and interprets no zone. */
  const [draft, setDraft] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'rejected' | 'ambiguous'>('idle')
  const edited = event.releaseTimeSource === 'user-edited'
  const shown = releaseTimeText(event, text, timeZone, timeZoneLabel)
  /**
   * A row that carries an actual value has already been released: the time it happened is history,
   * and letting the reader move it would be editing the past. Those rows show the time as plain text.
   */
  const resolveKey = useProductTextKey()
  const canEdit = event.actual === undefined && event.lifecycleState === 'scheduled'

  const open = (): void => {
    const instant = event.scheduledAt
    // Filled from the display zone, the same zone the save path reads back. Formatting the instant
    // on the reader's machine here is what made the editor and the store disagree by an offset.
    setDraft(instant === undefined ? null : toWallClock(instant, timeZone) ?? null)
    setState('idle')
    setEditing(true)
  }

  async function save(): Promise<void> {
    if (draft === null) return
    const decision = resolveReleaseTimeWrite(draft, timeZone)
    if (decision.kind === 'ambiguous') { setState('ambiguous'); return }
    if (decision.kind === 'invalid') { setState('rejected'); return }
    setState('saving')
    const result = await client.setReleaseTime({
      eventKey: event.eventKey, scheduledAt: decision.instant, scheduledDate: decision.scheduledDate
    })
    if (result.state !== 'saved') { setState('rejected'); return }
    setState('saved')
    await onChanged()
    // A spring gap resolves forward, so the stored instant can differ from the text the reader
    // picked. Writing the correction back into the picker and leaving the row open is the only way
    // the reader sees what was stored: closing straight away would hide a value that changed.
    if (decision.correctedWallClock !== undefined) {
      setDraft(decision.correctedWallClock)
      return
    }
    setEditing(false)
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
            onChange={(value) => { setDraft(value === null ? null : value.format('YYYY-MM-DDTHH:mm')); setState('idle') }}
            showTime={{ format: 'HH:mm' }}
            value={draft === null ? null : dayjs(draft)}
          />
        : canEdit
          ? <span className="mi-economic-calendar__release-time-value">
              {shown}
              <IconButton
                ariaLabelKey="pages.intelligence.portal.calendar.details.editTime.label"
                icon={Pencil}
                onSelect={open}
                resolveText={resolveKey}
                size="sm"
              />
            </span>
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
  // The confirmation is rendered by the tree's own modal instance, so it follows the theme the reader
  // is in; the old `window.confirm` was a system sheet that ignored it entirely.
  const confirm = useConfirm()
  return <Button disabled={disabled} onClick={() => confirm({
    title: text.blsRefresh.title,
    description: text.blsRefresh.confirmation,
    confirmLabel: text.blsRefresh.confirm,
    cancelLabel: text.blsRefresh.cancel,
    tone: 'default',
    onConfirm: () => onRefresh('bls', eventKey)
  })} size="small">{pending ? text.blsRefresh.pending : text.blsRefresh.action}</Button>
}

function FedFomcRefreshAction({ disabled, eventKey, onRefresh, pending, text }: { disabled: boolean; eventKey: string; onRefresh: (operation: EconomicCalendarRefreshOperation, eventKey: string) => Promise<void>; pending: boolean; text: EconomicCalendarText }): ReactElement {
  const confirm = useConfirm()
  return <Button disabled={disabled} icon={<RefreshCw aria-hidden="true" size={14} />} onClick={() => confirm({
    title: text.fomcRefresh.action,
    description: text.fomcRefresh.confirmation,
    confirmLabel: text.fomcRefresh.confirm,
    cancelLabel: text.fomcRefresh.cancel,
    tone: 'default',
    onConfirm: () => onRefresh('fomc', eventKey)
  })} size="small">{pending ? text.fomcRefresh.pending : text.fomcRefresh.action}</Button>
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

function refreshActionPresentation(state: EconomicCalendarRefreshState | undefined, eventKey: string, operation: EconomicCalendarRefreshOperation, unavailable = false): { disabled: boolean; pending: boolean } {
  return {
    disabled: unavailable || Boolean(state?.pending),
    pending: Boolean(state?.pending && isRefreshStateFor(state, eventKey, operation))
  }
}

function dateOnly(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`
}

/**
 * The detail surface with nothing to show: its state, never a blank pane.
 *
 * A wait and a failed read are two different answers. This used to render the spinner for both,
 * so a read that had already failed span forever with the failure sentence underneath — the reader
 * waits for a result that is never coming. A wait stays `LoadingState`; a failure is
 * `error · unreadable` with a retry that asks again.
 */
export function EconomicCalendarEventDetailState(props: Readonly<{ text: string } & (
  | { state: 'loading' }
  | { state: 'error'; onRetry: () => void }
)>): ReactElement {
  // The retry is part of the error, not an option: `error · unreadable` promises the reader that
  // asking again is the way out, and a state that offers it only when the caller happened to pass a
  // callback renders the same state in two shapes. A caller with nothing to re-read has the wrong
  // state, not a missing prop.
  return <aside className="mi-economic-calendar__inspector" aria-live="polite">
    {props.state === 'loading'
      ? <LoadingState label={props.text} minHeight={220} />
      : <StateView state="error" reasonCode="unreadable" size="md"
          action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: props.onRetry }} />}
  </aside>
}

function Meta({ label, value }: { label: string; value: string }): ReactElement {
  return <div><dt>{label}</dt><dd>{value}</dd></div>
}
