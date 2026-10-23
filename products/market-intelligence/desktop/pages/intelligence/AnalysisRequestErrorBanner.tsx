import { Button } from 'antd'
import { TriangleAlert, X } from 'lucide-react'
import { useState } from 'react'

/**
 * A failed analysis request, rendered as the error it is.
 *
 * These failures used to be one more `__state` line in the same muted grey as "loading…" and
 * "the latest analysis is already available", so a rejected run read like a normal state of the
 * module: the reader had to parse a sentence to notice that nothing was going to happen. An
 * error is red, announced (`role="alert"`), and can be put away.
 */
export function AnalysisRequestErrorBanner({ message, detail, meta = [], dismissLabel, onDismiss }: Readonly<{
  /** What failed, in the reader's language. */
  message: string
  /** The service's recorded reason, when it named one. */
  detail?: string
  /** Identity of the failed run, kept under the reason so the headline stays readable. */
  meta?: readonly string[]
  dismissLabel: string
  onDismiss: () => void
}>): React.ReactElement {
  return <div className="mi-analysis-error" role="alert" data-analysis-error>
    <TriangleAlert className="mi-analysis-error__icon" size={14} aria-hidden="true" />
    <div className="mi-analysis-error__body">
      <strong>{message}</strong>
      {detail ? <p data-analysis-error-detail>{detail}</p> : null}
      {meta.map(line => <p className="mi-analysis-error__meta" key={line}>{line}</p>)}
    </div>
    <Button
      className="mi-analysis-error__dismiss"
      type="text"
      size="small"
      icon={<X size={14} aria-hidden="true" />}
      aria-label={dismissLabel}
      title={dismissLabel}
      onClick={onDismiss}
      data-analysis-error-dismiss
    />
  </div>
}

/**
 * Whether the failure currently on screen is still worth showing.
 *
 * `visible` is the caller's statement that there is a failure to show; this hook only remembers
 * that the reader put *that* failure away. Once the failure stops being current — the request
 * went back to loading or queued, or an analysis was published — the dismissal is forgotten, so
 * the next failure opens the banner again instead of disappearing silently.
 *
 * The adjustment happens while rendering rather than in an effect: an effect runs after paint,
 * which would hide a fresh failure for one frame behind the dismissal of the previous one.
 */
export function useDismissibleError(visible: boolean): Readonly<{ visible: boolean; dismiss: () => void }> {
  const [dismissed, setDismissed] = useState(false)
  const [wasVisible, setWasVisible] = useState(visible)
  if (visible !== wasVisible) {
    setWasVisible(visible)
    if (!visible) setDismissed(false)
  }
  return { visible: visible && !dismissed, dismiss: () => setDismissed(true) }
}
