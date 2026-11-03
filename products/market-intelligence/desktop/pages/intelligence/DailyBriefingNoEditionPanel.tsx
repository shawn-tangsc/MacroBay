import { Button } from 'antd'
import { formatShellTimeZoneLabel } from '@platform/ui/time/shellTimeFormat'

import type { DailyBriefingPageViewState } from './dailyBriefingPageViewState'
import { DailyBriefingFailurePanel } from './DailyBriefingFailurePanel'
import type { DailyBriefingText } from './dailyBriefingText'

/** What the pane says for one day the reader selected that has nothing to read. */
export function DailyBriefingNoEditionPanel({ view, text, timeZone, scheduledTime, formatTime, onOpenSettings }: Readonly<{
  view: Extract<DailyBriefingPageViewState, { status: 'no-edition' }>
  text: DailyBriefingText
  timeZone: string
  scheduledTime?: string
  formatTime: (value: string, precision?: 'minute' | 'second') => string
  onOpenSettings: () => void
}>): React.ReactElement {
  const labels = text.history
  // The one thing this version cannot do. The control is disabled and says so in its accessible
  // name: a day without an edition is not an invitation to write today's into its place.
  const backfill = <Button disabled aria-label={labels.backfillBlocked} title={labels.backfillBlocked}>
    {labels.backfillAction}
  </Button>

  if (view.failed) {
    return <DailyBriefingFailurePanel
      failure={{ kind: 'generation', ...(view.failureCode ? { code: view.failureCode } : {}), ...(view.generationTrace ? { generationTrace: view.generationTrace } : {}) }}
      text={text}
      formatTime={formatTime}
      regenerating={false}
      retryBlockedReason={labels.backfillBlocked}
      onRetry={() => undefined}
      onOpenSettings={onOpenSettings}
    />
  }

  return <div className="mi-daily-briefing-page__no-edition" data-briefing-no-edition={view.date} role="status">
    <h2>{labels.notRunTitle}</h2>
    <p>{scheduledTime
      ? labels.notRunPlanned.replace('{time}', scheduledTime).replace('{zone}', formatShellTimeZoneLabel(timeZone))
      : labels.notRunUnknownPlanned}</p>
    {backfill}
  </div>
}
