import type { DailyBriefingEditionSummary, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingText } from './DailyBriefingDocumentView'
import { localizedDirectionTerm } from './analysisConclusionDirectionPolicy'

export function DailyBriefingHistoryRail({ editions, selectedDate, todayDate, locale, text, formatTime, onSelect }: Readonly<{
  editions: readonly DailyBriefingEditionSummary[]
  selectedDate?: string
  todayDate: string
  locale: DailyBriefingLocale
  text: DailyBriefingText
  formatTime?: (value: string, precision?: 'minute' | 'second') => string
  onSelect: (date: string) => void
}>): React.ReactElement {
  return <aside className="mi-daily-briefing__rail" aria-label={text.history.title}>
    <p className="mi-daily-briefing__rail-title">{text.history.title}</p>
    {editions.length === 0 ? <p className="mi-daily-briefing__rail-empty">{text.history.empty}</p> : null}
    <div role="list" className="mi-daily-briefing__rail-list">
      {editions.map((edition) => {
        const missing = edition.state === 'missing'
        const selected = edition.date === selectedDate
        return <div role="listitem" key={edition.date}>
          <button type="button" disabled={missing}
            aria-current={selected ? 'true' : undefined}
            data-date={edition.date} data-state={edition.state}
            className="mi-daily-briefing__rail-row" onClick={() => onSelect(edition.date)}>
            <span className="mi-daily-briefing__rail-line">
              <span className="mi-daily-briefing__rail-date">{formatDate(edition.date, locale)}</span>
              {edition.date === todayDate ? <em>{text.history.today}</em> : null}
              {!missing && edition.availableLocales.length > 1 ? <small>{text.history.otherLocale}</small> : null}
            </span>
            {missing ? <small className="mi-daily-briefing__rail-missing">{text.history.missingRun}</small> : <>
              <span className="mi-daily-briefing__rail-direction" data-direction={edition.direction ?? 'none'}>
                {edition.direction ? localizedDirectionTerm(edition.direction, locale) : text.history.noConclusion}
              </span>
              {edition.summaryLine ? <span className="mi-daily-briefing__rail-summary">{edition.summaryLine}</span> : null}
              <small className="mi-daily-briefing__rail-meta">
                {edition.readingsAvailable ?? 0}/4{edition.generatedAt ? ` · ${formatTime ? formatTime(edition.generatedAt, 'minute') : edition.generatedAt.slice(11, 16)} ${text.history.generated}` : ''}
              </small>
            </>}
          </button>
        </div>
      })}
    </div>
  </aside>
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
