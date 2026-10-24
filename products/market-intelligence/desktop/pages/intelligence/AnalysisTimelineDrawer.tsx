import { Drawer } from 'antd'

import type { MarketAnalysisTimelineEntry } from '../../shared/ipc/marketAnalysisTimelineClient'
import type { MarketAnalysisTimelineText } from './MarketAnalysisTimeline'
import { TimelinePanel } from './TimelinePanel'
import type { UseMarketAnalysisTimelineResult } from './useMarketAnalysisTimeline'

/** The analysis timeline moved out of the right column; the conclusion card is its entry. */
export function AnalysisTimelineDrawer(props: {
  open: boolean
  title: string
  text: MarketAnalysisTimelineText
  timeline: UseMarketAnalysisTimelineResult
  openEntry?: MarketAnalysisTimelineEntry
  onOpenChange: (entry: MarketAnalysisTimelineEntry | undefined) => void
  onClose: () => void
}): React.ReactElement {
  return (
    <Drawer destroyOnHidden onClose={props.onClose} open={props.open} title={props.title} width={640}>
      <TimelinePanel
        onOpenChange={props.onOpenChange}
        openEntry={props.openEntry}
        text={props.text}
        timeline={props.timeline}
      />
    </Drawer>
  )
}
