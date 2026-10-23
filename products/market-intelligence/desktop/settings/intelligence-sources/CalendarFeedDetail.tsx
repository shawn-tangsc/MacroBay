import { Alert } from 'antd'

import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { calendarFeedRegistry, listCalendarFeeds, type CalendarFeedId } from '../../../service/intelligence/macro-calendar/calendarFeedRegistry'
import { productText } from '../../shared/i18n/productText'
import MacroCalendarSettings from '../../settings/macro-calendar'
import { MarketCalendarPanel } from '../../features/macro-calendar/MarketCalendarPanel'
import { useMarketCalendarFeed } from '../../features/macro-calendar/useMarketCalendarFeed'
import { BlsScheduleControls } from '../../features/macro-calendar/BlsScheduleControls'
import { useBlsScheduleSync } from '../../features/macro-calendar/useBlsScheduleSync'

type MacroCalendarText = (typeof productText)[keyof typeof productText]['settings']['macroCalendar']

/**
 * Calendar feed detail inside the unified source catalog. It composes the same
 * provider, market, and BLS components as the dashboard drawer so the calendar
 * sources have one inventory and one behavior.
 */
export function CalendarFeedDetail({ feedId }: { feedId: CalendarFeedId }): React.ReactElement {
  const language = useShellLanguage()
  const text = productText[language].settings.macroCalendar
  const feed = calendarFeedRegistry[feedId]
  if (!feed) return <Alert message={text.unavailable} showIcon type="error" />
  if (feedId === 'macro-calendar-fed' || feedId === 'macro-calendar-bea') {
    return <MacroCalendarSettings providerId={feedId} />
  }
  if (feedId === 'macro-calendar-bls') return <BlsCalendarDetail text={text} />
  if (feed.owner === 'market') return <MarketCalendarDetail text={text} />
  return <Alert message={`${text.pendingFeeds.coinMarketCal} · ${text.pendingFeeds.hint}`} showIcon type="warning" />
}

function BlsCalendarDetail({ text }: { text: MacroCalendarText }): React.ReactElement {
  const bls = useBlsScheduleSync('macro-calendar-bls')
  return <section className="macro-calendar-settings">
    <header className="macro-calendar-settings__header">
      <h2>{text.blsCard.title}</h2>
      <p>{text.blsCard.description}</p>
    </header>
    <BlsScheduleControls
      feedback={bls.feedback}
      pending={bls.pending}
      selected="macro-calendar-bls"
      text={text.blsSchedule}
      onSync={bls.sync}
    />
  </section>
}

function MarketCalendarDetail({ text }: { text: MacroCalendarText }): React.ReactElement {
  const market = useMarketCalendarFeed()
  const feeds = listCalendarFeeds().filter((feed) => feed.owner === 'market')
  return <section className="macro-calendar-settings">
    <header className="macro-calendar-settings__header">
      <h2>{text.marketCalendar.title}</h2>
      <p>{text.marketCalendar.description}</p>
    </header>
    <MarketCalendarPanel
      feeds={feeds}
      feedback={market.feedback}
      refreshing={market.refreshing}
      text={text.marketCalendar}
      onRefresh={() => void market.refresh()}
    />
  </section>
}
