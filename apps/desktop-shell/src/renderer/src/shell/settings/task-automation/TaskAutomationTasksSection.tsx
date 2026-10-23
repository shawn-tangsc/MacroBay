import { Button, Input, Select } from 'antd'
import { RefreshCw, Search } from 'lucide-react'
import { Fragment } from 'react'

import type { ScheduledTaskEntity, TaskRunLogEntity } from '@platform/ai/agent-platform/schemas/taskSchemas'
import type { TaskMutationAuditEntity } from '@platform/ai/agent-platform/runtime/tasks/taskAutomationContracts'
import type { AppLanguage } from '@platform/settings/schema/appSettings'

import { formatTaskSchedule, formatTimestamp, type TaskAutomationLabels } from './taskAutomationFormat'
import { BlockEmpty, BlockError, BlockLoading } from './TaskAutomationBlockParts'
import { TASK_AUTOMATION_CONTROL_CLASSES } from './taskAutomationControlWidths'
import type {
  DeliveryHealthCounts,
  TaskAutomationStatusFilter,
  TaskRunSnapshot
} from './taskAutomationSettingsViewModel'
import type { TaskAutomationSettingsController } from './useTaskAutomationSettings'

type OutcomeKey = 'success' | 'failed' | 'skipped'

export function TaskAutomationTasksSection(props: {
  labels: TaskAutomationLabels
  language: AppLanguage
  controller: TaskAutomationSettingsController
}): React.ReactElement {
  const { labels, language, controller } = props
  const { state } = controller

  return (
    <section className="task-automation-block" aria-busy={controller.loading}>
      <header className="task-automation-block-header">
        <h2>{labels.myTasks}</h2>
        <div className="task-automation-block-tools">
          <Input
            size="small"
            allowClear
            className={TASK_AUTOMATION_CONTROL_CLASSES.name}
            prefix={<Search size={13} aria-hidden="true" />}
            placeholder={labels.searchTasks}
            aria-label={labels.searchTasks}
            value={controller.nameQuery}
            onChange={(event) => controller.setNameQuery(event.target.value)}
          />
          <Select
            size="small"
            aria-label={labels.columns.status}
            className={TASK_AUTOMATION_CONTROL_CLASSES.status}
            value={controller.status}
            onChange={(value: TaskAutomationStatusFilter) => controller.setStatus(value)}
            options={[
              { value: 'all', label: labels.all },
              { value: 'active', label: labels.status.active },
              { value: 'paused', label: labels.status.paused },
              { value: 'completed', label: labels.status.completed }
            ]}
          />
          <Button
            size="small"
            icon={<RefreshCw size={14} aria-hidden="true" />}
            onClick={() => void controller.reload()}
          >
            {labels.refresh}
          </Button>
        </div>
      </header>
      {controller.loading ? (
        <BlockLoading label={labels.tasksLoading} />
      ) : controller.error ? (
        <div className="task-automation-block-body">
          <BlockError label={labels.tasksLoadFailed} retryLabel={labels.retry} onRetry={() => void controller.reload()} />
        </div>
      ) : state.emptyState === 'never-created' ? (
        <BlockEmpty title={labels.emptyTasksTitle} body={labels.emptyTasksBody} />
      ) : state.emptyState === 'filter-empty' ? (
        <BlockEmpty
          body={labels.filterEmpty}
          actionLabel={labels.clearFilters}
          onAction={controller.clearFilters}
        />
      ) : (
        <table className="task-automation-table">
          <thead>
            <tr>
              <th>{labels.columns.name}</th>
              <th>{labels.columns.status}</th>
              <th>{labels.columns.schedule}</th>
              <th>{labels.columns.nextRun}</th>
              <th>{labels.columns.lastResult}</th>
              <th className="task-automation-col-actions">{labels.columns.actions}</th>
            </tr>
          </thead>
          <tbody>
            {state.rows.map((row) => {
              const expanded = state.expandedTaskId === row.task.id
              return (
                <Fragment key={row.task.id}>
                  <tr
                    className={`task-automation-row${expanded ? ' task-automation-row-expanded' : ''}`}
                    onClick={() => controller.toggleTaskExpanded(row.task.id)}
                  >
                    <td title={row.task.name}>
                      <span className="task-automation-name">{row.task.name}</span>
                    </td>
                    <td>
                      <span className={`task-automation-tag ${statusTone(row.task.status)}`}>
                        {labels.status[row.task.status]}
                      </span>
                    </td>
                    <td className="task-automation-mono">
                      {formatTaskSchedule(row.task.trigger, labels, language)}
                    </td>
                    <td className="task-automation-mono">
                      {formatTimestamp(row.task.nextRun ?? null, language) ?? labels.emptyValue}
                    </td>
                    <td>
                      <LastRun task={row.task} snapshot={row.lastRun} labels={labels} language={language} />
                    </td>
                    <td className="task-automation-col-actions">
                      <Button
                        size="small"
                        aria-expanded={expanded}
                        onClick={(event) => {
                          event.stopPropagation()
                          controller.toggleTaskExpanded(row.task.id)
                        }}
                      >
                        {expanded ? labels.collapse : labels.details}
                      </Button>
                    </td>
                  </tr>
                  {expanded ? (
                    <tr className="task-automation-detail-row">
                      <td colSpan={6}>
                        <div className="task-automation-detail-grid">
                          <div>
                            <h4>{labels.taskDeliveryHealth}</h4>
                            <TaskHealth
                              labels={labels}
                              language={language}
                              task={row.task}
                              health={controller.state.deliveryHealth}
                            />
                          </div>
                          <div>
                            <h4>{labels.recentChanges}</h4>
                            <AuditList labels={labels} language={language} audits={controller.audits} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      )}
      {!controller.loading && !controller.error && state.emptyState === 'none' && controller.hasMore ? (
        <div className="task-automation-block-footer">
          <Button size="small" onClick={() => void controller.loadMore()}>
            {labels.loadMore}
          </Button>
        </div>
      ) : null}
    </section>
  )
}

function LastRun(props: {
  task: ScheduledTaskEntity
  snapshot: TaskRunSnapshot | null
  labels: TaskAutomationLabels
  language: AppLanguage
}): React.ReactElement {
  const { labels, language, snapshot } = props
  if (!snapshot) return <span className="task-automation-muted">{labels.outcome.never}</span>
  const at = formatTimestamp(snapshot.at, language)
  const outcome = outcomeFromRunStatus(snapshot.status)
  if (!outcome) return <span className="task-automation-muted">{at ?? labels.emptyValue}</span>
  return (
    <>
      <span className={`task-automation-tag ${outcomeTone(outcome)}`}>{labels.outcome[outcome]}</span>
      {at ? <span className="task-automation-mono task-automation-muted"> {at}</span> : null}
    </>
  )
}

function TaskHealth(props: {
  labels: TaskAutomationLabels
  language: AppLanguage
  task: ScheduledTaskEntity
  health: DeliveryHealthCounts
}): React.ReactElement {
  const { health, labels, language } = props
  return (
    <dl className="task-automation-kv">
      <dt>{labels.delivered}</dt>
      <dd className="task-automation-mono">{health.delivered}</dd>
      <dt>{labels.failed}</dt>
      <dd className="task-automation-mono">{health.failed}</dd>
      <dt>{labels.pending}</dt>
      <dd className="task-automation-mono">{health.pending}</dd>
      <dt>{labels.skipped}</dt>
      <dd className="task-automation-mono">{health.skipped}</dd>
      <dt>{labels.unknown}</dt>
      <dd className="task-automation-mono">{health.unknown}</dd>
      <dt>{labels.columns.nextRun}</dt>
      <dd className="task-automation-mono">
        {formatTimestamp(props.task.nextRun ?? null, language) ?? labels.emptyValue}
      </dd>
    </dl>
  )
}

function AuditList(props: {
  labels: TaskAutomationLabels
  language: AppLanguage
  audits: TaskMutationAuditEntity[]
}): React.ReactElement {
  const { audits, labels, language } = props
  if (audits.length === 0) return <p className="task-automation-note">{labels.noChanges}</p>
  return (
    <ul className="task-automation-audit">
      {audits.slice(0, 5).map((audit) => (
        <li key={audit.id}>
          <span className={`task-automation-tag ${audit.outcome === 'accepted' ? 'task-automation-tag-ok' : 'task-automation-tag-off'}`}>
            {audit.outcome === 'accepted' ? labels.auditAccepted : labels.auditRejected}
          </span>
          <span>{labels.auditAction[audit.action] ?? audit.action}</span>
          <span className="task-automation-mono task-automation-muted">
            {formatTimestamp(audit.createdAt, language) ?? labels.emptyValue}
          </span>
        </li>
      ))}
    </ul>
  )
}

function outcomeFromRunStatus(status: TaskRunLogEntity['status']): OutcomeKey | null {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled' || status === 'skipped') return 'skipped'
  return null
}

function outcomeTone(outcome: OutcomeKey): string {
  if (outcome === 'success') return 'task-automation-tag-ok'
  if (outcome === 'failed') return 'task-automation-tag-bad'
  return 'task-automation-tag-off'
}

function statusTone(status: ScheduledTaskEntity['status']): string {
  if (status === 'active') return 'task-automation-tag-ok'
  if (status === 'paused') return 'task-automation-tag-off'
  return ''
}
