import { Button, Input, Select } from 'antd'
import { RefreshCw, Search } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { JobScheduleView } from '@platform/jobs'
import type { AppLanguage } from '@platform/settings/schema/appSettings'

import { formatJobSchedule, formatTimestamp, type TaskAutomationLabels } from './taskAutomationFormat'
import { BlockEmpty, BlockError, BlockLoading } from './TaskAutomationBlockParts'
import {
  buildResourceJobSourceOptions,
  buildResourceJobSourceSelectOptions,
  filterResourceJobs,
  type ResourceJobRegistrationFilter,
  type ResourceJobSourceFilter
} from './resourceJobFilters'
import {
  clampPage,
  DEFAULT_RESOURCE_JOB_PAGE_SIZE,
  pageCount,
  RESOURCE_JOB_PAGE_SIZES,
  slicePage
} from './resourceJobPagination'
import {
  TASK_AUTOMATION_CONTROL_CLASSES,
  TASK_AUTOMATION_SOURCE_POPUP_PROPS
} from './taskAutomationControlWidths'
import type { ResourceJobSchedulesController, ResourceJobSchedulesErrorReason } from './useResourceJobSchedules'

export function TaskAutomationResourceJobsSection(props: {
  labels: TaskAutomationLabels
  language: AppLanguage
  controller: ResourceJobSchedulesController
}): React.ReactElement {
  const { controller, labels, language } = props
  const [nameQuery, setNameQuery] = useState('')
  const [source, setSource] = useState<ResourceJobSourceFilter>('all')
  const [registration, setRegistration] = useState<ResourceJobRegistrationFilter>('all')
  const [pageSize, setPageSize] = useState<number>(DEFAULT_RESOURCE_JOB_PAGE_SIZE)
  const [page, setPage] = useState(1)

  // 重新读取投影成功后回到第 1 页（items 引用只在成功/刷新时变化）。
  useEffect(() => {
    setPage(1)
  }, [controller.items])

  const sourceOptions = buildResourceJobSourceSelectOptions(
    buildResourceJobSourceOptions(controller.items),
    labels,
    controller.productNames
  )
  const matched = filterResourceJobs(controller.items, { nameQuery, source, registration })
  const pages = pageCount(matched.length, pageSize)
  const currentPage = clampPage(page, matched.length, pageSize)
  const visibleItems = slicePage(matched, page, pageSize)
  const clearFilters = (): void => {
    setNameQuery('')
    setSource('all')
    setRegistration('all')
    setPage(1)
  }

  return (
    <section className="task-automation-block" aria-busy={controller.loading}>
      <header className="task-automation-block-header">
        <h2>{labels.resourceJobs}</h2>
        <div className="task-automation-block-tools">
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
        <BlockLoading label={labels.resourceLoading} />
      ) : controller.error ? (
        <div className="task-automation-block-body">
          <BlockError
            label={resourceErrorLabel(controller.errorReason, labels)}
            retryLabel={labels.retry}
            onRetry={() => void controller.reload()}
          />
        </div>
      ) : controller.items.length === 0 ? (
        <BlockEmpty title={labels.resourceEmptyTitle} body={labels.resourceEmptyBody} />
      ) : (
        <>
          <div className="task-automation-filters">
            <Input
              size="small"
              allowClear
              className={TASK_AUTOMATION_CONTROL_CLASSES.name}
              prefix={<Search size={13} aria-hidden="true" />}
              placeholder={labels.searchTasks}
              aria-label={labels.searchTasks}
              value={nameQuery}
              onChange={(event) => {
                setNameQuery(event.target.value)
                setPage(1)
              }}
            />
            <Select
              size="small"
              aria-label={labels.columns.source}
              className={TASK_AUTOMATION_CONTROL_CLASSES.source}
              {...TASK_AUTOMATION_SOURCE_POPUP_PROPS}
              value={source}
              onChange={(value: ResourceJobSourceFilter) => {
                setSource(value)
                setPage(1)
              }}
              options={sourceOptions}
            />
            <Select
              size="small"
              aria-label={labels.columns.registration}
              className={TASK_AUTOMATION_CONTROL_CLASSES.registration}
              value={registration}
              onChange={(value: ResourceJobRegistrationFilter) => {
                setRegistration(value)
                setPage(1)
              }}
              options={[
                { value: 'all', label: labels.allStatuses },
                { value: 'registered', label: labels.registered },
                { value: 'unregistered', label: labels.notRegistered }
              ]}
            />
            <span className="task-automation-count task-automation-mono">
              {labels.resourceCountWithPage(controller.items.length, matched.length, currentPage, pages)}
            </span>
          </div>
          {matched.length === 0 ? (
            <BlockEmpty body={labels.filterEmpty} actionLabel={labels.clearFilters} onAction={clearFilters} />
          ) : (
            <>
              <table className="task-automation-table">
                <thead>
                  <tr>
                    <th>{labels.columns.name}</th>
                    <th>{labels.columns.source}</th>
                    <th>{labels.columns.schedule}</th>
                    <th>{labels.columns.registration}</th>
                    <th>{labels.columns.nextRun}</th>
                    <th>{labels.columns.lastRun}</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((job) => (
                    <tr
                      key={job.id}
                      className={`task-automation-row${job.registered ? '' : ' task-automation-row-unregistered'}`}
                    >
                      <td title={job.title}>
                        <span className="task-automation-name">{job.title}</span>
                      </td>
                      <td>{sourceLabel(job, controller.productNames, labels)}</td>
                      <td className="task-automation-mono">{formatJobSchedule(job.trigger, labels, language)}</td>
                      <td>
                        <span className={`task-automation-tag ${job.registered ? 'task-automation-tag-ok' : 'task-automation-tag-off'}`}>
                          {job.registered ? labels.registered : labels.notRegistered}
                        </span>
                      </td>
                      <td className="task-automation-mono">
                        {formatTimestamp(job.nextRunAt, language) ?? labels.emptyValue}
                      </td>
                      <td>
                        <JobLastRun job={job} labels={labels} language={language} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="task-automation-pagination">
                <span className="task-automation-pagination-size">
                  <span>{labels.resourcePageSize}</span>
                  <Select
                    size="small"
                    aria-label={labels.resourcePageSize}
                    value={pageSize}
                    onChange={(value: number) => {
                      setPageSize(value)
                      setPage(1)
                    }}
                    options={RESOURCE_JOB_PAGE_SIZES.map((size) => ({ value: size, label: String(size) }))}
                  />
                </span>
                <span className="task-automation-mono task-automation-pagination-status">
                  {labels.resourcePageIndicator(currentPage, pages)}
                </span>
                <Button
                  size="small"
                  aria-label={labels.resourcePrevPage}
                  disabled={currentPage <= 1}
                  onClick={() => setPage(Math.max(1, currentPage - 1))}
                >
                  {labels.resourcePrevPage}
                </Button>
                <Button
                  size="small"
                  aria-label={labels.resourceNextPage}
                  disabled={currentPage >= pages}
                  onClick={() => setPage(Math.min(pages, currentPage + 1))}
                >
                  {labels.resourceNextPage}
                </Button>
              </div>
            </>
          )}
          <div className="task-automation-block-body">
            <p className="task-automation-note">{labels.resourceNote}</p>
          </div>
        </>
      )}
    </section>
  )
}

