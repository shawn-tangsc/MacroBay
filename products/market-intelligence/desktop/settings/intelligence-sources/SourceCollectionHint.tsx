import { Play } from 'lucide-react'
import { Button } from 'antd'

export function SourceCollectionHint(props: {
  visible: boolean
  running: boolean
  labels: {
    title: string
    body: string
    action: string
  }
  onRunNow: () => void
}): React.ReactElement | null {
  if (!props.visible) return null

  return (
    <div className="intelligence-collection-hint" role="status">
      <div className="intelligence-collection-hint-copy">
        <strong>{props.labels.title}</strong>
        <p>{props.labels.body}</p>
      </div>
      <Button
        className="ant-primary-button intelligence-collection-hint-action"
        size="small"
        icon={<Play size={14} />}
        loading={props.running}
        onClick={props.onRunNow}
      >
        {props.labels.action}
      </Button>
    </div>
  )
}
