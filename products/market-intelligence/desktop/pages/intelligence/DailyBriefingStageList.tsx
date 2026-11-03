import { Check, CircleAlert, CircleHelp, Loader, Minus } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'

/**
 * One list of stage rows, drawn once.
 *
 * The live run and the recorded trace used to map the same stages in two files, so "generating" and
 * "finished/failed" could differ in shape and in wording. Both now hand their rows here; this file
 * is the only place in the repository that renders a stage row.
 */
export type DailyBriefingStageRowState = 'done' | 'not-needed' | 'running' | 'waiting' | 'failed'

export type DailyBriefingStageRow = Readonly<{
  /** The contract's stage id, also the row's identity in tests and in the audit trail. */
  id: string
  name: string
  state: DailyBriefingStageRowState
  detail: string
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
 * One row's content. Both the live list and the recorded stage list render through this, so a row
 * says the same things in both: the same name, the same state word, the same detail, the same
 * failure code. The anchor is here because this is the row.
 */
export function DailyBriefingStageRowContent({ row, resolveText, extraAttributes, children }: Readonly<{
  row: DailyBriefingStageRow
  resolveText?: (key: string) => string
  /** Anchors a caller needs on the row itself (the trace's skip reason, for instance). */
  extraAttributes?: Readonly<Record<string, string>>
  /** The caller's own wrapper (a list item, a stepper item's title) goes around this content. */
  children?: React.ReactNode
}>): React.ReactElement {
  const help = row.help
  return <span className="mi-brief-steps__row-content" data-briefing-stage-row="true" data-stage={row.id} data-stage-state={row.state} {...extraAttributes}>
    <StepIcon state={row.state} />
    <span className="mi-brief-steps__name">{row.name}</span>
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
    <span className="mi-brief-steps__detail" data-stage-result={row.id} data-stage-result-state={row.state}>
      {row.detail}
      {/* The failure's code line belongs to the stage's recorded result, not beside it. */}
      {row.failure ? <span className="mi-brief-steps__failure" data-stage-failure-code={row.failure.code}>{row.failure.label}</span> : null}
    </span>
    {children}
  </span>
}

export function DailyBriefingStageList({ rows, resolveText, dataAttributes }: Readonly<{
  rows: readonly DailyBriefingStageRow[]
  /** Product text resolver for the help popover; absent means no help trigger. */
  resolveText?: (key: string) => string
  /** Extra anchors the caller needs on the list element. */
  dataAttributes?: Readonly<Record<string, string | undefined>>
}>): React.ReactElement {
  return <ol className="mi-brief-steps__list" data-briefing-stages="true" {...dataAttributes}>
    {rows.map((row) => <li key={row.id} className="mi-brief-steps__row" data-step={row.id} data-step-state={row.state}>
      <DailyBriefingStageRowContent row={row} {...(resolveText ? { resolveText } : {})} />
    </li>)}
  </ol>
}

function StepIcon({ state }: Readonly<{ state: DailyBriefingStageRowState }>): React.ReactElement {
  const size = 12
  if (state === 'done') return <Check aria-hidden="true" className="mi-brief-steps__icon" size={size} />
  if (state === 'failed') return <CircleAlert aria-hidden="true" className="mi-brief-steps__icon" size={size} />
  if (state === 'not-needed') return <Minus aria-hidden="true" className="mi-brief-steps__icon" size={size} />
  return <Loader aria-hidden="true" className="mi-brief-steps__icon" size={size} />
}
