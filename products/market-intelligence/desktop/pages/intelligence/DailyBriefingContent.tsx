import { Button } from 'antd'

import { StateView } from '@platform/ui/components/state'

import type { BriefingGenerationProgress } from '../../../contracts/dailyBriefing'
import type { DailyBriefingEditionSummary } from '../../../contracts/dailyBriefing'
import type { BriefingDeleteOutcome } from './useDailyBriefingIssueDeletion'
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
import { DailyBriefingStorageNotice } from './DailyBriefingStorageNotice'
import { editorialFailureText } from './dailyBriefingPageDerived'
import { resolveBriefingStateReason } from './dailyBriefingText'

/**
 * Everything the reading pane can show, in one place.
 *
 * Kept out of the page for size, and because the pane's states belong together: a run in flight,
 * nothing generated, a missing language, a failure, an edition. The page decides which state it is
 * in; this file decides how each one looks.
 */
export function DailyBriefingContent({ text, view, generating, failure, regenerating, liveProgress, progressUnreadable, resolveProductText, editions, lastGeneratedAt, timeZone, todayDate, scheduledTime, editionText, editionLocale, eventTitles, formatTime, contentBlocked, deleteOutcome, languageFallback, webSearchEnabled, settingsOpen, onGenerate, onRetry, onOpenSettings, onConfigureSources, onDeleteRetry }: Readonly<{
  text: DailyBriefingText
  view: DailyBriefingPageViewState
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
  onGenerate: () => void
  onRetry: () => void
  onOpenSettings: () => void
  onConfigureSources: () => void
  onDeleteRetry: (target: BriefingDeleteOutcome['target']) => void
}>): React.ReactElement {
  return <section className="mi-daily-briefing-page__content">
    {deleteOutcome ? <DailyBriefingDeleteOutcomeNote outcome={deleteOutcome} text={text} onRetry={(outcome) => onDeleteRetry(outcome.target)} /> : null}
    <DailyBriefingLanguageFallback requested={languageFallback} text={text} />
    <DailyBriefingStorageNotice text={text.migration} />
    {webSearchEnabled === false && !settingsOpen ? <div className="mi-daily-briefing-page__websearch-warning" role="alert">
      <div><strong>{text.aiSettings.webSearchOff}</strong><small>{text.aiSettings.webSearchOffHint}</small></div>
      <Button data-open-settings-section="ai" onClick={onOpenSettings}>{text.aiSettings.goEnable}</Button>
    </div> : null}
    {/* A run in flight owns the pane, whatever local state says: the scheduled run and a run
        started elsewhere land here too, and the nine steps must be visible while it works. */}
    {view.status === 'loading' || (generating && view.status !== 'ready')
      ? <DailyBriefingGeneratingView formatTime={formatTime} progress={liveProgress} progressUnreadable={progressUnreadable} resolveText={resolveProductText} text={text} />
      : null}
    {view.status === 'unavailable' && !failure && !generating
      ? <DailyBriefingEmptyState editions={editions} formatTime={formatTime} lastGeneratedAt={lastGeneratedAt} onGenerate={onGenerate} text={text} timeZone={timeZone} todayDate={todayDate} />
      : null}
    {view.status === 'locale-missing' && !generating ? <DailyBriefingLocaleMissing locale={view.locale} currentPeriod={view.historical !== true && view.date === todayDate} historical={view.historical === true} text={text} onGenerate={onGenerate} /> : null}
    {view.status === 'no-edition' && !generating ? <DailyBriefingNoEditionPanel view={view} text={text} timeZone={timeZone} scheduledTime={scheduledTime} currentPeriodDate={todayDate} formatTime={formatTime} onOpenSettings={onOpenSettings} /> : null}
    {failure ? <DailyBriefingFailurePanel failure={failure} text={text} formatTime={formatTime} regenerating={regenerating} onRetry={onRetry} onOpenSettings={onOpenSettings} /> : null}
    {view.status === 'ready' && view.document.provenance.editorialFailure === 'editorial-disabled' ? <p className="mi-daily-briefing-page__ai-failure" role="status">{text.aiSettings.notApplied} · {editorialFailureText('editorial-disabled', text)}</p> : null}
    {view.status === 'ready' && !contentBlocked && view.document.status.readingsAvailable === 0 ? <StateView
      state="empty"
      reasonCode="nothing-enabled"
      productReason={{
        key: 'mi.dailyBriefing.nothingEnabled',
        resolve: (key, params) => resolveBriefingStateReason(text, key, params)
      }}
      action={{ labelKey: 'ui.state.action.open-settings', onSelect: onConfigureSources }}
    /> : null}
    {view.status === 'ready' && !contentBlocked ? <div className="mi-daily-briefing-page__paper">
      <DailyBriefingShareCard document={view.document} text={editionText} locale={editionLocale} readOnly={view.kind === 'history'} {...(eventTitles ? { eventTitles } : {})} formatTime={formatTime} />
    </div> : null}
  </section>
}
