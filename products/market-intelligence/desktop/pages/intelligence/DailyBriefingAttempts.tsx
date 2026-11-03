import { useState } from 'react'

import { LoadingState } from '@platform/ui/components/loading'

import type { DailyBriefingAttemptRecord, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingClientAttemptsResult } from '../../shared/ipc/dailyBriefingClient'
import type { DailyBriefingText } from './dailyBriefingText'

type AttemptsState =
  | Readonly<{ status: 'idle' | 'loading' }>
  | Readonly<{ status: 'ready'; attempts: readonly DailyBriefingAttemptRecord[] }>
  | Readonly<{ status: 'unavailable' }>

/**
 * The attempt trail of the edition on screen, as the last block of the right-hand detail column.
 *
 * It used to hang off every row in the history rail, which put a second expander and a count into a
 * row that already had a date, a language switch and a meta line. The trail belongs to the edition
 * being read, so it sits with the other per-edition detail, and it keeps its number here: this is
 * the one place that lists the attempts.
 */
export function DailyBriefingAttempts({ date, periodId, locale, text, loadAttempts }: Readonly<{
  date: string
  periodId: string
  locale: DailyBriefingLocale
  text: DailyBriefingText
  /** Absent when the client cannot read attempts; the block then does not render at all. */
  loadAttempts?: (date: string, periodId: string, locale: DailyBriefingLocale) => Promise<DailyBriefingClientAttemptsResult>
}>): React.ReactElement | null {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<AttemptsState>({ status: 'idle' })
  if (!loadAttempts) return null

  const toggle = (next: boolean): void => {
    setOpen(next)
    if (!next || state.status === 'ready' || state.status === 'unavailable') return
    setState({ status: 'loading' })
    void loadAttempts(date, periodId, locale)
      .then((result) => setState(result.state === 'available'
        ? { status: 'ready', attempts: result.attempts }
        : { status: 'unavailable' }))
      .catch(() => setState({ status: 'unavailable' }))
  }

  // The same disclosure the stage list and the gap list use: native details, the whole summary line
  // is the target, and the summary carries the state word — never a button of its own.
  return <details className="mi-briefing-attempts" data-briefing-attempts="true" open={open}
    onToggle={(event) => toggle((event.currentTarget as HTMLDetailsElement).open)}>
    <summary className="mi-briefing-detail__head">
      <h3>{text.history.attempts.title}</h3>
    </summary>
    <div className="mi-briefing-attempts__list" role="group" aria-label={text.history.attempts.title}>
      {state.status !== 'ready' && state.status !== 'unavailable' ? <LoadingState label={text.history.loading} minHeight={40} /> : null}
      {state.status === 'unavailable' ? <p data-attempts-unreadable="true">{text.history.attempts.unreadable}</p> : null}
      {state.status === 'ready' && state.attempts.length === 0 ? <p>{text.history.attempts.none}</p> : null}
      {state.status === 'ready' ? state.attempts.map((attempt) =>
        <p key={attempt.attemptNo} className="mi-briefing-attempts__row" data-attempt={attempt.attemptNo} data-state={attempt.state}>
          <span>{text.history.attempts.nth.replace('{n}', String(attempt.attemptNo))}</span>
          <span>{attempt.state === 'failed' ? text.history.attempts.failed : attempt.state === 'running' ? text.history.attempts.running : text.history.attempts.succeeded}</span>
          {attempt.cleanedAt ? <em>{text.history.attempts.cleaned}</em> : null}
          {attempt.failureCode ? <small>{(text.aiSettings.failure as Readonly<Record<string, string>>)[attempt.failureCode] ?? attempt.failureCode}</small> : null}
        </p>) : null}
    </div>
  </details>
}
