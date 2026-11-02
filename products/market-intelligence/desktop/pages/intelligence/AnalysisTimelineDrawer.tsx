import { Drawer } from '@platform/ui/components/drawer'

import type { MarketAnalysisTimelineEntry } from '../../shared/ipc/marketAnalysisTimelineClient'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import type { MarketAnalysisTimelineText } from './MarketAnalysisTimeline'
import { TimelinePanel } from './TimelinePanel'
import type { UseMarketAnalysisTimelineResult } from './useMarketAnalysisTimeline'

/**
 * The analysis timeline moved out of the right column; the conclusion card is its entry.
 *
 * The head, the close control, the mask, Escape and focus return are the shared drawer's: this used
 * to suppress all of them and hand-draw its own header, which is how a dialog ends up with no mask
 * and a close button nobody else had.
 */
export function AnalysisTimelineDrawer(props: {
  open: boolean
  text: MarketAnalysisTimelineText
  timeline: UseMarketAnalysisTimelineResult
  openEntry?: MarketAnalysisTimelineEntry
  onOpenChange: (entry: MarketAnalysisTimelineEntry | undefined) => void
  onClose: () => void
}): React.ReactElement {
  const resolveProductText = useProductTextKey()
  return <Drawer
    className="mi-analysis-timeline-drawer"
    destroyOnHidden
    mode="modal"
    onClose={props.onClose}
    open={props.open}
    resolveText={resolveProductText}
    size="large"
    titleKey="pages.intelligence.portal.analysisDrawer.title">
    <TimelinePanel
      onOpenChange={props.onOpenChange}
      openEntry={props.openEntry}
      text={props.text}
      timeline={props.timeline}
    />
  </Drawer>
}
