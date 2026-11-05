import { Button } from 'antd'
import { useEffect, useRef, useState } from 'react'

import { StateView } from '@platform/ui/components/state'

import type { BriefingGenerationProgress } from '../../../contracts/dailyBriefing'
import type { DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
import type { BriefingDeleteOutcome } from './useDailyBriefingIssueDeletion'
import type { DailyBriefingMode } from './dailyBriefingMode'
import type { DailyBriefingPageViewState } from './dailyBriefingPageViewState'
import type { DailyBriefingText } from './dailyBriefingText'
import { DailyBriefingDeleteOutcomeNote } from './DailyBriefingDeleteOutcomeNote'
import { DailyBriefingEmptyState } from './DailyBriefingEmptyState'
import { DailyBriefingFailurePanel, type BriefFailure } from './DailyBriefingFailurePanel'
import { DailyBriefingGeneratingView } from './DailyBriefingGeneratingStates'
import { DailyBriefingLanguageFallback } from './DailyBriefingLanguageFallback'
import { DailyBriefingLocaleMissing } from './DailyBriefingLocaleMissing'
import { DailyBriefingNoEditionPanel } from './DailyBriefingNoEditionPanel'
import { DailyBriefingShareCard } from './DailyBriefingShareCard'
import { briefingChangeArrows, briefingFearGreedBuckets, briefingPaymentDirections, briefingPolicyGaugeWords } from './dailyBriefingPaymentDirections'
import { DailyBriefingStorageNotice } from './DailyBriefingStorageNotice'
import { BRIEFING_PAPER_WIDTH } from './dailyBriefingExport'
import { editorialFailureText } from './dailyBriefingPageDerived'
import { resolveBriefingStateReason } from './dailyBriefingText'

/**
 * The sheet on screen is the sheet that is exported, scaled — never re-flowed.
 *
 * The poster is a printed page with absolute sizes (card row 114, dial 88, plot column 100, the number
 * 30px). Stretching it to the column width re-lays it out and the cards collapse; scaling it keeps one
 * layout and changes only how large it is drawn. `shareRef` in the page still points at the poster in
 * its own 1080 box, so the export is untouched by this transform.
 */
/**
 * Everything the reading pane can show, in one place.
 *
 * Kept out of the page for size, and because the pane's states belong together: a run in flight,
 * nothing generated, a missing language, a failure, an edition. The page decides which state it is
 * in; this file decides how each one looks.
 */
export function DailyBriefingContent({ text, view, mode, generating, failure, regenerating, liveProgress, progressUnreadable, resolveProductText, editions, lastGeneratedAt, timeZone, todayDate, scheduledTime, editionText, editionLocale, eventTitles, formatTime, contentBlocked, deleteOutcome, languageFallback, webSearchEnabled, settingsOpen, editionBar, onGenerate, onRetry, onOpenSettings, onConfigureSources, onDeleteRetry }: Readonly<{
  text: DailyBriefingText
  view: DailyBriefingPageViewState
  /** The page's one answer; the generating pane reads it, and it must include service-side runs. */
  mode: DailyBriefingMode
  generating: boolean
  failure: BriefFailure | null
  regenerating: boolean
  liveProgress: BriefingGenerationProgress | undefined
  progressUnreadable: boolean
  resolveProductText: (key: string) => string
  editions: readonly DailyBriefingEditionSummary[]
  lastGeneratedAt?: string
  timeZone: string
  todayDate: string
  scheduledTime?: string
  editionText: DailyBriefingText
  editionLocale: 'zh-CN' | 'en-US'
  eventTitles?: Record<string, string>
  formatTime: (value: string, precision?: 'minute' | 'second') => string
  contentBlocked: boolean
  deleteOutcome: BriefingDeleteOutcome | null
  languageFallback: string | null
  webSearchEnabled: boolean | null
  settingsOpen: boolean
  /** 版次级工具栏：吸在正文滚动区顶部，只作用于当前这一版（三分区的中段）。 */
  editionBar?: React.ReactNode
  onGenerate: () => void
  onRetry: () => void
  onOpenSettings: () => void
  onConfigureSources: () => void
  onDeleteRetry: (target: BriefingDeleteOutcome['target']) => void
}>): React.ReactElement {
  const paperHostRef = useRef<HTMLDivElement>(null)
  const paperSheetRef = useRef<HTMLDivElement>(null)
  const [paperScale, setPaperScale] = useState(1)
  const [paperHostHeight, setPaperHostHeight] = useState<number | undefined>(undefined)
  const [paperOffsetX, setPaperOffsetX] = useState(0)
  useEffect(() => {
    const host = paperHostRef.current
    const sheet = paperSheetRef.current
    if (!host || !sheet || typeof ResizeObserver === 'undefined') return
    const measure = (): void => {
      const width = host.clientWidth
      // Never enlarge: the sheet's own size is the design's, and upscaling only makes the text soft.
      const scale = width > 0 ? Math.min(1, width / BRIEFING_PAPER_WIDTH) : 1
      setPaperScale(scale)
      setPaperHostHeight(sheet.offsetHeight > 0 ? sheet.offsetHeight * scale : undefined)
      setPaperOffsetX(Math.max(0, (width - BRIEFING_PAPER_WIDTH) / 2))
    }
    // The container's width decides the scale; the sheet's own height decides the room. Neither
    // observer watches the wrapper itself — a scaled element reports its scaled size, and observing it
    // would feed its own output back into the measurement.
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    observer.observe(sheet)
    measure()
    return () => observer.disconnect()
  }, [view])
  // What the body is showing: one edition the reader can read, in this or an earlier version.
  const showingEdition = view.status === 'ready' && !contentBlocked
  return <section className="mi-daily-briefing-page__content">
    {editionBar}
    {deleteOutcome ? <DailyBriefingDeleteOutcomeNote outcome={deleteOutcome} text={text} onRetry={(outcome) => onDeleteRetry(outcome.target)} /> : null}
    <DailyBriefingLanguageFallback requested={languageFallback} text={text} />
    <DailyBriefingStorageNotice text={text.migration} />
    {webSearchEnabled === false && !settingsOpen ? <div className="mi-daily-briefing-page__websearch-warning" role="alert">
      <div><strong>{text.aiSettings.webSearchOff}</strong><small>{text.aiSettings.webSearchOffHint}</small></div>
      <Button data-open-settings-section="ai" onClick={onOpenSettings}>{text.aiSettings.goEnable}</Button>
    </div> : null}
    {/* With nothing to read, the body is where the run reports itself. When this issue already has
        an edition, that edition stays readable and the run reports in the right column instead. */}
    {mode === 'generating' && showingEdition
      ? null
      : mode === 'generating'
        ? <DailyBriefingGeneratingView formatTime={formatTime} progress={liveProgress} progressUnreadable={progressUnreadable} resolveText={resolveProductText} text={text} />
        : null}
    {view.status === 'unavailable' && !failure && !generating
      ? <DailyBriefingEmptyState editions={editions} formatTime={formatTime} lastGeneratedAt={lastGeneratedAt} onGenerate={onGenerate} text={text} timeZone={timeZone} todayDate={todayDate} />
      : null}
    {/* Shown during a run too: the reader asked to read this language, and "this issue has no such
        version" is the answer to that, not a reason to replace the pane with the run's own screen. */}
    {view.status === 'locale-missing' ? <DailyBriefingLocaleMissing locale={view.locale} currentPeriod={view.historical !== true && view.date === todayDate} historical={view.historical === true} text={text} onGenerate={onGenerate} /> : null}
    {view.status === 'no-edition' && !generating ? <DailyBriefingNoEditionPanel view={view} text={text} timeZone={timeZone} scheduledTime={scheduledTime} currentPeriodDate={todayDate} formatTime={formatTime} onOpenSettings={onOpenSettings} /> : null}
    {failure ? <DailyBriefingFailurePanel failure={failure} text={text} formatTime={formatTime} regenerating={regenerating} onRetry={onRetry} onOpenSettings={onOpenSettings} /> : null}
    {/* Any editorial failure, not just "AI is off": when the editor could not produce its half, the
        edition still ships and says so here. A reader must never be told "no brief today" instead. */}
    {view.status === 'ready' && view.document.provenance.editorialFailure ? <p className="mi-daily-briefing-page__ai-failure" role="status">{text.aiSettings.notApplied} · {editorialFailureText(view.document.provenance.editorialFailure, text)}</p> : null}
    {showingEdition && view.document.status.readingsAvailable === 0 ? <StateView
      state="empty"
      reasonCode="nothing-enabled"
      productReason={{
        key: 'mi.dailyBriefing.nothingEnabled',
        resolve: (key, params) => resolveBriefingStateReason(text, key, params)
      }}
      action={{ labelKey: 'ui.state.action.open-settings', onSelect: onConfigureSources }}
    /> : null}
    {/* A run replaces this edition only when it succeeds: until then the reader keeps the one that
        is already there, and the run reports in the right column. */}
    {/* The paper is a fixed sheet, never a fluid column: the poster keeps its 1080 px and the page
        scales the whole sheet down. Stretching it to the column width is what re-flowed the three cards
        and wrapped the rate card's number across its dial. */}
    {showingEdition ? <div className="mi-daily-briefing-page__paper" ref={paperHostRef} style={paperHostHeight ? { height: paperHostHeight } : undefined}>
      <div className="mi-daily-briefing-page__paper-scale" style={{ left: paperOffsetX, transform: `scale(${paperScale})` }}>
        <div ref={paperSheetRef} style={{ width: BRIEFING_PAPER_WIDTH }}>
          <DailyBriefingShareCard document={view.document} text={editionText} locale={editionLocale} readOnly={view.kind === 'history'} paymentDirectionsCompact={briefingPaymentDirections(editionLocale)} policyWords={briefingPolicyGaugeWords(editionLocale)} changeArrows={briefingChangeArrows(editionLocale)} fearGreedBuckets={briefingFearGreedBuckets(editionLocale)} {...(eventTitles ? { eventTitles } : {})} formatTime={formatTime} />
        </div>
      </div>
    </div> : null}
  </section>
}
