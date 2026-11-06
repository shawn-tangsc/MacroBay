import { Button } from 'antd'

import type { DailyBriefingText } from './dailyBriefingText'
import type { GenerationTrace } from './dailyBriefingGenerationTrace'
import { DailyBriefingGenerationTimeline, formatDuration } from './DailyBriefingGenerationTimeline'
import { DailyBriefingStagePanel } from './DailyBriefingStagePanel'
import { briefingFailureSentence } from './briefingFailureSentence'
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
export function DailyBriefingFailurePanel({ failure, text, formatTime, regenerating, retryBlockedReason, onRetry, onOpenSettings }: Readonly<{
  failure: BriefFailure
  text: DailyBriefingText
  formatTime: (value: string, precision?: 'minute' | 'second') => string
  regenerating: boolean
  /**
   * Retrying would write today's edition where a past one should be, so the action is disabled and
   * this sentence becomes its accessible name. Absent means retry is a real action.
   */
  retryBlockedReason?: string
  onRetry: () => void
  onOpenSettings: () => void
}>): React.ReactElement {
  const advice = failureAdvice(failure.code)
  const codeLabel = briefFailureCodeLabel(failure.code, { failure: text.aiSettings.failure, failurePanel: text.failurePanel })
  const detail = readableFailureDetail(failure.detail, text.failurePanel.detail)
  const separator = text.labelSeparator
  // 人话原因：**哪一步没跑完 + 发生了什么（用了多久）+ 接下来怎么办**，由文案表逐码拼出来。
  // 表里还没有这个码时退回原来的标签——不许在这里自己造句。
  const stalled = failure.generationTrace?.stages.find((stage) => stage.state === 'failed')
  const sentence = briefingFailureSentence({
    code: failure.code,
    ...(stalled === undefined ? {} : { failedStage: text.generationTrace.stages[stalled.id] ?? stalled.id }),
    ...(stalled?.durationMs === undefined ? {} : { durationMs: stalled.durationMs }),
    sentences: text.failureSentences,
    templates: text.failureSentenceTemplates,
    formatDuration: (durationMs) => formatDuration(durationMs, text)
  })
  return <DailyBriefingStagePanel state="failed"
    title={failure.kind === 'editorial' ? text.failurePanel.editorialTitle : text.failurePanel.generationTitle}
    dataAttributes={{
      role: 'alert',
      'data-daily-brief-failure': 'true',
      'data-failure-kind': failure.kind,
      'data-failure-advice': advice,
      ...(failure.code ? { 'data-failure-code': failure.code } : {})
    }}>

    {sentence === undefined
      ? <>
        <p data-failure-code-label>{text.failurePanel.codeLabel}{separator}{codeLabel}</p>
        {detail ? <p data-failure-detail>{text.failurePanel.detailLabel}{separator}{detail}</p> : null}
        <p data-failure-advice-text>{text.failurePanel.suggestionLabel}{separator}{text.failurePanel.advice[advice]}</p>
      </>
      : <>
        {/* 一句人话：哪一步没跑完、发生了什么、用了多久。内部码不上屏。 */}
        <p data-failure-reason>{sentence.reason}</p>
        <p data-failure-next>{sentence.next}</p>
      </>}
    <DailyBriefingGenerationTimeline trace={failure.generationTrace} text={text} formatTime={formatTime} />
    <div className="mi-daily-briefing-page__failure-actions">
      <Button type="primary" className="mi-daily-briefing-page__primary" data-failure-action="retry" disabled={regenerating || retryBlockedReason !== undefined}
        {...(retryBlockedReason !== undefined ? { 'aria-label': retryBlockedReason, title: retryBlockedReason } : {})}
        onClick={onRetry}>
        {regenerating ? text.regenerating : text.regenerate}
      </Button>
      {/* Two actions only: retry here, or the same settings drawer the header opens. The advice
          paragraph above already names what to check, so a third button per advice would repeat it. */}
      <Button data-failure-action="settings" data-open-settings-section="ai" onClick={onOpenSettings}>{text.settingsDrawer.open}</Button>
    </div>
  </DailyBriefingStagePanel>
}
