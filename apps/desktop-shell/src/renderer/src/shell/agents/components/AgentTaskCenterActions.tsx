import { Button } from 'antd'
import { Plus, RefreshCw } from 'lucide-react'

/**
 * 标题行右侧的两个动作：刷新、新建。
 *
 * 它们只是把两个回调接到两个按钮上，和抽屉的开合、保存、运行都无关；留在抽屉里时，
 * 抽屉早就过了行数上限，而每次改按钮外观的 diff 又会和改读取逻辑的 diff 撞在一起。
 */
export default function AgentTaskCenterActions(props: {
  refreshLabel: string
  newTaskLabel: string
  onRefresh: () => void
  onCreate: () => void
}): React.ReactElement {
  return (
    <div className="agent-task-center-actions">
      <Button
        className="ant-secondary-button"
        size="small"
        icon={<RefreshCw size={14} />}
        onClick={props.onRefresh}>
        {props.refreshLabel}
      </Button>
      <Button className="ant-primary-button" size="small" icon={<Plus size={14} />} onClick={props.onCreate}>
        {props.newTaskLabel}
      </Button>
    </div>
  )
}
