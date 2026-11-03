import { Button } from 'antd'

import type { DailyBriefingText } from './dailyBriefingText'
import type { GenerationTrace } from './dailyBriefingGenerationTrace'
import { DailyBriefingGenerationTimeline } from './DailyBriefingGenerationTimeline'
import { briefFailureCodeLabel, failureAdvice, readableFailureDetail } from './dailyBriefingFailureDetail'

/** A generation or editorial attempt that did not produce a readable edition. */
export type BriefFailure = Readonly<{
  kind: 'editorial' | 'generation'
  code?: string
  detail?: string
  generationTrace?: GenerationTrace
}>

/**
 * What a failed attempt shows: which layer failed, the redacted code and detail, the advice, and
 * the stage trace of the attempt.
 *
 * Kept out of the page for the same reason the live steps are: the page decides which run to
 * display and what its actions do, not how a failure is laid out.
 */
export function DailyBriefingFailurePanel({ failure, text, formatTime, regenerating, onRetry, onOpenSettings }: Readonly<{
  failure: BriefFailure
  text: DailyBriefingText
  formatTime: (value: string, precision?: 'minute' | 'second') => string
  regenerating: boolean
  onRetry: () => void
  onOpenSettings: () => void
}>): React.ReactElement {
  const advice = failureAdvice(failure.code)
  const codeLabel = briefFailureCodeLabel(failure.code, { failure: text.aiSettings.failure, failurePanel: text.failurePanel })
  const detail = readableFailureDetail(failure.detail, text.failurePanel.detail)
  const separator = text.labelSeparator
  return <div className="mi-daily-briefing-page__failure" role="alert"
    data-daily-brief-failure="true" data-failure-kind={failure.kind} data-failure-advice={advice}
    {...(failure.code ? { 'data-failure-code': failure.code } : {})}>
    <h2>{failure.kind === 'editorial' ? text.failurePanel.editorialTitle : text.failurePanel.generationTitle}</h2>
    <p data-failure-code-label>{text.failurePanel.codeLabel}{separator}{codeLabel}</p>
    {detail ? <p data-failure-detail>{text.failurePanel.detailLabel}{separator}{detail}</p> : null}
    <p data-failure-advice-text>{text.failurePanel.suggestionLabel}{separator}{text.failurePanel.advice[advice]}</p>
    <DailyBriefingGenerationTimeline trace={failure.generationTrace} text={text} formatTime={formatTime} />
    <div className="mi-daily-briefing-page__failure-actions">
      <Button type="primary" className="mi-daily-briefing-page__primary" data-failure-action="retry" disabled={regenerating} onClick={onRetry}>
        {regenerating ? text.regenerating : text.regenerate}
      </Button>
      {/* Two actions only: retry here, or the same settings drawer the header opens. The advice
          paragraph above already names what to check, so a third button per advice would repeat it. */}
      <Button data-failure-action="settings" data-open-settings-section="ai" onClick={onOpenSettings}>{text.settingsDrawer.open}</Button>
    </div>
  </div>
}
