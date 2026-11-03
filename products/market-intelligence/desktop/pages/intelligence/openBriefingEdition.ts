import type { DailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import type { DailyBriefingPageViewState } from './dailyBriefingPageViewState'

/**
 * The one way an edition is read.
 *
 * A row click and a language switch both land here, with the day the reader is on and the language
 * they asked for. It never generates: reading is a read, and the two entries that can start a run
 * (the header action and the explicit "generate this edition" control) are elsewhere.
 *
 * Kept out of the page because it is a decision table — ready, not run, failed, missing in this
 * language, unreadable — and the page carries enough of those already.
 */
export function openBriefingEdition(input: Readonly<{
  client: Pick<DailyBriefingClient, 'get'>
  /** The day the reader selected, and the language they want to read it in. */
  date: string
  locale: 'zh-CN' | 'en-US'
  /** The row this day has in the list, when the caller already knows it. */
  row?: Readonly<{ state: string; attemptCount?: number }>
  /** Every row the rail holds; a day with no row at all has no edition. */
  rows: readonly Readonly<{ date: string; state: string; attemptCount?: number }>[]
  todayDate: string
  /** The pane as it stands, so a same-day/same-language read is not repeated. */
  current: DailyBriefingPageViewState
  /** The page's request counter: a slower answer must not overwrite a newer one. */
  /** Mutable on purpose: the counter is the page's, and this call claims the next ticket. */
  request: { current: number }
  onStart: (date: string) => void
  onFailureCleared: () => void
  setView: (next: DailyBriefingPageViewState | ((current: DailyBriefingPageViewState) => DailyBriefingPageViewState)) => void
}>): void {
  const { client, date, locale, rows, todayDate, current, request, setView } = input
  const row = input.row ?? rows.find((candidate) => candidate.date === date)
  if (current.status === 'ready' && current.document.edition.date === date && current.document.edition.locale === locale) return
  input.onStart(date)
  const ticket = ++request.current
  input.onFailureCleared()
  // No row at all: the list does not carry this day, so it has no edition in any language.
  if (!row) {
    setView({ status: 'locale-missing', locale, ...(date !== todayDate ? { date, historical: true } : {}) })
    return
  }
  // A day that did not run says which of the two nothing-states it is, and reads nothing at all
  // unless an attempt left a failure behind.
  if (row.state === 'missing') {
    setView({ status: 'no-edition', date, failed: Boolean(row.attemptCount) })
    if (!row.attemptCount) return
  }
  setView((previous) => previous.status === 'no-edition' && previous.date === date ? previous : { status: 'loading' })
  void client.get({ date, locale })
    .then((result) => {
      if (ticket !== request.current) return
      if (result.state === 'available') {
        setView({ status: 'ready', document: result.document, kind: date === todayDate ? 'today' : 'history' })
      } else if (row.state === 'missing') {
        setView({
          status: 'no-edition',
          date,
          failed: result.state === 'unavailable',
          ...(result.state === 'unavailable' ? { failureCode: result.failureCode } : {})
        })
      } else if (result.state === 'missing') {
        // The day is always carried: the sentence's subject ("this issue" / "this day") is decided
        // from it, so leaving it out let a past day be described as today.
        setView({ status: 'locale-missing', locale, date, ...(date !== todayDate ? { historical: true } : {}) })
      } else {
        setView({ status: 'unavailable', failureCode: result.failureCode })
      }
    })
    .catch(() => { if (ticket === request.current) setView({ status: 'no-edition', date, failed: row.state === 'missing' }) })
}
