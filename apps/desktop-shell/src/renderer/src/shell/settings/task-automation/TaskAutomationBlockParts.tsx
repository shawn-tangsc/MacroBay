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

export function BlockEmpty(props: {
  title?: string
  body?: string
  actionLabel?: string
  onAction?: () => void
}): React.ReactElement {
  return (
    <div className="task-automation-empty">
      {props.title ? <strong>{props.title}</strong> : null}
      {props.body ? <p>{props.body}</p> : null}
      {props.actionLabel && props.onAction ? (
        <button type="button" className="task-automation-link-button" onClick={props.onAction}>
          {props.actionLabel}
        </button>
      ) : null}
    </div>
  )
}
