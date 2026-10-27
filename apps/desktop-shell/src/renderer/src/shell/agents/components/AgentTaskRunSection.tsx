import { Button, Tag } from 'antd'
import { Check, Play, SkipForward, Square, Trash2, X } from 'lucide-react'

import type { TaskDeliveryAttemptEntity, TaskRunLogEntity } from '@platform/ai/agent-platform/schemas/taskSchemas'
import type { JobRunRecord } from '@platform/jobs'
import { LoadingSpinner } from '@platform/ui/components/loading'

import type { AgentText } from '../agentText'
import type { AgentTaskCenterItem } from '../agentTaskCenterViewModel'
import { formatDateTime } from '../agentTaskCenterViewModel'

type AgentTaskRunSectionProps = {
  item: AgentTaskCenterItem | null
  logs: TaskRunLogEntity[]
  jobsByRunLogId: Record<string, JobRunRecord | null>
  labels: AgentText['taskCenter']
  saving: boolean
  selectedRunLogId: string | null
  attempts: TaskDeliveryAttemptEntity[]
  attemptsTotal: number
  onLoadMoreAttempts: () => void
  onSelectRun: (runLogId: string) => void
  onRetryDelivery: (attemptId: string) => void
  onOpenSession: (sessionId: string) => void
  onRun: () => void
  onCancel: (runLogId: string) => void
  onDelete: () => void
}

export default function AgentTaskRunSection({
  item,
  logs,
  jobsByRunLogId,
  labels,
  saving,
  selectedRunLogId,
  attempts,
  attemptsTotal,
  onLoadMoreAttempts,
  onSelectRun,
  onRetryDelivery,
  onOpenSession,
  onRun,
  onCancel,
  onDelete
}: AgentTaskRunSectionProps): React.ReactElement {
  const activeRunLogId = logs.find((log) => log.status === 'queued' || log.status === 'running')?.id ?? null
  return (
    <section className="agent-task-runs">
      <header>
        <span>
          <strong>{labels.runLogs}</strong>
          <small>{item?.latestOutput ?? labels.noRunOutput}</small>
        </span>
        <div className="agent-task-form-actions">
          {activeRunLogId ? (
            <Button className="ant-secondary-button" size="small" loading={saving} icon={<Square size={14} />} onClick={() => onCancel(activeRunLogId)}>
              {labels.cancelRun}
            </Button>
          ) : (
            <Button className="ant-secondary-button" size="small" loading={saving} disabled={item?.task.status === 'completed'} icon={<Play size={14} />} onClick={onRun}>
              {labels.runNow}
            </Button>
          )}
          <Button danger className="ant-secondary-button" size="small" icon={<Trash2 size={14} />} onClick={onDelete}>
            {labels.deleteTask}
          </Button>
        </div>
      </header>
      {logs.length === 0 ? <div className="agent-task-empty">{labels.noLogs}</div> : null}
      <div className="agent-task-run-list">
        {logs.map((log) => {
          const job = jobsByRunLogId[log.id] ?? null
          return (
            <article key={log.id} className="agent-task-run-card">
              <header>
                <span className={`agent-task-run-status ${log.status}`}>{statusIcon(log.status)}</span>
                <span>
                  <strong>{labels.status[log.status]}</strong>
                  <small>{formatDateTime(log.startedAt)}</small>
                </span>
                {job ? <Tag className="agent-task-tag">{labels.jobStatus[job.status]}</Tag> : null}
              </header>
              <p>{job?.progress?.message || log.resultPreview || log.result || log.error || labels.noRunOutput}</p>
              {log.deliverySummary ? (
                <small className="agent-task-delivery-summary">
                  {labels.deliverySummary(
                    log.deliverySummary.delivered,
                    log.deliverySummary.failed,
                    log.deliverySummary.skipped,
                    log.deliverySummary.unknown
                  )}
                </small>
              ) : null}
              {log.sessionId ? (
                <Button className="ant-secondary-button" size="small" onClick={() => onOpenSession(log.sessionId!)}>
                  {labels.openSession}
                </Button>
              ) : null}
              <Button
                className="ant-secondary-button"
                size="small"
                type="text"
                aria-pressed={log.id === selectedRunLogId}
                onClick={() => onSelectRun(log.id)}>
                {labels.deliveryAttempts}
              </Button>
              {job?.logs.length ? (
                <div className="agent-task-job-log">
                  {job.logs.slice(0, 4).map((entry) => (
                    <code key={`${entry.at}:${entry.message}`}>
                      {labels.jobLogEntry(formatDateTime(entry.at), labels.jobLogLevel[entry.level], entry.message)}
                    </code>
                  ))}
                </div>
              ) : null}
            </article>
          )
        })}
      </div>
      <section className="agent-task-delivery-attempts">
        <header>
          <strong>{labels.deliveryAttempts}</strong>
          {attempts.length < attemptsTotal ? (
            <Button className="ant-secondary-button" size="small" onClick={onLoadMoreAttempts}>
              {labels.loadMoreDeliveryAttempts}
            </Button>
          ) : null}
        </header>
        {attempts.length === 0 ? <div className="agent-task-empty">{labels.noDeliveryAttempts}</div> : null}
        <div className="agent-task-attempt-list">
          {attempts.map((attempt) => (
            <article key={attempt.id} className="agent-task-attempt-row">
              <span>
                <strong>{labels.deliveryAttempt(attempt.channelId, attempt.attemptNumber)}</strong>
                <small>{labels.deliveryStatus[attempt.status]}</small>
              </span>
              {attempt.status !== 'pending' && attempt.status !== 'delivered' ? (
                <Button className="ant-secondary-button" size="small" loading={saving} onClick={() => onRetryDelivery(attempt.id)}>
                  {labels.retryDelivery}
                </Button>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </section>
  )
}

function statusIcon(status: TaskRunLogEntity['status']): React.ReactNode {
  if (status === 'queued' || status === 'running') return <LoadingSpinner size="sm" />
  if (status === 'completed') return <Check size={13} />
  if (status === 'cancelled') return <Square size={13} />
  if (status === 'skipped') return <SkipForward size={13} />
  return <X size={13} />
}
