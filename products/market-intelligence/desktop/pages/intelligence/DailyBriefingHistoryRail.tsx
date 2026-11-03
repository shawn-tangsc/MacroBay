import { LoadingState } from '@platform/ui/components/loading'
import { StateView } from '@platform/ui/components/state'
import { StatusPill } from '@platform/ui/components/status-pill'
import type { DailyBriefingEditionSummary, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { resolveBriefingStateReason, type DailyBriefingText } from './dailyBriefingText'
import { localizedDirectionTerm } from './analysisConclusionDirectionPolicy'

/**
 * The history rail: one row per (day, issue), the languages of that issue switching in place.
 *
 * The grouping is done by the service — this component never decides which rows belong together,
 * which languages an issue has, or whether an issue is incomplete. It renders what the list says;
 * the attempt trail belongs to the edition on screen and lives in the detail column, so a row here
 * stays one line of facts.
 */
export function DailyBriefingHistoryRail({ editions, failed = false, loading = false, onRetry, selectedDate, selectedLocale, todayDate, locale, text, timeZone, generatingStage, resolveText, onSelect }: Readonly<{
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
}>): React.ReactElement {
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
              // Four states, one line each: a run in flight names its stage; a run that failed says
              // so (its reason lives in the attempt list); a day that did not run says only that.
              edition.date === todayDate && generatingStage
                ? `${text.generationProgress.railRunning} · ${generatingStage}`
                : edition.attemptCount
                  ? `${text.history.generationFailed}${edition.scheduledTime ? ` · ${edition.scheduledTime}` : ''}`
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
              {/* Read-only fact about this issue, not a control: it stays flat and out of Tab order. */}
              {languageTag(edition.availableLocales) ? <span className="mi-daily-briefing__rail-edition-lang" data-edition-languages={languageTag(edition.availableLocales)}>
                {text.history.editionLanguages[languageTag(edition.availableLocales)!]}
              </span> : null}
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
        </div>
      })}
    </div>
  </aside>
}

/** Which languages this issue has; absent when it has no edition at all. */
export function languageTag(availableLocales: readonly DailyBriefingLocale[]): 'zh' | 'en' | 'both' | undefined {
  const zh = availableLocales.includes('zh-CN')
  const en = availableLocales.includes('en-US')
  if (zh && en) return 'both'
  if (en) return 'en'
  if (zh) return 'zh'
  return undefined
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
