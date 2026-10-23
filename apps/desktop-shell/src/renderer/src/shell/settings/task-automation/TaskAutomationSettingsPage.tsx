import { Button } from 'antd'
import { RefreshCw } from 'lucide-react'

import type { AppLanguage } from '@platform/settings/schema/appSettings'

import { platformText } from '../../../i18n/platformText'
import { TaskAutomationHealthSection } from './TaskAutomationHealthSection'
import { TaskAutomationPolicySection } from './TaskAutomationPolicySection'
import { TaskAutomationResourceJobsSection } from './TaskAutomationResourceJobsSection'
import { TaskAutomationTasksSection } from './TaskAutomationTasksSection'
import { summarizeResourceJobRuns } from './resourceJobRunSummary'
import { useResourceJobSchedules } from './useResourceJobSchedules'
import { useTaskAutomationSettings } from './useTaskAutomationSettings'

export function TaskAutomationSettingsPage({ language }: { language: AppLanguage }): React.ReactElement {
  const labels = platformText[language].taskAutomation
  const settings = useTaskAutomationSettings()
  const jobs = useResourceJobSchedules({ language })
  const resourceRuns = summarizeResourceJobRuns(jobs.items)

  async function refreshAll(): Promise<void> {
    await Promise.all([settings.reload(), jobs.reload()])
  }

  return (
    <section className="settings-workspace task-automation-settings">
      <header className="task-automation-page-header">
        <div>
          <strong>{labels.title}</strong>
          <span>{labels.subtitle}</span>
        </div>
        <Button size="small" icon={<RefreshCw size={14} aria-hidden="true" />} onClick={() => void refreshAll()}>
          {labels.refresh}
        </Button>
      </header>

      <TaskAutomationHealthSection
        labels={labels}
        language={language}
        loading={settings.loading}
        error={settings.error}
        health={settings.state.aggregateHealth}
        latestRunAt={settings.state.latestRunAt}
        resourceRuns={resourceRuns}
        resourceLoading={jobs.loading}
        onRetry={() => void settings.reload()}
      />

      <TaskAutomationTasksSection labels={labels} language={language} controller={settings} />

      <TaskAutomationResourceJobsSection labels={labels} language={language} controller={jobs} />

      <TaskAutomationPolicySection
        labels={labels}
        language={language}
        controller={settings}
        emptyTasks={settings.state.emptyState === 'never-created'}
      />
    </section>
  )
}
