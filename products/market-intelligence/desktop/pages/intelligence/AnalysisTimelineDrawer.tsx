import { Drawer } from 'antd'
import { X } from 'lucide-react'

import type { MarketAnalysisTimelineEntry } from '../../shared/ipc/marketAnalysisTimelineClient'
import type { MarketAnalysisTimelineText } from './MarketAnalysisTimeline'
import { TimelinePanel } from './TimelinePanel'
import type { UseMarketAnalysisTimelineResult } from './useMarketAnalysisTimeline'

/** The analysis timeline moved out of the right column; the conclusion card is its entry. */
export function AnalysisTimelineDrawer(props: {
  open: boolean
  title: string
  closeLabel: string
  text: MarketAnalysisTimelineText
  timeline: UseMarketAnalysisTimelineResult
  openEntry?: MarketAnalysisTimelineEntry
  onOpenChange: (entry: MarketAnalysisTimelineEntry | undefined) => void
  onClose: () => void
}): React.ReactElement {
  return (
    <Drawer closable={false} destroyOnHidden mask={false} onClose={props.onClose} open={props.open} rootClassName="mi-analysis-timeline-drawer" styles={{ header: { display: 'none' } }} title={null} width={640}>
      <div className="mi-analysis-timeline-drawer__head">
        <button aria-label={props.closeLabel} onClick={props.onClose} type="button"><X aria-hidden="true" size={15} /></button>
        <strong>{props.title}</strong>
      </div>
      <TimelinePanel
        onOpenChange={props.onOpenChange}
        openEntry={props.openEntry}
        text={props.text}
        timeline={props.timeline}
      />
    </Drawer>
  )
}
