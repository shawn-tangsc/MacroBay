import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { formatShellTimeZoneLabel } from '@platform/ui/time/shellTimeFormat'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import type { MarketCalendarEvent, MarketCalendarSource } from '../../../../contracts/macro/marketCalendarQueryContracts'
import {
  assessMarketCalendarSurprise,
  toCalendarSurpriseView,
  type MarketCalendarSurpriseAssessment
} from '../../../../contracts/macro/marketCalendarSurprise'
import { formatReadableAnalysisValue } from '../../../../contracts/marketAnalysisReadableText'
import type { EconomicCalendarText } from './EconomicCalendar'
import { calendarDisplayDate, calendarDisplayTime } from './economicCalendarDayModel'
import { MarketCalendarSourceStatus } from './MarketCalendarSourceStatus'

export function MarketCalendarInspector({ event, source, text }: { event: MarketCalendarEvent; source?: MarketCalendarSource; text: EconomicCalendarText }) {
  const timeZone = useShellTimeZone()
  const language = useShellLanguage()
  const timeZoneLabel = formatShellTimeZoneLabel(timeZone, language)
  const formatTime = useShellTimeFormat()
  // CalendarObservedDataTimePolicy: a paged read may advance a source past the observation the reader
  // selected, so the live source and the observation legitimately disagree. The observation is still
  // shown — with **its own** values and the time it belongs to — and the disagreement is reported by
  // the status line below rather than blanking the pane. The newer source's time is never attached to
  // the older reading: that is the rule this used to enforce by rendering nothing at all.
  const sourceAgrees = source !== undefined && source.eventType === event.eventType &&
    source.sourceObservedAt === event.sourceObservedAt
  const shownSource: MarketCalendarSource = sourceAgrees
    ? source
    : { eventType: event.eventType, status: 'success', sourceObservedAt: event.sourceObservedAt }
  return <aside className="mi-economic-calendar__inspector mi-market-calendar__inspector" aria-live="polite">
    <p>{text.market.source} · {text.market.kinds[event.eventType]}</p><h2>{event.title}</h2>
    <p><MarketCalendarSourceStatus source={shownSource} text={text} /></p>
    <dl className="mi-economic-calendar__metadata">
      <div><dt>{text.details.time}</dt><dd>{calendarDisplayDate(event.scheduledAt, timeZone)} {calendarDisplayTime(event.scheduledAt, timeZone)} {timeZoneLabel}</dd></div>
      <div><dt>{text.market.observed}</dt><dd>{formatTime(event.sourceObservedAt, 'second')}</dd></div>
      <div><dt>{text.details.source}</dt><dd data-market-country>{event.countryName ?? event.countryCode ?? text.market.unknownCountry} · {text.market.source}</dd></div>
      <div data-market-importance><dt>{text.details.importance}</dt><dd>{text.market.importance[event.importance]}</dd></div>
    </dl>
    {event.eventType === 'economic-indicator' ? <div className="mi-economic-calendar__values">
      {(['consensus', 'providerActual', 'providerPrevious'] as const).map(key => <div key={key} data-market-value={key}>
        <span>{text.market[key]}</span><strong>{event[key]?.displayValue ?? text.market.missingValue}</strong>
      </div>)}
      {/* 预期差读契约同一函数：三种语态与看板卡片逐字一致，缺少预期时不出现任何数字。 */}
      {event.providerActual ? <div data-market-value="surprise" data-surprise={toCalendarSurpriseView(surpriseAssessment(event))}>
        <span>{text.market.surprise}</span><strong>{surpriseText(surpriseAssessment(event), text, language)}</strong>
      </div> : null}
    </div> : null}
    {event.officialLink ? <div data-linked-official-values>
      <div data-linked-value="officialActual"><span>{text.market.officialActual}</span><strong>{event.officialLink.officialActual?.displayValue ?? text.market.missingValue}</strong></div>
      <div data-linked-value="officialPrevious"><span>{text.market.officialPrevious}</span><strong>{event.officialLink.officialPrevious?.displayValue ?? text.market.missingValue}</strong></div>
      <p data-linked-time-source>{event.officialLink.timeDisplaySource === 'official-scheduled' ? text.market.linkedTimeOfficial : event.officialLink.timeDisplaySource === 'provider-scheduled' ? text.market.linkedTimeProvider : text.market.linkedTimePending} · {event.officialLink.displayScheduledAt ?? text.market.missingValue}</p>
    </div> : null}
    <p className="mi-economic-calendar__comparison-rule">{text.market.comparison}</p>
  </aside>
}

function surpriseAssessment(event: MarketCalendarEvent): MarketCalendarSurpriseAssessment {
  return assessMarketCalendarSurprise(event.providerActual, event.consensus)
}

/** The drawer's sentence for one assessment; no number is printed without a presentation. */
function surpriseText(
  assessment: MarketCalendarSurpriseAssessment,
  text: EconomicCalendarText,
  locale: 'zh-CN' | 'en-US'
): string {
  const direction = toCalendarSurpriseView(assessment)
  if (direction === 'consensus-unavailable') {
    return assessment.reason === 'missing-consensus' ? text.market.surpriseUnavailable : text.market.surpriseNotComparable
  }
  const label = direction === 'beat' ? text.market.surpriseBeat
    : direction === 'miss' ? text.market.surpriseMiss : text.market.surpriseInline
  if (direction === 'inline' || assessment.presentation === null) return label
  return `${label} ${formatReadableAnalysisValue(assessment.presentation.value, assessment.presentation.unit, locale)}`
}
