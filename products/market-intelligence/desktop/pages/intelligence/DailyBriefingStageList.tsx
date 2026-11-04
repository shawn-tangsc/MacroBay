import { Steps } from 'antd'
import { CircleHelp } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'

/**
 * One stepper of stage rows, drawn once.
 *
 * The live run and the recorded trace used to map the same stages in two files, so "generating" and
 * "finished/failed" could differ in shape, in wording and in spacing. Both now hand their rows to the
 * same stepper; this file is the only place in the repository that renders a stage row.
 */
export type DailyBriefingStageRowState = 'done' | 'not-needed' | 'running' | 'waiting' | 'failed'

export type DailyBriefingStageRow = Readonly<{
  /** The contract's stage id, also the row's identity in tests and in the audit trail. */
  id: string
  name: string
  state: DailyBriefingStageRowState
  detail: string
  /** Extra anchors for this row (the trace's own skip marker, for instance). */
  attributes?: Readonly<Record<string, string>>
  /** A failure's code line, shown under the detail; absent on a clean row. */
  failure?: Readonly<{ code: string; label: string }>
  /** The help popover's trigger, when this row carries the stage's own explanation. */
  help?: Readonly<{
    /** The explanation's body. */
    labelKey: string
    /** The trigger's accessible name, when it is not the body's own label. */
    triggerLabelKey?: string
    triggerLabelParams?: Readonly<Record<string, string>>
    dataAttributes?: Readonly<Record<string, string>>
  }>
}>

/**
 * One row's content. Both the live run and the recorded trace render through this, so a row says the
 * same things in both: the same name, the same state word, the same detail, the same failure code.
 * The anchor is here because this is the row.
 *
 * It draws no status mark of its own: the stepper's circle is the one and only mark, so a finished
 * row cannot show two ticks.
 */
export function DailyBriefingStageRowContent({ row, resolveText, extraAttributes, children }: Readonly<{
  row: DailyBriefingStageRow
  resolveText?: (key: string) => string
  /** Anchors a caller needs on the row itself (the trace's skip reason, for instance). */
  extraAttributes?: Readonly<Record<string, string>>
  /** The caller's own wrapper (the stepper item's title) goes around this content. */
  children?: React.ReactNode
}>): React.ReactElement {
  const help = row.help
  return <span className="mi-brief-steps__row-content" data-briefing-stage-row="true" data-stage={row.id} data-stage-state={row.state} {...extraAttributes}>
    {/* The question mark comes before the name it explains, as everywhere else in the app: the
        reader meets the explanation before the word it belongs to. */}
    {help && resolveText
      ? <Popover
        labelKey={help.labelKey}
        resolveText={resolveText}
        trigger={(triggerProps) => <IconButton
          {...triggerProps}
          ariaLabelKey={help.triggerLabelKey ?? help.labelKey}
          {...(help.triggerLabelParams ? { ariaLabelParams: help.triggerLabelParams } : {})}
          {...(help.dataAttributes ? { dataAttributes: help.dataAttributes } : {})}
          icon={CircleHelp}
          resolveText={resolveText}
          size="sm"
          variant="plain"
        />}
      />
      : null}
    <span className="mi-brief-steps__name">{row.name}</span>
    <span className="mi-brief-steps__detail" data-stage-result={row.id} data-stage-result-state={row.state}>
      {row.detail}
      {/* The failure's code line belongs to the stage's recorded result, not beside it. */}
      {row.failure ? <span className="mi-brief-steps__failure" data-stage-failure-code={row.failure.code}>{row.failure.label}</span> : null}
    </span>
    {children}
  </span>
}

/** A row state and the stepper status that says the same thing. */
const STEP_STATUS: Readonly<Record<DailyBriefingStageRowState, 'finish' | 'error' | 'process' | 'wait'>> = {
  done: 'finish',
  // A repair that was not needed still completed; it is not a stage that waits to run.
  'not-needed': 'finish',
  running: 'process',
  waiting: 'wait',
  failed: 'error'
}

/**
 * The stage list in every state: one stepper, one row implementation.
 *
 * The live run and the finished or failed trace both come through here, so the two states cannot
 * drift apart in indent, row pitch, type size or connector position — they are the same container.
 */
export function DailyBriefingStageSteps({ rows, resolveText }: Readonly<{
  rows: readonly DailyBriefingStageRow[]
  /** Product text resolver for the help popover; absent means no help trigger. */
  resolveText?: (key: string) => string
}>): React.ReactElement {
  return <Steps
    className="mi-brief-steps__stepper"
    direction="vertical"
    size="small"
    items={rows.map((row) => ({
      key: row.id,
      status: STEP_STATUS[row.state],
      title: <DailyBriefingStageRowContent row={row} {...(resolveText ? { resolveText } : {})} {...(row.attributes ? { extraAttributes: row.attributes } : {})} />,
      // The row keeps its own single line: name, its help and the recorded time sit together, and
      // there is no second description line to repeat what the row already says.
      description: null
    }))}
  />
}
