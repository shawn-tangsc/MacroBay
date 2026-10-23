import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import type { MarketCalendarSource } from '../../../../contracts/macro/marketCalendarQueryContracts'
import type { EconomicCalendarText } from './EconomicCalendar'
import { marketCalendarAutomaticRefreshPolicy } from './marketCalendarAutomaticPolicy'

// CalendarObservedDataTimePolicy (133): receipt time is never page-open time.
// Missing runtime attempt after restart means unattempted, not healthy/latest.
// The automatic-refresh note is stated explicitly because this source is now
// refreshed by the product itself, so a stale timestamp means a failed automatic
// run rather than "nobody pressed refresh". A failed run also names its verdict and
// origin here: an automatic tick refused by the shared calendar ceiling used to be
// invisible, so the page looked like a source that had simply published nothing.
export function MarketCalendarSourceStatus({ source, text }: { source: MarketCalendarSource; text: EconomicCalendarText }) {
  const formatTime = useShellTimeFormat()
  const attempt = source.latestAttempt
  const failed = attempt?.state === 'failed'
  return <span className="mi-calendar-detail-status" data-market-source-status={source.eventType}
    data-automatic-refresh={marketCalendarAutomaticRefreshPolicy.automatic ? 'true' : 'false'}>
    {text.market.kinds[source.eventType]} · {attempt ? text.market.refreshOutcome[attempt.state] : text.market.refreshOutcome.unattempted}
    {attempt?.trigger ? <> · {text.market.refreshTrigger[attempt.trigger]}</> : null}
    {attempt?.failureCode ? <> · {text.market.attemptFailure[attempt.failureCode]}</> : null}
    {' · '}{text.market.statuses[source.status]}
    {source.sourceObservedAt ? <> · {failed ? text.market.retainedData : text.market.collectedAt} <time>{formatTime(source.sourceObservedAt, 'second')}</time></> : null}
    {marketCalendarAutomaticRefreshPolicy.automatic
      ? <> · {text.market.automaticRefresh.replace('{interval}', String(marketCalendarAutomaticRefreshPolicy.intervalMinutes))}</>
      : null}
  </span>
}
