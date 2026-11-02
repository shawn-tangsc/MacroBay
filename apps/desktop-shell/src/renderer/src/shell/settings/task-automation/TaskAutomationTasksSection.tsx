import { Button, Input, Select } from 'antd'
import { RefreshCw, Search } from 'lucide-react'
import { Fragment } from 'react'

import type { ScheduledTaskEntity, TaskRunLogEntity } from '@platform/ai/agent-platform/schemas/taskSchemas'
import type { TaskMutationAuditEntity } from '@platform/ai/agent-platform/runtime/tasks/taskAutomationContracts'
import type { AppLanguage } from '@platform/settings/schema/appSettings'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { StatusPill } from '@platform/ui/components/status-pill'

import { formatTaskSchedule, formatTimestamp, type TaskAutomationLabels } from './taskAutomationFormat'
import { BlockLoading } from './TaskAutomationBlockParts'
import { TASK_AUTOMATION_CONTROL_CLASSES } from './taskAutomationControlWidths'
import {
  AUDIT_OUTCOME_PILL,
  RUN_OUTCOME_PILL,
  TASK_STATUS_PILL,
  pillTextResolver
} from './taskAutomationStatusPills'
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
  const pillText = pillTextResolver(labels)

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
          <StateView
            state="error"
            reasonCode="unreadable"
            size="md"
            action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: () => void controller.reload() }}
          />
        </div>
      ) : state.rows.length > 0 ? (
        // Rendering is decided by "are there rows to render", never by the empty-state verdict:
        // a wrong verdict must degrade to a wrong sentence, not to an invisible table.
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
                      <StatusPill
                        tone={TASK_STATUS_PILL[row.task.status].tone}
                        labelKey={TASK_STATUS_PILL[row.task.status].labelKey}
                        resolveText={pillText}
                      />
                    </td>
                    <td className="task-automation-mono">
                      {formatTaskSchedule(row.task.trigger, labels, language)}
                    </td>
                    <td className="task-automation-mono">
                      {formatTimestamp(row.task.nextRun ?? null, language) ?? labels.emptyValue}
                    </td>
                    <td>
                      <LastRun
                        task={row.task}
                        snapshot={row.lastRun}
                        unreadable={row.runUnreadable}
                        labels={labels}
                        language={language}
                      />
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
                              unreadable={row.runUnreadable}
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
      ) : state.emptyState === 'filter-empty' ? (
        // 有数据、被筛选挡住：状态与动作都归 `StateView`（`filtered-out` 必带「清除筛选」）。
        <StateView
          state="empty"
          reasonCode="filtered-out"
          size="md"
          action={{ labelKey: STATE_VIEW_ACTION_KEYS.clear_filter, onSelect: controller.clearFilters }}
        />
      ) : (
        // 一条任务都没有过。创建入口在对话里，这一屏拿不到可点的「新建」，
        // 所以按契约 §13：给 `not-yet`、不给动作——不放一个点了没反应的按钮。
        <StateView state="empty" reasonCode="not-yet" size="md" />
      )}
      {!controller.loading && !controller.error && state.rows.length > 0 && controller.hasMore ? (
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
  /** The latest run exists but could not be read: say so, do not claim the task never ran. */
  unreadable: boolean
  labels: TaskAutomationLabels
  language: AppLanguage
}): React.ReactElement {
  const { labels, language, snapshot, unreadable } = props
  const pillText = pillTextResolver(labels)
  if (unreadable) return <span className="task-automation-muted">{labels.runUnreadable}</span>
  if (!snapshot) return <span className="task-automation-muted">{labels.outcome.never}</span>
  const at = formatTimestamp(snapshot.at, language)
  const outcome = outcomeFromRunStatus(snapshot.status)
  if (!outcome) return <span className="task-automation-muted">{at ?? labels.emptyValue}</span>
  return (
    <>
      <StatusPill
        tone={RUN_OUTCOME_PILL[outcome].tone}
        labelKey={RUN_OUTCOME_PILL[outcome].labelKey}
        resolveText={pillText}
      />
      {at ? <span className="task-automation-mono task-automation-muted"> {at}</span> : null}
      {snapshot.skipReasons.length > 0 ? (
        // Why it was skipped, in words: each reason leads to a different action, so a bare "skipped"
        // would leave the reader guessing which one applies.
        <span className="task-automation-note">
          {snapshot.skipReasons.map((reason) => labels.deliverySkipReason[reason]).join(' / ')}
        </span>
      ) : null}
      {snapshot.unexplainedSkips > 0 ? (
        <span className="task-automation-note task-automation-tag-bad">
          {labels.deliverySkipReasonUnrecorded(snapshot.unexplainedSkips)}
        </span>
      ) : null}
    </>
  )
}

function TaskHealth(props: {
  labels: TaskAutomationLabels
  language: AppLanguage
  task: ScheduledTaskEntity
  health: DeliveryHealthCounts
  /** The run history could not be read: show that, never a row of zeros that reads as "nothing happened". */
  unreadable: boolean
}): React.ReactElement {
  const { health, labels, language } = props
  if (props.unreadable) {
    return (
      <dl className="task-automation-kv">
        <dt>{labels.columns.lastResult}</dt>
        <dd className="task-automation-muted">{labels.runUnreadable}</dd>
        <dt>{labels.columns.nextRun}</dt>
        <dd className="task-automation-mono">
          {formatTimestamp(props.task.nextRun ?? null, language) ?? labels.emptyValue}
        </dd>
      </dl>
    )
  }
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
  const pillText = pillTextResolver(labels)
  if (audits.length === 0) return <p className="task-automation-note">{labels.noChanges}</p>
  return (
    <ul className="task-automation-audit">
      {audits.slice(0, 5).map((audit) => (
        <li key={audit.id}>
          <StatusPill
            tone={AUDIT_OUTCOME_PILL[audit.outcome].tone}
            labelKey={AUDIT_OUTCOME_PILL[audit.outcome].labelKey}
            resolveText={pillText}
          />
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
