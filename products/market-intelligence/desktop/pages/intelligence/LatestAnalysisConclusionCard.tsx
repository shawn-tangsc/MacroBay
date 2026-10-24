import { useEffect } from 'react'
import { Button } from 'antd'
import { Sparkles } from 'lucide-react'
import type { MarketAnalysisTimelineEntry } from '../../shared/ipc/marketAnalysisTimelineClient'
import { localizeAnalysisMagnitudeUnits } from '../../../contracts/marketAnalysisReadableText'
import type { AnalysisConclusionDetail, AnalysisDetailText } from './AnalysisConclusionDetail'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import { analysisConclusionSurfacePolicy } from './analysisWorkspaceLayoutPolicy'
import { analysisConclusionDirectionPolicy } from './analysisConclusionDirectionPolicy'
import { AnalysisDirectionsBlock } from './AnalysisDirectionsBlock'
import { readConclusion } from './analysisConclusionBlocks'
import { conclusionReadableNames } from './analysisConclusionVocabulary'
import type { UseMarketAnalysisTimelineResult } from './useMarketAnalysisTimeline'
import { useMarketAnalysisSettings } from './useMarketAnalysisSettings'

export type LatestConclusionText = Readonly<{
  latestConclusion: string
  latestConclusionHint: string
  latestConclusionEmpty: string
  latestConclusionLoading: string
  latestConclusionUnavailable: string
  openDetail: string
}>

/** The newest published node, or undefined when nothing usable is published. */
export function selectLatestPublishedEntry(entries: readonly MarketAnalysisTimelineEntry[]): MarketAnalysisTimelineEntry | undefined {
  return entries.find(entry => entry.status === 'published' && (entry.kind === 'analysis' || entry.kind === 'review'))
}

/**
 * Prominent main-area conclusion surface. It always shows the newest published
 * analysis so the current judgement is the first thing on screen; selecting an
 * older node opens the detail drawer instead of replacing this card.
 */
export function LatestAnalysisConclusionCard({ text, workspaceText, timeline, onOpenDetail, onOpenTimeline, openTimelineLabel, enableAnalysisLabel, analysisOffHint }: Readonly<{
  text: Pick<AnalysisDetailText, 'status' | 'conclusion' | 'conclusionDirection' | 'directions' | 'readableLocale'>
  workspaceText: LatestConclusionText
  timeline: UseMarketAnalysisTimelineResult
  onOpenDetail: (entry: MarketAnalysisTimelineEntry) => void
  onOpenTimeline?: () => void
  openTimelineLabel?: string
  enableAnalysisLabel?: string
  analysisOffHint?: string
}>): React.ReactElement | null {
  const { state, details, detailState } = timeline
  const formatTime = useShellTimeFormat()
  const analysisSettings = useMarketAnalysisSettings()
  const latest = selectLatestPublishedEntry(state.entries)
  const detail = latest ? details[latest.id] : undefined
  const pending = latest ? detailState[latest.id] : undefined
  // Both contract generations, read exactly as the drawer reads them: the structured conclusion
  // current runs write, or the legacy labelled paragraph. Reading only the legacy field is what left
  // this card with the operation directions and no verdict once the structured contract shipped.
  const locale = text.readableLocale ?? 'zh-CN'
  const reading = detail ? readConclusion(detail.summary, conclusionReadableNames, locale) : undefined
  // The verdict only: the card is read at a glance and the labelled parts (本次变化、因果链…) are one
  // click away in the drawer, so they are cut here rather than shortened.
  const verdict = localizeAnalysisMagnitudeUnits(reading?.verdict ?? '', locale)
  const direction = reading?.direction

  useEffect(() => {
    if (latest) timeline.ensureDetail(latest)
  }, [latest?.id])

  // With the capability switched off the card has nothing to offer — no new conclusion will be
  // published and the actions behind it are disabled — so it stays out of the main area instead of
  // occupying the reader's first screen with a stale verdict.
  if (analysisSettings.settings?.enabled === false) {
    return <section className="mi-analysis-conclusion-card" role={analysisConclusionSurfacePolicy.cardRole} aria-label={workspaceText.latestConclusion}>
      <header>
        <div><Sparkles size={15} aria-hidden="true" /><h2>{workspaceText.latestConclusion}</h2></div>
      </header>
      <div className="mi-analysis-conclusion-card__state">
        <p>{analysisOffHint}</p>
        {onOpenTimeline ? <Button size="small" type="primary" onClick={onOpenTimeline}>{enableAnalysisLabel}</Button> : null}
      </div>
    </section>
  }

  return <section className="mi-analysis-conclusion-card" role={analysisConclusionSurfacePolicy.cardRole} aria-label={workspaceText.latestConclusion}>
    <header>
      <div><Sparkles size={15} aria-hidden="true" /><h2>{workspaceText.latestConclusion}</h2></div>
      <div>
        {latest ? <><time>{formatTime(latest.occurredAt, 'second')}</time><em>{text.status[latest.status]}</em></> : null}
        {onOpenTimeline ? <Button size="small" onClick={onOpenTimeline}>{openTimelineLabel}</Button> : null}
        {latest && detail ? <Button size="small" onClick={() => onOpenDetail(latest)}>{workspaceText.openDetail}</Button> : null}
      </div>
    </header>
    {!latest && state.loading ? <p className="mi-analysis-conclusion-card__state">{workspaceText.latestConclusionLoading}</p> : null}
    {!latest && !state.loading ? <p className="mi-analysis-conclusion-card__state">{workspaceText.latestConclusionEmpty}</p> : null}
    {latest && pending === 'loading' ? <p className="mi-analysis-conclusion-card__state">{workspaceText.latestConclusionLoading}</p> : null}
    {latest && pending === 'unavailable' ? <p role="alert" className="mi-analysis-conclusion-card__state">{workspaceText.latestConclusionUnavailable}</p> : null}
    {latest && detail ? <div className="mi-analysis-conclusion-card__body" data-direction={direction ?? 'none'}
      style={direction ? { '--mi-conclusion-direction': `var(${analysisConclusionDirectionPolicy.colorTokens[direction]})` } as React.CSSProperties : undefined}>
      <p className="mi-analysis-conclusion-card__conclusion">
        {direction ? <span className="mi-analysis-conclusion__direction" role="note" aria-label={`${text.conclusionDirection.label}：${text.conclusionDirection[direction]}`}>{text.conclusionDirection[direction]}</span> : null}
        {verdict}
      </p>
      {(detail.summary.directions ?? []).length > 0 ? <AnalysisDirectionsBlock directions={detail.summary.directions!} text={text.directions} hideLowConfidenceRows /> : null}
      <p className="mi-analysis-conclusion-card__hint">{workspaceText.latestConclusionHint}</p>
    </div> : null}
  </section>
}
