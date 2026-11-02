
import { LoadingState } from '@platform/ui/components/loading'
import { StatusPill, type StatusPillTone } from '@platform/ui/components/status-pill'
import { StateView } from '@platform/ui/components/state'
import { STATE_VIEW_ACTION_KEYS } from '@platform/ui/components/state/stateViewText'

import type { AgentTaskCenterItem } from '../agentTaskCenterViewModel'
import type { AgentText } from '../agentText'

/**
 * 状态词 → 档位：查表，不写默认值。`已暂停` 与 `已完成` 都是「不用你管」，
 * 区别由文案承担；`已到期` 才需要读者看一眼，所以是 `warn` 而不是 `bad`（那留给已经出错）。
 */
const TASK_TAG_TONE = {
  paused: 'muted',
  completed: 'muted',
  overdue: 'warn'
} as const satisfies Record<string, StatusPillTone>

type AgentTaskCenterListProps = {
  items: readonly AgentTaskCenterItem[]
  selectedTaskId: string | null
  loading: boolean
  /**
   * 首屏就读失败。没有它，「读不到」会被列表画成「从来没有创建过」——两种都空着，但一句话
   * 把责任推给了用户（是你不建），而事实是这一屏没读出来。
   */
  loadFailed: boolean
  labels: AgentText['taskCenter']
  /** 状态文案的解析入口：`StatusPill` 只收键，句子由调用方给。 */
  resolveText: (key: string) => string
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
  loadFailed,
  labels,
  resolveText,
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
      {!loading && !loadFailed && items.length === 0 ? (
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
            {item.task.status === 'paused' ? (
              <StatusPill tone={TASK_TAG_TONE.paused} labelKey="taskCenter.paused" resolveText={resolveText} />
            ) : null}
            {item.task.status === 'completed' ? (
              <StatusPill tone={TASK_TAG_TONE.completed} labelKey="taskCenter.status.completed" resolveText={resolveText} />
            ) : null}
            {item.isOverdue ? (
              <StatusPill tone={TASK_TAG_TONE.overdue} labelKey="taskCenter.overdue" resolveText={resolveText} />
            ) : null}
          </button>
        ))}
      </div>
    </aside>
  )
}
