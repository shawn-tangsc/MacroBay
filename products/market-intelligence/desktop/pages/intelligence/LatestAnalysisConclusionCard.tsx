import { useEffect, useState } from 'react'
import { Button } from 'antd'
import { Sparkles } from 'lucide-react'
import { StatusPill } from '@platform/ui/components/status-pill'
import type { MarketAnalysisTimelineEntry } from '../../shared/ipc/marketAnalysisTimelineClient'
import { localizeAnalysisMagnitudeUnits } from '../../../contracts/marketAnalysisReadableText'
import type { AnalysisConclusionDetail, AnalysisDetailText } from './AnalysisConclusionDetail'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import { LoadingState } from '@platform/ui/components/loading'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { analysisConclusionSurfacePolicy } from './analysisWorkspaceLayoutPolicy'
import { analysisConclusionDirectionPolicy } from './analysisConclusionDirectionPolicy'
import { selectLatestPublishedEntry } from '../../../contracts/latestPublishedAnalysis'
import { AnalysisDirectionsBlock } from './AnalysisDirectionsBlock'
import { readConclusion } from './analysisConclusionBlocks'
import { conclusionReadableNames } from './analysisConclusionVocabulary'
import type { UseMarketAnalysisTimelineResult } from './useMarketAnalysisTimeline'
import { useMarketAnalysisSettings } from './useMarketAnalysisSettings'
import { ANALYSIS_STATUS_KEY, ANALYSIS_STATUS_TONE } from './analysisStatusPresentation'
import { useProductTextKey } from '../../shared/i18n/productTextKey'

export type LatestConclusionText = Readonly<{
  latestConclusion: string
  latestConclusionHint: string
  latestConclusionEmpty: string
  latestConclusionLoading: string
  latestConclusionUnavailable: string
  /**
   * 读不到时那一句（既有口径「这项数据暂时读不到，不是你没有」）。
   * 可选：老调用点没有它时回落到 `latestConclusionUnavailable`，不因此不渲染。
   */
  conclusionUnreadable?: string
  openDetail: string
}>

export { selectLatestPublishedEntry } from '../../../contracts/latestPublishedAnalysis'

/**
 * Prominent main-area conclusion surface. It always shows the newest published
 * analysis so the current judgement is the first thing on screen; selecting an
 * older node opens the detail drawer instead of replacing this card.
 */
export function LatestAnalysisConclusionCard({ text, workspaceText, timeline, onOpenDetail, onOpenTimeline, onOpenAnalysisSettings, openTimelineLabel, enableAnalysisLabel, analysisOffHint }: Readonly<{
  text: Pick<AnalysisDetailText, 'conclusion' | 'conclusionDirection' | 'directions' | 'readableLocale'>
  workspaceText: LatestConclusionText
  timeline: UseMarketAnalysisTimelineResult
  onOpenDetail: (entry: MarketAnalysisTimelineEntry) => void
  onOpenTimeline?: () => void
  onOpenAnalysisSettings?: () => void
  openTimelineLabel?: string
  enableAnalysisLabel?: string
  analysisOffHint?: string
}>): React.ReactElement | null {
  const { state, details, detailState } = timeline
  const formatTime = useShellTimeFormat()
  const resolveProductText = useProductTextKey()
  const analysisSettings = useMarketAnalysisSettings()
  /** 读者点了正文、但详情还在读：读好之后自动打开抽屉（不是点完没反应）。 */
  const [openWhenReady, setOpenWhenReady] = useState(false)
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

  useEffect(() => {
    if (!openWhenReady || !latest || !detail) return
    setOpenWhenReady(false)
    onOpenDetail(latest)
  }, [openWhenReady, latest, detail])

  /** 键盘与鼠标等效：Enter / Space 触发同一个动作（Space 要阻止滚动）。 */
  const onBodyKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    requestOpen()
  }

  /** 正文整块即入口：详情已读好就直接开，没读好就先读、读好自动开。 */
  const requestOpen = (): void => {
    if (!latest) return
    if (detail) {
      onOpenDetail(latest)
      return
    }
    setOpenWhenReady(true)
    timeline.ensureDetail(latest)
  }

  // With the capability switched off the card has nothing to offer — no new conclusion will be
  // published and the actions behind it are disabled — so it stays out of the main area instead of
  // occupying the reader's first screen with a stale verdict.
  if (analysisSettings.settings?.enabled === false) {
    return <section className="mi-analysis-conclusion-card" role={analysisConclusionSurfacePolicy.cardRole} aria-label={workspaceText.latestConclusion}>
      <header>
        <div><Sparkles size={15} aria-hidden="true" /><h2>{workspaceText.latestConclusion}</h2></div>
      </header>
      <div className="mi-analysis-conclusion-card__state mi-analysis-conclusion-card__state--center">
        <p>{analysisOffHint}</p>
        <Button size="small" type="primary" onClick={onOpenAnalysisSettings ?? onOpenTimeline}>{enableAnalysisLabel}</Button>
      </div>
    </section>
  }

  return <section className="mi-analysis-conclusion-card" role={analysisConclusionSurfacePolicy.cardRole} aria-label={workspaceText.latestConclusion}>
    <header>
      <div><Sparkles size={15} aria-hidden="true" /><h2>{workspaceText.latestConclusion}</h2></div>
      <div>
        {latest ? <><time>{formatTime(latest.occurredAt, 'second')}</time><StatusPill labelKey={ANALYSIS_STATUS_KEY[latest.status]} resolveText={resolveProductText} tone={ANALYSIS_STATUS_TONE[latest.status]} /></> : null}
        {onOpenTimeline ? <Button size="small" onClick={onOpenTimeline}>{openTimelineLabel}</Button> : null}
      </div>
    </header>
    {!latest && state.loading ? <LoadingState label={workspaceText.latestConclusionLoading} minHeight={110} /> : null}
    {!latest && !state.loading ? <p className="mi-analysis-conclusion-card__state">{workspaceText.latestConclusionEmpty}</p> : null}
    {latest && pending === 'loading' ? <div aria-label={workspaceText.openDetail} className="mi-analysis-conclusion-card__body mi-analysis-conclusion-card__body--action"
      onClick={requestOpen} onKeyDown={onBodyKeyDown} role="button" tabIndex={0}>
      <LoadingState label={workspaceText.latestConclusionLoading} minHeight={110} />
    </div> : null}
    {/* 读不到不是「没有这条分析」：走统一状态面，句子是产品那句，动作是真重读**这一个节点**
        （与抽屉同一条 `ensureDetail`）。自动重试停了之后，读者还留着一个出口——没有出口的失败态
        下次任何一次瞬时失败都会再卡一次。 */}
    {latest && pending === 'unavailable' ? <StateView
      action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: () => timeline.ensureDetail(latest) }}
      productReason={{
        key: 'mi.latestConclusion.unreadable',
        resolve: (key, _params) => key === 'mi.latestConclusion.unreadable'
          ? workspaceText.conclusionUnreadable ?? workspaceText.latestConclusionUnavailable
          : ''
      }}
      reasonCode="unreadable"
      size="md"
      state="error"
    /> : null}
    {latest && detail ? <div aria-label={workspaceText.openDetail} className="mi-analysis-conclusion-card__body mi-analysis-conclusion-card__body--action" data-direction={direction ?? 'none'}
      onClick={requestOpen} onKeyDown={onBodyKeyDown} role="button" tabIndex={0}
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
