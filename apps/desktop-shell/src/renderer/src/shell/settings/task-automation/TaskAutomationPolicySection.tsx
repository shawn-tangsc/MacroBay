import { Button, Select } from 'antd'

import type { TaskAutomationPolicyPreset } from '@platform/ai/agent-platform/runtime/tasks/taskAutomationContracts'
import type { AppLanguage } from '@platform/settings/schema/appSettings'

import { buildPolicyFacts, type TaskAutomationLabels } from './taskAutomationFormat'
import { BlockError } from './TaskAutomationBlockParts'
import { TASK_AUTOMATION_CONTROL_CLASSES } from './taskAutomationControlWidths'
import type { TaskAutomationSettingsController } from './useTaskAutomationSettings'

export function TaskAutomationPolicySection(props: {
  labels: TaskAutomationLabels
  language: AppLanguage
  controller: TaskAutomationSettingsController
  /** 没有任何定时任务时的补充说明：策略会在任务开始运行后生效。 */
  emptyTasks: boolean
}): React.ReactElement {
  const { controller, labels, language } = props
  const policy = controller.policy
  const disabled = !policy || controller.policyLoading || controller.policyError
  const placeholder = controller.policyLoading
    ? labels.policyLoading
    : controller.policyError
      ? labels.policyLoadFailed
      : labels.policyLoading
  const facts = policy ? buildPolicyFacts(policy.policy, labels, language) : []

  return (
    <section className="task-automation-block" aria-busy={controller.policyLoading}>
      <header className="task-automation-block-header">
        <h2>{labels.policy}</h2>
      </header>
      <div className="task-automation-block-body">
        <div className="task-automation-policy-row">
          <span>{labels.policyCurrent}</span>
          <Select
            size="small"
            aria-label={labels.policy}
            className={TASK_AUTOMATION_CONTROL_CLASSES.policy}
            value={policy ? policy.preset : undefined}
            placeholder={placeholder}
            disabled={disabled}
            loading={controller.policyLoading}
            onChange={(preset: TaskAutomationPolicyPreset) => void controller.updatePolicy(preset)}
            options={[
              { value: 'balanced', label: labels.balanced },
              { value: 'conservative', label: labels.conservative }
            ]}
          />
          {controller.policyError ? (
            <Button size="small" onClick={() => void controller.reloadPolicy()}>
              {labels.retry}
            </Button>
          ) : null}
        </div>
        {controller.policyError ? (
          <BlockError
            label={labels.policyLoadFailed}
            retryLabel={labels.retry}
            onRetry={() => void controller.reloadPolicy()}
          />
        ) : null}
        <p className="task-automation-note">{labels.policyExplanation}</p>
        {facts.length > 0 ? (
          <dl className="task-automation-kv task-automation-policy-facts">
            {facts.map((fact) => (
              <div key={fact.key} className="task-automation-policy-fact">
                <dt>{fact.label}</dt>
                <dd className="task-automation-mono">{fact.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {controller.policyLoading ? (
          <p className="task-automation-block-state task-automation-muted">{labels.policyLoading}</p>
        ) : null}
        {props.emptyTasks ? <p className="task-automation-note">{labels.policyEmptyNote}</p> : null}
      </div>
    </section>
  )
}
