import { Tag } from 'antd'

import { LoadingState } from '@platform/ui/components/loading'
import { StateView } from '@platform/ui/components/state'
import { STATE_VIEW_ACTION_KEYS } from '@platform/ui/components/state/stateViewText'

import type { AgentTaskCenterItem } from '../agentTaskCenterViewModel'
import type { AgentText } from '../agentText'

type AgentTaskCenterListProps = {
  items: readonly AgentTaskCenterItem[]
  selectedTaskId: string | null
  loading: boolean
  labels: AgentText['taskCenter']
  onSelect: (taskId: string) => void
  onCreate: () => void
}

/**
 * 任务中心左侧的任务列表。
 *
 * 从抽屉里分出来，是因为抽屉的职责是「开合 + 保存 + 运行」，而这一栏只负责「把任务列出来并选中」。
 * 放在一起时，改列表样式的人会在抽屉的 diff 里和改保存逻辑的人撞在一起。
 */
export default function AgentTaskCenterList({
  items,
  selectedTaskId,
  loading,
  labels,
  onSelect,
  onCreate
}: AgentTaskCenterListProps): React.ReactElement {
  return (
    <aside className="agent-task-list-pane">
      <header>
        <strong>{labels.taskList}</strong>
        <small>{labels.taskCount(items.length)}</small>
      </header>
      {loading && items.length === 0 ? <LoadingState label={labels.loading} minHeight={120} /> : null}
      {!loading && items.length === 0 ? (
        <StateView
          state="empty"
          reasonCode="never-created"
          size="sm"
          action={{ labelKey: STATE_VIEW_ACTION_KEYS.create, onSelect: onCreate }}
        />
      ) : null}
      <div className="agent-task-list">
        {items.map((item) => (
          <button
            key={item.task.id}
            type="button"
            className={item.task.id === selectedTaskId ? 'agent-task-list-item active' : 'agent-task-list-item'}
            onClick={() => onSelect(item.task.id)}>
            <span className={`agent-task-status-dot ${item.runtimeStatus}`} />
            <span>
              <strong>{item.task.name}</strong>
              <small>{item.triggerLabel}</small>
            </span>
            {item.task.status === 'paused' ? <Tag className="agent-task-tag">{labels.paused}</Tag> : null}
            {item.task.status === 'completed' ? <Tag className="agent-task-tag">{labels.status.completed}</Tag> : null}
            {item.isOverdue ? <Tag className="agent-task-tag">{labels.overdue}</Tag> : null}
          </button>
        ))}
      </div>
    </aside>
  )
}