function JobLastRun(props: {
  job: JobScheduleView
  labels: TaskAutomationLabels
  language: AppLanguage
}): React.ReactElement {
  const { job, labels, language } = props
  if (job.lastOutcome === 'never' && !job.lastRunAt) {
    return <span className="task-automation-muted">{labels.outcome.never}</span>
  }
  const at = formatTimestamp(job.lastRunAt, language)
  return (
    <>
      <span className={`task-automation-tag ${outcomeTone(job.lastOutcome)}`}>
        {labels.outcome[job.lastOutcome]}
      </span>
      {at ? <span className="task-automation-mono task-automation-muted"> {at}</span> : null}
    </>
  )
}

function sourceLabel(
  job: JobScheduleView,
  productNames: Record<string, string>,
  labels: TaskAutomationLabels
): string {
  if (job.owner === 'platform') return labels.platform
  return productNames[job.productId ?? ''] ?? job.productId ?? labels.product
}

/** error 态必须给出一行可读原因：读取失败 / 缺少接口（多为未重启）/ 超时。 */
function resourceErrorLabel(
  reason: ResourceJobSchedulesErrorReason | null,
  labels: TaskAutomationLabels
): string {
  if (reason === 'bridge-missing') return labels.resourceBridgeMissing
  if (reason === 'timeout') return labels.resourceLoadTimeout
  return labels.resourceLoadFailed
}

function outcomeTone(outcome: JobScheduleView['lastOutcome']): string {
  if (outcome === 'success') return 'task-automation-tag-ok'
  if (outcome === 'failed') return 'task-automation-tag-bad'
  return 'task-automation-tag-off'
}
