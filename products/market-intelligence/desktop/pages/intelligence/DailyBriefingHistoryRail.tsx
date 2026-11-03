import { useState } from 'react'

import { LoadingState } from '@platform/ui/components/loading'
import { StateView } from '@platform/ui/components/state'
import { StatusPill } from '@platform/ui/components/status-pill'
import type { DailyBriefingAttemptRecord, DailyBriefingEditionSummary, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingClientAttemptsResult } from '../../shared/ipc/dailyBriefingClient'
import { resolveBriefingStateReason, type DailyBriefingText } from './dailyBriefingText'
import { localizedDirectionTerm } from './analysisConclusionDirectionPolicy'

type AttemptsState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'ready'; attempts: readonly DailyBriefingAttemptRecord[] }>
  | Readonly<{ status: 'unavailable' }>

/**
 * The history rail: one row per (day, issue), the languages of that issue switching in place.
 *
 * The grouping is done by the service — this component never decides which rows belong together,
 * which languages an issue has, or whether an issue is incomplete. It renders what the list says,
 * and when a row is expanded it asks for that issue's attempts; a failed read is stated, not drawn
 * as "no attempts".
 */
export function DailyBriefingHistoryRail({ editions, failed = false, loading = false, onRetry, selectedDate, selectedLocale, todayDate, locale, text, timeZone, generatingStage, resolveText, onSelect, onLoadAttempts }: Readonly<{
  editions: readonly DailyBriefingEditionSummary[]
  /** True until the list has been read once: an empty rail then means "not read yet", not "none". */
  loading?: boolean
  /** True when the read itself failed: an empty rail then means "could not read", not "none". */
  failed?: boolean
  /** Reads the list again; only used by the failure state. */
  onRetry?: () => void
  selectedDate?: string
  selectedLocale?: DailyBriefingLocale
  todayDate: string
  locale: DailyBriefingLocale
  text: DailyBriefingText
  /** The reader's display zone; the row shows only HH:mm, so the date and the offset stay out. */
  timeZone: string
  /** Set while today's edition is being generated, so the rail never says "not generated" then. */
  generatingStage?: string
  /** Product text resolver for the status pill's key; absent means no pill. */
  resolveText?: (key: string) => string
  onSelect: (date: string, locale?: DailyBriefingLocale) => void
  /** Reads one issue's attempts on expand; absent means the rail offers no attempt history. */
  onLoadAttempts?: (date: string, periodId: string, locale: DailyBriefingLocale) => Promise<DailyBriefingClientAttemptsResult>
}>): React.ReactElement {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [attempts, setAttempts] = useState<Readonly<Record<string, AttemptsState>>>({})

  const expand = (key: string, date: string, periodId: string): void => {
    if (expanded === key) {
      setExpanded(null)
      return
    }
    setExpanded(key)
    if (attempts[key]?.status === 'ready' || !onLoadAttempts) return
    setAttempts((current) => ({ ...current, [key]: { status: 'loading' } }))
    void onLoadAttempts(date, periodId, locale)
      .then((result) => setAttempts((current) => ({
        ...current,
        [key]: result.state === 'available' ? { status: 'ready', attempts: result.attempts } : { status: 'unavailable' }
      })))
      .catch(() => setAttempts((current) => ({ ...current, [key]: { status: 'unavailable' } })))
  }

  return <aside className="mi-daily-briefing__rail" aria-label={text.history.title}>
    <p className="mi-daily-briefing__rail-title">{text.history.title}</p>
    {loading && editions.length === 0 ? <LoadingState label={text.history.loading} /> : failed && editions.length === 0 && onRetry ? <StateView
      action={{ labelKey: 'ui.state.action.retry', onSelect: onRetry }}
      reasonCode="unreadable"
      size="md"
      state="error"
    /> : editions.length === 0 ? <StateView
      state="empty"
      reasonCode="not-yet"
      size="md"
      className="mi-daily-briefing__rail-state"
      productReason={{
        key: 'mi.dailyBriefing.noEditions',
        resolve: (key, params) => resolveBriefingStateReason(text, key, params)
      }}
    /> : null}
    <div role="list" className="mi-daily-briefing__rail-list">
      {editions.map((edition) => {
        const missing = edition.state === 'missing'
        // One row is one issue, whatever language of it is on screen: the row stays current when the
        // reader switches language in place, and the pressed language follows what is shown.
        const selected = edition.date === selectedDate
        const shownLocale = selected ? (selectedLocale ?? edition.locale) : edition.locale
        const key = `${edition.date}:${edition.periodId}:${edition.locale}`
        const open = expanded === key
        const shown = attempts[key]
        return <div role="listitem" key={key} className="mi-daily-briefing__rail-item" data-period={edition.periodId}>
          <button type="button" disabled={missing}
            aria-current={selected ? 'true' : undefined}
            data-date={edition.date} data-state={edition.state}
            className="mi-daily-briefing__rail-row" onClick={() => onSelect(edition.date, edition.locale)}>
            <span className="mi-daily-briefing__rail-line">
              <span className="mi-daily-briefing__rail-date">{formatDate(edition.date, locale)}</span>
              {edition.date === todayDate ? <em>{text.history.today}</em> : null}
              {edition.state === 'partial' && resolveText
                ? <StatusPill tone="warn" labelKey="pages.intelligence.portal.dashboard.dailyBriefing.status.partial" resolveText={resolveText} />
                : null}
            </span>
            {missing ? <small className="mi-daily-briefing__rail-missing">{
              edition.date === todayDate && generatingStage
                ? text.generationProgress.railRunning + ' · ' + generatingStage
                : `${text.history.missingRun}${edition.date === todayDate && edition.scheduledTime ? ` · ${edition.scheduledTime}` : ''}`
            }</small> : <>
              {edition.direction
                // A direction, when present, is the row's word; when absent the dot alone carries
                // it, with the word for screen readers instead of repeating "no conclusion" daily.
                ? <span className="mi-daily-briefing__rail-direction" data-direction={edition.direction}>{localizedDirectionTerm(edition.direction, locale)}</span>
                : <span className="mi-daily-briefing__rail-direction mi-daily-briefing__rail-direction--none" role="img" aria-label={text.history.noConclusion} />}
              {edition.summaryLine ? <span className="mi-daily-briefing__rail-summary">{edition.summaryLine}</span> : null}
              <small className="mi-daily-briefing__rail-meta">
                {/* Segments never break mid-word: the width is the fix, these keep each fact whole. */}
                <span className="mi-daily-briefing__rail-fact">{edition.readingsAvailable ?? 0} {text.readingsUnit}</span>
                {edition.generatedAt ? <>
                  <span className="mi-daily-briefing__rail-sep" aria-hidden="true">·</span>
                  <span className="mi-daily-briefing__rail-fact">{railClock(edition.generatedAt, timeZone)}</span>
                </> : null}
              </small>
            </>}
          </button>
          <div className="mi-daily-briefing__rail-side">
            {!missing && edition.availableLocales.length > 1 ? edition.availableLocales.map((available) =>
              <button key={available} type="button" aria-pressed={available === shownLocale}
                className="mi-daily-briefing__rail-lang" data-locale={available}
                onClick={() => onSelect(edition.date, available)}>
                {text.history.languages[available]}
              </button>) : null}
          </div>
          {!missing && onLoadAttempts ? <button type="button" className="mi-daily-briefing__rail-attempts-toggle"
            aria-expanded={open} data-attempts-toggle={edition.date}
            onClick={() => expand(key, edition.date, edition.periodId)}>
            {/* The count belongs to the attempt list below it: repeating it on the row was the same
                fact twice, and the row's own meta is the item count and the clock. */}
            {open ? text.history.attempts.hide : text.history.attempts.show}
          </button> : null}
          {open ? <div className="mi-daily-briefing__rail-attempts" role="group" aria-label={text.history.attempts.title}>
            {shown?.status !== 'ready' && shown?.status !== 'unavailable' ? <LoadingState label={text.history.loading} minHeight={40} /> : null}
            {shown?.status === 'unavailable' ? <small data-attempts-unreadable="true">{text.history.attempts.unreadable}</small> : null}
            {shown?.status === 'ready' && shown.attempts.length === 0 ? <small>{text.history.attempts.none}</small> : null}
            {shown?.status === 'ready' ? shown.attempts.map((attempt) =>
              <p key={attempt.attemptNo} className="mi-daily-briefing__rail-attempt" data-attempt={attempt.attemptNo} data-state={attempt.state}>
                <span>{text.history.attempts.nth.replace('{n}', String(attempt.attemptNo))}</span>
                <span>{attempt.state === 'failed' ? text.history.attempts.failed : attempt.state === 'running' ? text.history.attempts.running : text.history.attempts.succeeded}</span>
                {attempt.cleanedAt ? <em>{text.history.attempts.cleaned}</em> : null}
                {attempt.failureCode ? <small>{(text.aiSettings.failure as Readonly<Record<string, string>>)[attempt.failureCode] ?? attempt.failureCode}</small> : null}
              </p>) : null}
          </div> : null}
        </div>
      })}
    </div>
  </aside>
}

/** `HH:mm` in the reader's zone: the row's date is on the line above, the offset is the setting's. */
export function railClock(instant: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(instant))
  } catch {
    return instant.slice(11, 16)
  }
}

export function formatRailDate(date: string, locale: DailyBriefingLocale): string {
  const parsed = Date.parse(`${date}T00:00:00.000Z`)
  if (!Number.isFinite(parsed)) return date
  const value = new Date(parsed)
  const day = new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit', timeZone: 'UTC' }).format(value)
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(value)
  return `${day} ${weekday}`
}

const formatDate = formatRailDate
