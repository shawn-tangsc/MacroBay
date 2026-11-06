/**
 * The panel that holds a generation, at any of its three moments.
 *
 * Generating, failed and finished used to be three different shells with the same anchors, so they
 * could drift in structure the way the stage rows did. They now share this one: the caller supplies
 * the state word, a title and the body; the shell supplies the box, the heading and the anchor.
 */
export function DailyBriefingStagePanel({ state, title, summary, children, dataAttributes }: Readonly<{
  state: 'generating' | 'failed' | 'done'
  title: string
  /** The line under the title: what the reader can act on without opening anything. */
  summary?: string
  children: React.ReactNode
  dataAttributes?: Readonly<Record<string, string>>
}>): React.ReactElement {
  return <div className="mi-daily-briefing-page__failure" data-briefing-stage-panel="true" data-state={state} {...dataAttributes}>
    <h2>{title}</h2>
    {summary ? <p data-stage-panel-summary="true">{summary}</p> : null}
    {children}
  </div>
}
