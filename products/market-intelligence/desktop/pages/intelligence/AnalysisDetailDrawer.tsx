import { useEffect } from 'react'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import { Button } from 'antd'
import { RefreshCw, X } from 'lucide-react'
import type { MarketAnalysisTimelineEntry } from '../../shared/ipc/marketAnalysisTimelineClient'
import { AnalysisConclusionDetail, type AnalysisDetailText } from './AnalysisConclusionDetail'
import { analysisConclusionSurfacePolicy } from './analysisWorkspaceLayoutPolicy'
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
  const openEntryId = openEntry?.id
  // The drawer may be opened from the conclusion card as well as from the
  // timeline, so it primes its own detail read.
  useEffect(() => { if (openEntry) timeline.ensureDetail(openEntry) }, [openEntryId])
  useEffect(() => {
    if (!openEntryId) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onOpenChange(undefined) }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openEntryId])

  if (!openEntry) return null
  const detail = timeline.details[openEntry.id]
  const pending = timeline.detailState[openEntry.id]
  return <aside className="mi-analysis-drawer" role={analysisConclusionSurfacePolicy.drawerRole} aria-label={text.detail}>
    <header className="mi-analysis-drawer__header">
      <div>
        <h2>{text.detail}</h2>
        <div className="mi-analysis-drawer__meta"><time>{formatTime(openEntry.occurredAt, 'second')}</time><em>{text.status[openEntry.status]}</em></div>
      </div>
      <Button type="text" size="small" icon={<X aria-hidden="true" size={15} />} aria-label={workspaceText.closeDetail} onClick={() => onOpenChange(undefined)} />
    </header>
    <div className="mi-analysis-drawer__body">
      {!detail && pending !== 'unavailable' ? <p className="mi-analysis-timeline__state"><RefreshCw aria-hidden="true" size={13} /> {text.loading}</p> : null}
      {!detail && pending === 'unavailable' ? <p role="alert" className="mi-analysis-timeline__state">{workspaceText.detailUnavailable}</p> : null}
      {detail ? <AnalysisConclusionDetail detail={detail} text={text} /> : null}
    </div>
  </aside>
}
