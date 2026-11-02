import { useEffect } from 'react'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import { LoadingState } from '@platform/ui/components/loading'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { StatusPill } from '@platform/ui/components/status-pill'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import type { MarketAnalysisTimelineEntry } from '../../shared/ipc/marketAnalysisTimelineClient'
import { AnalysisConclusionDetail, type AnalysisDetailText } from './AnalysisConclusionDetail'
import { ANALYSIS_STATUS_KEY, ANALYSIS_STATUS_TONE } from './analysisStatusPresentation'
import { MiSideDrawer } from './MiSideDrawer'
import type { UseMarketAnalysisTimelineResult } from './useMarketAnalysisTimeline'

export type AnalysisDetailDrawerText = Readonly<{ closeDetail: string; detailUnavailable: string }>

type Props = Readonly<{
  text: AnalysisDetailText
  /** Workspace-level copy, kept separate so timeline keys cannot shadow chat keys. */
  workspaceText: AnalysisDetailDrawerText
  timeline: UseMarketAnalysisTimelineResult
  /** The timeline entry whose detail the drawer shows; undefined keeps it closed. */
  openEntry?: MarketAnalysisTimelineEntry
  onOpenChange: (entry: MarketAnalysisTimelineEntry | undefined) => void
}>

/**
 * Non-modal node detail drawer. It slides over the dashboard from the left.
 *
 * It renders no backdrop, is not a dialog and never traps focus, so the
 * dashboard underneath stays interactive; Escape and the close control dismiss
 * it while the selected entry and the chat binding survive.
 */
export function AnalysisDetailDrawer({ text, workspaceText, timeline, openEntry, onOpenChange }: Props): React.ReactElement | null {
  const formatTime = useShellTimeFormat()
  const resolveProductText = useProductTextKey()
  const openEntryId = openEntry?.id
  // The drawer may be opened from the conclusion card as well as from the
  // timeline, so it primes its own detail read.
  useEffect(() => { if (openEntry) timeline.ensureDetail(openEntry) }, [openEntryId])

  if (!openEntry) return null
  const detail = timeline.details[openEntry.id]
  const pending = timeline.detailState[openEntry.id]
  return <MiSideDrawer title={text.detail} closeLabel={workspaceText.closeDetail} onClose={() => onOpenChange(undefined)}
    meta={<><time>{formatTime(openEntry.occurredAt, 'second')}</time><StatusPill labelKey={ANALYSIS_STATUS_KEY[openEntry.status]} resolveText={resolveProductText} tone={ANALYSIS_STATUS_TONE[openEntry.status]} /></>}>
    {!detail && pending !== 'unavailable' ? <LoadingState label={text.loading} minHeight={200} /> : null}
    {/* 读不到不是「没有这条分析」：走统一状态面，句子仍是本产品那句（只覆盖原因格），
        动作是真重读这一个节点——自动重试停了之后，读者还留着一个出路。 */}
    {!detail && pending === 'unavailable' ? <StateView
      action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: () => timeline.ensureDetail(openEntry) }}
      productReason={{
        key: 'mi.analysisDetail.unavailable',
        resolve: (key, _params) => key === 'mi.analysisDetail.unavailable' ? workspaceText.detailUnavailable : ''
      }}
      reasonCode="unreadable"
      size="md"
      state="error"
    /> : null}
    {detail ? <AnalysisConclusionDetail detail={detail} text={text} /> : null}
  </MiSideDrawer>
}
