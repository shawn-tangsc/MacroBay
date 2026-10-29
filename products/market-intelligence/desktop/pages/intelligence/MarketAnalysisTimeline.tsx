import { Button } from 'antd'
import { ArrowLeft, RefreshCw, Settings2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'
import { LoadingSpinner, LoadingState } from '@platform/ui/components/loading'
import { toReadableConclusionText } from '../../../contracts/marketAnalysisReadableText'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import type { MarketAnalysisTimelineEntry } from '../../shared/ipc/marketAnalysisTimelineClient'
import { analysisTimelinePaging, analysisTimelinePagingPolicy } from './analysisTimelinePaging'
import { conclusionReadableNames } from './analysisConclusionVocabulary'
import { conclusionSummaryText, conclusionWithoutDirection, readConclusionDirection } from './analysisConclusionBlocks'
import { analysisConclusionDirectionPolicy, localizedDirectionTerm } from './analysisConclusionDirectionPolicy'
import { oneOffTriggerReasons } from './analysisTriggerStatusPresentation'
import type { AnalysisTimelineText, UseMarketAnalysisTimelineResult } from './useMarketAnalysisTimeline'
import { useMarketAnalysisSettings, type MarketAnalysisSettingsRefusal } from './useMarketAnalysisSettings'
import { AnalysisRequestErrorBanner, useDismissibleError } from './AnalysisRequestErrorBanner'
import { MarketAnalysisSettingsDialog } from './MarketAnalysisSettingsDialog'


export type MarketAnalysisTimelineText = AnalysisTimelineText & Readonly<{
  /** The calm status shown when a refresh had nothing to do because an analysis already exists. */
  analysisRefreshAlreadyAvailable: string
  workspaceLabel: string
  title: string
  back: string
  empty: string
  /** Optional so partial text objects used outside the full i18n bundle still type-check. */
  readTrace?: string
  timeline: string
  requestInitialAnalysis: string
  refreshAnalysis: string
  initialAnalysisQueued: string
  initialAnalysisUnavailable: string
  analysisRefreshFailed: string
  analysisServiceNotReady: string
  retryAnalysis: string
  /** Label of the control that puts an error banner away. */
  dismissError: string
  /** Settings surface: the switch, the model, and the reasons a save was refused. */
  settings: string
  settingsTitle: string
  analysisEnabled: string
  analysisEnabledHint: string
  analysisModel: string
  modelFollowDefault: string
  /** Prefix for "this is the platform's default assistant model, not an explicit pick". */
  followsDefaultPrefix: string
  enableAnalysis: string
  analysisOffHint: string
  refusalModelUnconfigured: string
  refusalModelUnavailable: string
  refusalFailed: string
  saving: string
  save: string
  cancel: string
  summaryVersion: string
  evidenceCount: string
  analysisRun: string
  loadMore: string
  status: Record<string, string>
  triggerStatus: { label: string; since: string; slotOpen: string; slotDelayed: string; reasons: Record<string, string> }
}>

type Props = Readonly<{
  text: MarketAnalysisTimelineText
  timeline: UseMarketAnalysisTimelineResult
  onBack?: () => void
  onSelect?: (entry: MarketAnalysisTimelineEntry) => void
}>



/**
 * Timeline list surface. It renders only the list and the request controls; the
 * node detail is surfaced by the main-area drawer so the same conclusion is not
 * rendered in two places. Data and selection state come from the shared
 * workspace hook.
 */
export function MarketAnalysisTimeline({ onBack, text, timeline, onSelect }: Props): React.ReactElement {
  const { state, attempt, requestState } = timeline
  // `loading` is only the short request leg; the run itself stays `queued` while it works, so the
  // button's own icon must spin for both states instead of freezing next to a disabled label.
  const analysisInFlight = requestState === 'loading' || requestState === 'queued'
  const formatTime = useShellTimeFormat()
  // An attempt that ended without publishing, kept so an empty list can say why it is empty.
  const failedAttempt = attempt && !['queued', 'running', 'succeeded'].includes(attempt.status) ? attempt : undefined
  // Three failures can be on screen, and each is put away on its own: the request the reader just
  // made, the request that could not start, and the persisted attempt behind an empty list.
  const refreshError = useDismissibleError(requestState === 'failed' && state.entries.length > 0)
  const initialError = useDismissibleError(requestState === 'failed' && state.entries.length === 0)
  const attemptError = useDismissibleError(Boolean(failedAttempt) && requestState !== 'loading' && requestState !== 'queued'
    && !state.loading && !state.failed && state.entries.length === 0)
  // While a run is in flight the action is unavailable, so its label stays the request it was:
  // it used to become the whole queued sentence, which duplicated the status line below it and
  // re-widened the button on every request.
  const actionLabel = attempt && !['queued', 'running'].includes(attempt.status) ? text.retryAnalysis : text.requestInitialAnalysis
  const language = useShellLanguage()
  const settingsState = useMarketAnalysisSettings()
  // `undefined` means "not read yet". Only an explicit `false` draws the mask: a read that failed
  // must not cover a panel whose capability is in fact enabled.
  const analysisEnabled = settingsState.settings?.enabled
  const masked = analysisEnabled === false
  const [settingsOpen, setSettingsOpen] = useState(false)
  const refusalText = (refusal: MarketAnalysisSettingsRefusal | undefined): string | undefined =>
    refusal === 'model-unconfigured' ? text.refusalModelUnconfigured
      : refusal === 'model-unavailable' ? text.refusalModelUnavailable
        : refusal === 'failed' ? text.refusalFailed
          : undefined
  // Eight nodes at a time, and reaching the end of what is shown is what brings the next eight in —
  // instantly while the workspace still holds read nodes, and by reading on once it does not.
  const [pages, setPages] = useState(1)
  const shown = analysisTimelinePaging(state.entries.length, pages)
  const canPull = shown.hasUnread || Boolean(state.nextCursor)
  const revealMore = (): void => {
    setPages(current => current + 1)
    if (!shown.hasUnread && state.nextCursor) timeline.loadMore()
  }
  // The pull is a scroll, not a click: the sentinel at the end of the list is watched, and reading
  // the latest state through a ref keeps one observer alive across the pulls it triggers.
  const pullTarget = useRef<HTMLDivElement>(null)
  const revealMoreRef = useRef(revealMore)
  revealMoreRef.current = revealMore
  useEffect(() => {
    const target = pullTarget.current
    // The button below is the same action for a keyboard: without an observer (or without a sentinel)
    // nothing is lost, it is simply pressed instead of reached.
    if (!target || typeof IntersectionObserver !== 'function') return undefined
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) revealMoreRef.current()
    }, { rootMargin: `0px 0px ${analysisTimelinePagingPolicy.loadAheadPx}px 0px` })
    observer.observe(target)
    return () => observer.disconnect()
  }, [canPull])

  return (
    <section className="mi-analysis-timeline" aria-label={text.title} data-analysis-enabled={analysisEnabled === undefined ? 'unknown' : String(analysisEnabled)}>
      <header className="mi-analysis-timeline__header" aria-hidden={masked || undefined}>
        <div><p>{text.workspaceLabel}</p><h1>{text.title}</h1></div>
        <div>
          <Button className="mi-analysis-timeline__settings" onClick={() => setSettingsOpen(true)} icon={<Settings2 aria-hidden="true" size={14} />}>{text.settings}</Button>
          {onBack ? <Button className="mi-analysis-timeline__back" onClick={onBack} icon={<ArrowLeft aria-hidden="true" size={15} />}>{text.back}</Button> : null}
          {/* The one analysis action sits at the far right, where a separate refresh button used to
              be: the list refreshes itself (live poll, focus), so a second control that only re-read
              it was an action that could not change anything a reader cares about. */}
          {state.entries.length > 0 ? <Button className="mi-analysis-timeline__reanalyse" aria-busy={analysisInFlight || undefined}
            disabled={analysisInFlight} onClick={() => void timeline.requestRefreshAnalysis()}
            icon={analysisInFlight ? <LoadingSpinner size="sm" /> : <RefreshCw aria-hidden="true" size={14} />}>{text.refreshAnalysis}</Button> : null}
        </div>
      </header>
      <div className="mi-analysis-timeline__workspace-wrap">
      <div className="mi-analysis-timeline__workspace" aria-hidden={masked || undefined}>
        <aside className="mi-analysis-timeline__list" aria-label={text.timeline}>
          <h2>{text.timeline}</h2>
          {state.loading ? <LoadingState label={text.loading} minHeight={160} /> : null}
          {state.failed ? <p role="alert" className="mi-analysis-timeline__state">{text.unavailable}</p> : null}
          {state.lastRead && text.readTrace ? <p className="mi-analysis-timeline__state" data-timeline-read={state.lastRead}>{text.readTrace}：{state.lastRead}</p> : null}
          {!state.loading && !state.failed && state.entries.length === 0 ? <>
            <p className="mi-analysis-timeline__state">{text.empty}</p>
            {failedAttempt && attemptError.visible ? <AnalysisRequestErrorBanner
              message={text.attemptFailed}
              detail={text.failureReasons[failedAttempt.failureCode ?? ''] ?? text.initialAnalysisFailed}
              meta={[`${text.analysisRun}：${failedAttempt.id}`, `${text.evidenceCount}：${failedAttempt.evidenceCount}`]}
              dismissLabel={text.dismissError}
              onDismiss={attemptError.dismiss}
            /> : null}
            {/* The label stays a label; the queued sentence below is the only place it is said. */}
            <Button loading={requestState === 'loading'} disabled={requestState === 'loading' || requestState === 'queued'} onClick={() => void timeline.requestInitialAnalysis()}>{actionLabel}</Button>
            {requestState === 'queued' ? <p role="status" className="mi-analysis-timeline__state">{text.initialAnalysisQueued}</p> : null}
            {requestState === 'unavailable' ? <p role="alert" className="mi-analysis-timeline__state">{text.initialAnalysisUnavailable}</p> : null}
            {initialError.visible ? <AnalysisRequestErrorBanner
              message={text.initialAnalysisFailed}
              dismissLabel={text.dismissError}
              onDismiss={initialError.dismiss}
            /> : null}
          </> : null}
          {state.entries.length > 0 && requestState === 'already-available' ? <p role="status" className="mi-analysis-timeline__state">{text.analysisRefreshAlreadyAvailable}</p> : null}
          {state.entries.length > 0 && requestState === 'not-ready' ? <p role="status" className="mi-analysis-timeline__state">{text.analysisServiceNotReady}</p> : null}
          {refreshError.visible ? <AnalysisRequestErrorBanner
            // A run that finished without publishing is not a request that failed: the click was
            // accepted, the analysis was rejected. Saying "the request did not go through" for
            // both made a rejected model answer look like a dead button.
            message={timeline.requestFailure === 'run' ? text.attemptFailed : text.analysisRefreshFailed}
            detail={attempt?.failureCode ? text.failureReasons[attempt.failureCode] : undefined}
            dismissLabel={text.dismissError}
            onDismiss={refreshError.dismiss}
          /> : null}
          {state.entries.slice(0, shown.visible).map((entry) => { const direction = entry.direction ?? readConclusionDirection(entry.safeExcerpt ?? ''); return <button className={`mi-analysis-timeline__entry${state.selected?.id === entry.id ? ' is-selected' : ''}`} key={entry.id} onClick={() => onSelect ? onSelect(entry) : void timeline.select(entry)} type="button">
            <span><time>{formatTime(entry.occurredAt, 'second')}</time><em>{text.status[entry.status]}</em></span>
            {/* The tag and the conclusion share one line, so they live in one flex item: a row is a
                column flex container, and siblings there would stack whatever their display is. */}
            {direction || entry.safeExcerpt ? <span className="mi-analysis-timeline__headline">
              {direction ? <span className="mi-analysis-timeline__direction" data-direction={direction}>
                {localizedDirectionTerm(direction, language)}
              </span> : null}
              {entry.safeExcerpt ? <span className="mi-analysis-timeline__conclusion-line">{toReadableConclusionText(conclusionWithoutDirection(entry.safeExcerpt), conclusionReadableNames, language)}</span> : null}
            </span> : null}
            {entry.triggerStatus ? <small className="mi-analysis-timeline__trigger-status" data-trigger-status={entry.triggerStatus.reasonCode}>
              {/* "since" fits a condition the gate keeps re-observing; a reader's own click is a
                  one-off moment, so it reads as a time instead. The token list is the service
                  policy's, mirrored here rather than imported: that module pulls in test-only
                  imports through its policy chain. */}
              {text.triggerStatus.label}：{text.triggerStatus.reasons[entry.triggerStatus.reasonCode]}
              {entry.triggerStatus.slotOpenAt
                // Which open it served, and whether it was late: a 16:00 open analysed at 01:21 the
                // next morning looked like a mistake until the line said so.
                ? `（${text.triggerStatus.slotOpen}${formatTime(entry.triggerStatus.slotOpenAt, 'minute')}${entry.triggerStatus.slotDelayed ? `，${text.triggerStatus.slotDelayed}` : ''}）`
                : ''}
              （{formatTime(entry.triggerStatus.decidedAt, 'second')}{oneOffTriggerReasons.has(entry.triggerStatus.reasonCode) ? '' : ` ${text.triggerStatus.since}`}）
            </small> : null}
          </button> })}
          {canPull ? <div className="mi-analysis-timeline__pull" ref={pullTarget}>
            {/* Kept as a real control beside the scroll: a keyboard or screen-reader reader cannot
                perform a pull, and it is also what the sentinel above is measured against. */}
            <Button disabled={state.loading} onClick={revealMore}>{text.loadMore}</Button>
          </div> : null}
        </aside>
      </div>
      </div>
      {/* The mask covers the whole module, the title row included: with the capability off there is
          nothing in the header to act on, and the one action on the mask opens the same dialog the
          header's settings button would. */}
      {masked ? <div className="mi-analysis-timeline__mask" role="region" aria-label={text.analysisOffHint}>
        <div className="mi-analysis-timeline__mask-body">
          <p>{text.analysisOffHint}</p>
          <div>
            <Button type="primary" onClick={() => setSettingsOpen(true)}>{text.enableAnalysis}</Button>
          </div>
          {refusalText(settingsState.refusal) ? <p role="alert">{refusalText(settingsState.refusal)}</p> : null}
        </div>
      </div> : null}
      <MarketAnalysisSettingsDialog
        onClose={() => setSettingsOpen(false)}
        open={settingsOpen}
        text={text}
      />
    </section>
  )
}


