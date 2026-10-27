import type { AppLanguage } from '@platform/settings/schema/appSettings'
import { LoadingState } from '@platform/ui/components/loading'

import { formatTimestamp, type TaskAutomationLabels } from './taskAutomationFormat'
import { BlockError } from './TaskAutomationBlockParts'
import type { DeliveryHealthCounts } from './taskAutomationSettingsViewModel'
import type { ResourceJobRunSummary } from './resourceJobRunSummary'

export function TaskAutomationHealthSection(props: {
  labels: TaskAutomationLabels
  language: AppLanguage
  loading: boolean
  error: boolean
  health: DeliveryHealthCounts
  latestRunAt: string | null
  /** 资源任务（`@platform/jobs`）最近一次运行，另一套口径，单独统计、不合并。 */
  resourceRuns: ResourceJobRunSummary
  resourceLoading: boolean
  onRetry: () => void
}): React.ReactElement {
  const { health, labels, language } = props
  const updatedAt = formatTimestamp(props.latestRunAt, language) ?? labels.emptyValue
  const resourceUpdatedAt = formatTimestamp(props.resourceRuns.latestRunAt, language) ?? labels.emptyValue
  const isEmpty = health.delivered + health.failed + health.pending + health.skipped + health.unknown === 0

  return (
    <section className="task-automation-block" aria-busy={props.loading || props.resourceLoading}>
      <header className="task-automation-block-header">
        <h2>{labels.deliveryHealth}</h2>
      </header>
      <div className="task-automation-block-body">
        <div className="task-automation-health-group">
          <div className="task-automation-health-group-header">
            <h3>{labels.scheduledTaskDelivery}</h3>
            <span className="task-automation-mono task-automation-muted">{labels.healthUpdated(updatedAt)}</span>
          </div>
          {props.error ? (
            <BlockError label={labels.tasksLoadFailed} retryLabel={labels.retry} onRetry={props.onRetry} />
          ) : (
            <>
              <dl className="task-automation-health">
                <HealthItem label={labels.delivered} value={health.delivered} />
                <HealthItem label={labels.failed} value={health.failed} tone="bad" />
                <HealthItem label={labels.pending} value={health.pending} />
                <HealthItem label={labels.skipped} value={health.skipped} />
                <HealthItem label={labels.unknown} value={health.unknown} />
              </dl>
              {props.loading ? <LoadingState layout="inline" size="sm" label={labels.tasksLoading} /> : null}
              {!props.loading && isEmpty ? <p className="task-automation-note">{labels.healthEmpty}</p> : null}
            </>
          )}
        </div>
        <div className="task-automation-health-group">
          <div className="task-automation-health-group-header">
            <h3>{labels.resourceJobRuns}</h3>
            <span className="task-automation-mono task-automation-muted">
              {labels.healthUpdated(resourceUpdatedAt)}
            </span>
          </div>
          {props.resourceLoading ? (
            <LoadingState layout="inline" size="sm" label={labels.resourceLoading} />
          ) : props.resourceRuns.total === 0 ? (
            <p className="task-automation-note">{labels.resourceJobRunsEmpty}</p>
          ) : (
            <dl className="task-automation-health">
              <HealthItem label={labels.outcome.success} value={props.resourceRuns.succeeded} />
              <HealthItem label={labels.outcome.failed} value={props.resourceRuns.failed} tone="bad" />
              <HealthItem label={labels.outcome.skipped} value={props.resourceRuns.skipped} />
              <HealthItem label={labels.outcome.never} value={props.resourceRuns.never} />
            </dl>
          )}
        </div>
        <p className="task-automation-note">{labels.healthScopeNote}</p>
      </div>
    </section>
  )
}

function HealthItem(props: { label: string; value: number; tone?: 'bad' }): React.ReactElement {
  return (
    <div className="task-automation-health-item">
      <dt>{props.label}</dt>
      <dd className={`task-automation-mono${props.tone === 'bad' && props.value > 0 ? ' task-automation-value-bad' : ''}`}>
        {props.value}
      </dd>
    </div>
  )
}
