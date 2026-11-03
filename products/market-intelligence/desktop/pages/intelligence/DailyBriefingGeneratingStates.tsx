import { Button } from 'antd'
import { CircleHelp } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { LoadingState } from '@platform/ui/components/loading'
import { Popover } from '@platform/ui/components/popover'
import { StatusPill } from '@platform/ui/components/status-pill'

import type { BriefingGenerationProgress } from '../../../contracts/dailyBriefing'
import type { DailyBriefingText } from './dailyBriefingText'
import { DailyBriefingGenerationTimeline } from './DailyBriefingGenerationTimeline'
import { runningRowName } from './DailyBriefingLiveSteps'
import type { GenerationTrace } from './dailyBriefingGenerationTrace'

/**
 * What the page shows while today's edition is still being generated.
 *
 * The reader sees one status word in the header (with the stage it is on), a whole loading block in
 * the body — never half a brief, which is worse than none — and the same stage list in the detail
 * column, where it will stay once the run finishes. The generate action is disabled and says why;
 * there is no stop control, because the platform has no such capability and inventing one would be
 * a button that lies.
 */
export function DailyBriefingGeneratingStatus({ text, progress, resolveText }: Readonly<{
  text: DailyBriefingText
  progress: BriefingGenerationProgress | undefined
  resolveText: (key: string) => string
}>): React.ReactElement {
  const stage = progress ? runningRowName(progress, text) : undefined
  return <>
    <StatusPill tone="info" labelKey="pages.intelligence.portal.dashboard.dailyBriefing.generating" resolveText={resolveText} />
    {stage ? <small className="mi-daily-briefing-page__clock-note" data-generating-stage="true">{stage}</small> : null}
    <Button disabled aria-label={text.generationProgress.workingHint}>{text.generating}</Button>
  </>
}

/** The body's generating state: one whole loading block — never half a brief. */
export function DailyBriefingGeneratingView({ text, progressUnreadable, resolveText }: Readonly<{
  text: DailyBriefingText
  progressUnreadable: boolean
  resolveText: (key: string) => string
}>): React.ReactElement {
  return <div className="mi-daily-briefing__state">
    <div className="mi-daily-briefing-page__loading-head">
      <LoadingState label={text.generating} minHeight={220} />
      <Popover
        labelKey="pages.intelligence.portal.dashboard.dailyBriefing.generateHint"
        resolveText={resolveText}
        trigger={(triggerProps) => <IconButton
          {...triggerProps}
          ariaLabelKey="pages.intelligence.portal.dashboard.dailyBriefing.help.generation"
          dataAttributes={{ 'data-generate-help': 'true' }}
          icon={CircleHelp}
          resolveText={resolveText}
          size="sm"
          variant="plain"
        />}
      />
    </div>
    {progressUnreadable ? <p className="mi-daily-briefing-page__loading-hint" data-progress-unreadable="true">{text.generationProgress.unknown}</p> : null}
  </div>
}

/** The stage list has one shape everywhere: a run in flight uses the same stepper as a failed one. */
function traceFromProgress(progress: BriefingGenerationProgress): GenerationTrace {
  return {
    attemptId: progress.attemptId,
    startedAt: progress.startedAt,
    finishedAt: progress.startedAt,
    state: 'success',
    stages: progress.stages.map((stage) => ({ ...stage })) as GenerationTrace['stages']
  }
}

/** The detail column while generating: the stage list, and nothing reader-facing below it. */
export function DailyBriefingGeneratingAside({ text, progress, formatTime }: Readonly<{
  text: DailyBriefingText
  progress: BriefingGenerationProgress | undefined
  formatTime: (value: string, precision?: 'minute' | 'second') => string
}>): React.ReactElement {
  return <aside className="mi-daily-briefing-page__appendix" data-briefing-detail="true" aria-label={text.generationProgress.title}>
    <div data-briefing-stages="true">
      {progress
        ? <DailyBriefingGenerationTimeline formatTime={formatTime} running text={text} trace={traceFromProgress(progress)} />
        : <LoadingState label={text.generationProgress.title} minHeight={120} />}
    </div>
  </aside>
}
