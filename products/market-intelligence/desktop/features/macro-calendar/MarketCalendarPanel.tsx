import { RefreshCw } from 'lucide-react'
import { Button } from 'antd'

import type { CalendarFeedDefinition } from '../../../service/intelligence/macro-calendar/calendarFeedRegistry'

export type MarketCalendarText = {
  title: string
  description: string
  refresh: string
  refreshing: string
  succeeded: string
  failed: string
  feeds: Readonly<Record<string, string>>
  owner: string
}

export function MarketCalendarPanel({ feeds, feedback, refreshing, text, onRefresh }: {
  feeds: readonly CalendarFeedDefinition[]
  feedback?: 'succeeded' | 'failed'
  refreshing: boolean
  text: MarketCalendarText
  onRefresh: () => void
}): React.ReactElement {
  return <div className="mi-dashboard-source-market-calendar">
    <p>{text.description}</p>
    <ul>
      {feeds.map((feed) => <li key={feed.feedId}>
        <strong>{text.feeds[feed.feedId] ?? feed.displayName}</strong>
        <small>{text.owner}</small>
      </li>)}
    </ul>
    <Button
      className="ant-secondary-button"
      disabled={refreshing}
      icon={<RefreshCw size={14} />}
      loading={refreshing}
      size="small"
      onClick={onRefresh}
    >
      {refreshing ? text.refreshing : text.refresh}
    </Button>
    {feedback ? <small data-tone={feedback === 'succeeded' ? 'success' : 'error'}>{text[feedback]}</small> : null}
  </div>
}
