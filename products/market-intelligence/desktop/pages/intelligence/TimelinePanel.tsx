import type { MarketAnalysisTimelineEntry } from '../../shared/ipc/marketAnalysisTimelineClient'
import { MarketAnalysisTimeline, type MarketAnalysisTimelineText } from './MarketAnalysisTimeline'
import type { UseMarketAnalysisTimelineResult } from './useMarketAnalysisTimeline'

/**
 * Timeline list surface for the Agent column. It renders the list only; the node
 * detail drawer is rendered by the dashboard pane so it can slide over the
 * dashboard instead of being clipped by the Agent column.
 *
 * Selecting a node does both jobs the user expects: it reports the node so the
 * drawer can open, and it binds the conversation to that node.
 */
export function TimelinePanel({ text, timeline, onOpenChange, onOpenSettings }: Readonly<{
  text: MarketAnalysisTimelineText
  timeline: UseMarketAnalysisTimelineResult
  openEntry?: MarketAnalysisTimelineEntry
  onOpenChange: (entry: MarketAnalysisTimelineEntry | undefined) => void
  /** 宿主的「打开 AI 分析设置」入口；给了就不在时间线里再挂一个对话框。 */
  onOpenSettings?: () => void
}>): React.ReactElement {
  return <MarketAnalysisTimeline
    text={text}
    timeline={timeline}
    onSelect={entry => { onOpenChange(entry); void timeline.select(entry) }}
    {...(onOpenSettings === undefined ? {} : { onOpenSettings })}
  />
}
