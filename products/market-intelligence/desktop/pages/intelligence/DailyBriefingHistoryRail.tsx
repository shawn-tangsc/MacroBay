import type { DailyBriefingEditionSummary, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingText } from './DailyBriefingDocumentView'

export function DailyBriefingHistoryRail({ editions, selectedDate, todayDate, locale, text, onSelect }: Readonly<{
  editions: readonly DailyBriefingEditionSummary[]
  selectedDate?: string
  todayDate: string
  locale: DailyBriefingLocale
  text: DailyBriefingText
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
            <span className="mi-daily-briefing__rail-date">{formatDate(edition.date, locale)}</span>
            <span className="mi-daily-briefing__rail-tags">
              {edition.date === todayDate ? <em>{text.history.today}</em> : null}
              {missing ? <small>{text.history.missing}</small> : edition.availableLocales.length > 1 ? <small>{text.history.otherLocale}</small> : null}
            </span>
            {edition.direction ? <i data-direction={edition.direction} aria-hidden="true" /> : null}
          </button>
        </div>
      })}
    </div>
  </aside>
}

export function formatRailDate(date: string, locale: DailyBriefingLocale): string {
  const parsed = Date.parse(`${date}T00:00:00.000Z`)
  if (!Number.isFinite(parsed)) return date
  return new Intl.DateTimeFormat(locale, { month: 'short', day: '2-digit', timeZone: 'UTC' }).format(new Date(parsed))
}

const formatDate = formatRailDate
