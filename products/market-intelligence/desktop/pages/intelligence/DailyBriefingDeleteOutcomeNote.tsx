import { Button } from 'antd'

import type { BriefingDeleteOutcome } from './useDailyBriefingIssueDeletion'
import type { DailyBriefingText } from './dailyBriefingText'

/**
 * What the page says when a delete only half finished. One line, the real count when the reply
 * carries one ("还剩 N 条"), "无法确认" when it does not — never a zero that nobody measured.
 */
export function DailyBriefingDeleteOutcomeNote({ outcome, text, onRetry }: Readonly<{
  outcome: BriefingDeleteOutcome
  text: DailyBriefingText
  onRetry: (outcome: BriefingDeleteOutcome) => void
}>): React.ReactElement {
  return <p className="mi-daily-briefing-page__loading-hint" role="alert" data-delete-outcome="true">
    {outcome.remaining === null
      ? text.history.deleteUnknownRemaining
      : text.history.deletePartial.replace('{count}', String(outcome.remaining))}{' '}
    <Button onClick={() => onRetry(outcome)} type="link">{text.history.deleteRetry}</Button>
  </p>
}
