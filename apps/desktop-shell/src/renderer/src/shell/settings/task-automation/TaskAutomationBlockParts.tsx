import { LoadingState } from '@platform/ui/components/loading'

export function BlockError(props: {
  label: string
  retryLabel: string
  onRetry: () => void
}): React.ReactElement {
  return (
    <p className="task-automation-block-state task-automation-error">
      <span>{props.label}</span>
      <button type="button" className="task-automation-link-button" onClick={props.onRetry}>
        {props.retryLabel}
      </button>
    </p>
  )
}

export function BlockLoading(props: { label: string }): React.ReactElement {
  return <LoadingState label={props.label} minHeight={120} />
}
