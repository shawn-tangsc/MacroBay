import { Button, Drawer, Tag } from 'antd'
import { Plus, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { ScheduledTaskEntity, TaskRunLogEntity } from '@platform/ai/agent-platform/schemas/taskSchemas'
import type { AgentSessionWorkspaceSource } from '@platform/ai/agent-platform/schemas/workspaceSchemas'
import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'
import type { JobRunRecord } from '@platform/jobs'
import { LoadingState } from '@platform/ui/components/loading'
import { useAgentText } from '../agentTextProvider'
import {
  buildAgentTaskCenterState,
  buildAgentTaskDraftFromTask,
  buildCreateTaskDtoFromDraft,
  buildDefaultAgentTaskDraft,
  buildTaskDeliveryAttemptRequest,
  buildTaskJobQuery,
  buildTaskRunRefreshQuery,
  buildUpdateTaskRequestFromDraft,
  mergeTaskDeliveryRun,
  type AgentTaskDraft
} from '../agentTaskCenterViewModel'
import {
  cancelTaskRunViaApi,
  createTaskViaApi,
  deleteTaskViaApi,
  getTaskLogsViaApi,
  listTaskJobPageViaApi,
  listTasksViaApi,
  isTaskRevisionConflict,
  runTaskViaApi,
  updateTaskViaApi
} from '../agentTaskDataApi'
import { selectSessionViaApi } from '../agentSessionDataApi'
import AgentTaskDraftForm from './AgentTaskDraftForm'
import AgentTaskRunSection from './AgentTaskRunSection'
import { useAgentTaskDeliveryAttempts } from './useAgentTaskDeliveryAttempts'
import { useAgentTaskRuntimeSignals } from './useAgentTaskRuntimeSignals'
type AgentTaskCenterDrawerProps = {
  open: boolean
  state: AgentStoreState
  agent: AgentEntity
  workspace: AgentSessionWorkspaceSource
  onClose: () => void
  onStateChange: (updater: (state: AgentStoreState) => AgentStoreState) => void
}
type LoadState = {
  tasks: ScheduledTaskEntity[]
  logsByTaskId: Record<string, TaskRunLogEntity[]>
  logsTotalByTaskId: Record<string, number>
  jobsByRunLogId: Record<string, JobRunRecord | null>
}
const emptyLoadState: LoadState = {
  tasks: [],
  logsByTaskId: {},
  logsTotalByTaskId: {},
  jobsByRunLogId: {}
}
export default function AgentTaskCenterDrawer({
  open,
  state,
  agent,
  workspace,
  onClose,
  onStateChange
}: AgentTaskCenterDrawerProps): React.ReactElement {
  const t = useAgentText()
  const [loadState, setLoadState] = useState<LoadState>(emptyLoadState)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [draft, setDraft] = useState<AgentTaskDraft>(() => buildDefaultAgentTaskDraft(workspace))
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedRunLogId, setSelectedRunLogId] = useState<string | null>(null)
  const centerState = useMemo(
    () => buildAgentTaskCenterState({ ...loadState, labels: t.taskCenter, selectedTaskId }),
    [loadState, selectedTaskId, t.taskCenter]
  )
  const selectedTask = centerState.selectedTask
  const selectedItem = centerState.items.find((item) => item.task.id === centerState.selectedTaskId) ?? null
  const { schedulePreview } = useAgentTaskRuntimeSignals({ agentId: agent.id, draft, selectedTask })
  const deliveryAttemptRequest = buildTaskDeliveryAttemptRequest(centerState.selectedLogs, selectedRunLogId, 0)
  const deliveryAttempts = useAgentTaskDeliveryAttempts({ agentId: agent.id, runLogId: deliveryAttemptRequest?.runLogId ?? null })
  useEffect(() => {
    if (!open) return
    setDraft(buildDefaultAgentTaskDraft(workspace))
    void refresh(undefined)
  }, [open, agent.id, workspace])
  useEffect(() => {
    if (!selectedTask) return
    setDraft(buildAgentTaskDraftFromTask(selectedTask))
  }, [selectedTask?.id])
  useEffect(() => {
    setSelectedRunLogId(null)
  }, [selectedTask?.id])
  async function refresh(nextSelectedTaskId: string | null | undefined = selectedTaskId): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const taskPage = await listTasksViaApi(window.platform, agent.id, { limit: 50 })
      const logsByTaskId: Record<string, TaskRunLogEntity[]> = {}
      const logsTotalByTaskId: Record<string, number> = {}
      const jobsByRunLogId: Record<string, JobRunRecord | null> = {}
      await Promise.all(
        taskPage.tasks.map(async (task) => {
          const logsPage = await getTaskLogsViaApi(window.platform, agent.id, task.id, { limit: 10 })
          logsByTaskId[task.id] = logsPage.logs
          logsTotalByTaskId[task.id] = logsPage.total
          await Promise.all(
            logsPage.logs.map(async (log) => {
              const page = await listTaskJobPageViaApi(window.platform, buildTaskJobQuery(log.id))
              jobsByRunLogId[log.id] = page.runs[0] ?? null
            })
          )
        })
      )
      setLoadState({ tasks: taskPage.tasks, logsByTaskId, logsTotalByTaskId, jobsByRunLogId })
      setSelectedTaskId(nextSelectedTaskId === undefined ? taskPage.tasks[0]?.id ?? null : nextSelectedTaskId)
    } catch {
      setError(t.taskCenter.loadFailed)
    } finally {
      setLoading(false)
    }
  }
  async function saveTask(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      if (selectedTaskId) {
        const result = buildUpdateTaskRequestFromDraft(draft)
        if (!result.ok) {
          setError(result.reason === 'revision-required' ? t.taskCenter.saveFailed : t.taskCenter.validation[result.reason])
          return
        }
        const saved = await updateTaskViaApi(
          window.platform,
          agent.id,
          selectedTaskId,
          result.request.expectedRevision,
          result.request.patch
        )
        await refresh(saved?.id ?? selectedTaskId)
        if (saved) setDraft(buildAgentTaskDraftFromTask(saved))
        return
      }

      const result = buildCreateTaskDtoFromDraft(draft)
      if (!result.ok) {
        setError(t.taskCenter.validation[result.reason])
        return
      }
      const saved = await createTaskViaApi(window.platform, agent.id, result.dto)
      await refresh(saved.id)
      if (saved) {
        setDraft(buildAgentTaskDraftFromTask(saved))
      }
    } catch (saveError) {
      if (isTaskRevisionConflict(saveError)) {
        await refresh(selectedTaskId)
        const latest = await listTasksViaApi(window.platform, agent.id, { limit: 50 })
        const refreshedTask = latest.tasks.find((task) => task.id === selectedTaskId)
        if (refreshedTask) setDraft(buildAgentTaskDraftFromTask(refreshedTask))
        setError(t.taskCenter.revisionConflict)
      } else {
        setError(t.taskCenter.saveFailed)
      }
    } finally {
      setSaving(false)
    }
  }
  async function deleteTask(task: ScheduledTaskEntity): Promise<void> {
    if (!window.confirm(t.taskCenter.confirmDelete(task.name))) return
    setSaving(true)
    setError(null)
    try {
      await deleteTaskViaApi(window.platform, agent.id, task.id, task.revision ?? 1)
      setDraft(buildDefaultAgentTaskDraft(workspace))
      await refresh(null)
    } catch {
      setError(t.taskCenter.deleteFailed)
    } finally {
      setSaving(false)
    }
  }
  async function runTask(task: ScheduledTaskEntity): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      const result = await runTaskViaApi(window.platform, agent.id, task.id, task.revision ?? 1)
      await refresh(result.taskId)
    } catch {
      setError(t.taskCenter.runFailed)
    } finally {
      setSaving(false)
    }
  }
  async function cancelRunningTask(runLogId: string): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      await cancelTaskRunViaApi(window.platform, runLogId)
      await refresh(selectedTaskId)
    } catch {
      setError(t.taskCenter.cancelFailed)
    } finally {
      setSaving(false)
    }
  }
  async function loadMoreRuns(): Promise<void> {
    if (!selectedTask) return
    const existing = loadState.logsByTaskId[selectedTask.id] ?? []
    const page = await getTaskLogsViaApi(window.platform, agent.id, selectedTask.id, {
      limit: 10,
      offset: existing.length
    })
    setLoadState((current) => ({
      ...current,
      logsByTaskId: { ...current.logsByTaskId, [selectedTask.id]: [...existing, ...page.logs] },
      logsTotalByTaskId: { ...current.logsTotalByTaskId, [selectedTask.id]: page.total }
    }))
  }
  async function retryDelivery(attemptId: string): Promise<void> {
    const runLogId = deliveryAttemptRequest?.runLogId
    if (!selectedTaskId || !runLogId) return
    const refreshQuery = buildTaskRunRefreshQuery(centerState.selectedLogs, runLogId)
    if (!refreshQuery) return
    setSaving(true)
    setError(null)
    try {
      await deliveryAttempts.retry(attemptId)
      const page = await getTaskLogsViaApi(window.platform, agent.id, selectedTaskId, refreshQuery)
      const refreshedRun = page.logs.find((log) => log.id === runLogId)
      if (!refreshedRun) return
      setLoadState((current) => {
        const merged = mergeTaskDeliveryRun(current.logsByTaskId[selectedTaskId] ?? [], refreshedRun)
        return {
          ...current,
          logsByTaskId: { ...current.logsByTaskId, [selectedTaskId]: merged.logs }
        }
      })
      setSelectedRunLogId(runLogId)
    } catch {
      setError(t.taskCenter.retryDeliveryFailed)
    } finally {
      setSaving(false)
    }
  }
  async function openRunSession(sessionId: string): Promise<void> {
    const nextState = await selectSessionViaApi(window.platform, sessionId)
    onStateChange(() => nextState)
    onClose()
  }
  function startCreate(): void {
    setSelectedTaskId(null)
    setDraft(buildDefaultAgentTaskDraft(workspace))
    setError(null)
  }

  return (
    <Drawer
      open={open}
      width={980}
      title={t.taskCenter.title}
      onClose={onClose}
      className="agent-task-center-drawer"
      extra={
        <div className="agent-task-center-actions">
          <Button className="ant-secondary-button" size="small" icon={<RefreshCw size={14} />} onClick={() => void refresh()}>
            {t.taskCenter.refresh}
          </Button>
          <Button className="ant-primary-button" size="small" icon={<Plus size={14} />} onClick={startCreate}>
            {t.taskCenter.newTask}
          </Button>
        </div>
      }>
      <div className="agent-task-center">
        <aside className="agent-task-list-pane">
          <header>
            <strong>{t.taskCenter.taskList}</strong>
            <small>{t.taskCenter.taskCount(centerState.items.length)}</small>
          </header>
          {loading && centerState.items.length === 0 ? <LoadingState label={t.taskCenter.loading} minHeight={120} /> : null}
          {!loading && centerState.items.length === 0 ? <div className="agent-task-empty">{t.taskCenter.empty}</div> : null}
          <div className="agent-task-list">
            {centerState.items.map((item) => (
              <button
                key={item.task.id}
                type="button"
                className={item.task.id === centerState.selectedTaskId ? 'agent-task-list-item active' : 'agent-task-list-item'}
                onClick={() => {
                  setSelectedTaskId(item.task.id)
                }}>
                <span className={`agent-task-status-dot ${item.runtimeStatus}`} />
                <span>
                  <strong>{item.task.name}</strong>
                  <small>{item.triggerLabel}</small>
                </span>
                {item.task.status === 'paused' ? <Tag className="agent-task-tag">{t.taskCenter.paused}</Tag> : null}
                {item.task.status === 'completed' ? <Tag className="agent-task-tag">{t.taskCenter.status.completed}</Tag> : null}
                {item.isOverdue ? <Tag className="agent-task-tag">{t.taskCenter.overdue}</Tag> : null}
              </button>
            ))}
          </div>
        </aside>

        <main className="agent-task-detail-pane">
          {error ? <div className="agent-task-error">{error}</div> : null}
          <AgentTaskDraftForm
            draft={draft}
            workspaces={state.workspaces}
            saving={saving}
            editing={Boolean(selectedTaskId)}
            disabled={selectedTask?.status === 'completed'}
            schedulePreview={schedulePreview}
            labels={t.taskCenter}
            onDraftChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
            onSave={() => void saveTask()}
            onCancelCreate={startCreate}
          />
          {selectedTask ? (
            <>
              <AgentTaskRunSection
              item={selectedItem}
              logs={centerState.selectedLogs}
              jobsByRunLogId={loadState.jobsByRunLogId}
              labels={t.taskCenter}
              saving={saving}
              selectedRunLogId={deliveryAttemptRequest?.runLogId ?? null}
              attempts={deliveryAttempts.attempts}
              attemptsTotal={deliveryAttempts.total}
              onLoadMoreAttempts={() => void deliveryAttempts.loadMore()}
              onSelectRun={setSelectedRunLogId}
              onRetryDelivery={(attemptId) => void retryDelivery(attemptId)}
              onOpenSession={(sessionId) => void openRunSession(sessionId)}
              onRun={() => void runTask(selectedTask)}
              onCancel={(runLogId) => void cancelRunningTask(runLogId)}
              onDelete={() => void deleteTask(selectedTask)}
              />
              {selectedTask.status === 'paused' ? (
                <div className="agent-task-state-note">
                  {selectedTask.pauseReason === 'failure-circuit' ? t.taskCenter.pauseReasonFailureCircuit : t.taskCenter.pauseReasonUser}
                </div>
              ) : null}
              {selectedTask.status === 'completed' ? <div className="agent-task-state-note">{t.taskCenter.completedTask}</div> : null}
              {(loadState.logsByTaskId[selectedTask.id]?.length ?? 0) < (loadState.logsTotalByTaskId[selectedTask.id] ?? 0) ? (
                <Button className="ant-secondary-button" size="small" onClick={() => void loadMoreRuns()}>
                  {t.taskCenter.loadMoreRuns}
                </Button>
              ) : null}
            </>
          ) : null}
        </main>
      </div>
    </Drawer>
  )
}
