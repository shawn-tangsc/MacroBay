import { Button, Select } from 'antd'

import type { TaskAutomationPolicyPreset } from '@platform/ai/agent-platform/runtime/tasks/taskAutomationContracts'
import type { AppLanguage } from '@platform/settings/schema/appSettings'
import { LoadingState } from '@platform/ui/components/loading'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'

import { buildPolicyFacts, type TaskAutomationLabels } from './taskAutomationFormat'
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
  /**
   * 读者改过、还没落盘的那个值要留在控件上：没保存上不等于他没选过。
   * 冻结控件和把值退回已存的那份，都是把「这次没保存上」说成了「你没改过」。
   */
  const shownPreset = controller.pendingPolicyPreset ?? policy?.preset
  // 写失败不冻控件（还能再改再存）；只有真的没有值可选时才停用。
  const disabled = !policy || controller.policyLoading
  const placeholder = controller.policyLoading
    ? labels.policyLoading
    : !policy && controller.policyReadError
      ? labels.policyLoadFailed
      : labels.policyLoading
  const facts = policy ? buildPolicyFacts(policy.policy, labels, language) : []
  const retry = controller.policyWriteError
    ? () => void controller.retryPolicySave()
    : () => void controller.reloadPolicy()

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
            value={shownPreset}
            placeholder={placeholder}
            disabled={disabled}
            loading={controller.policyLoading}
            onChange={(preset: TaskAutomationPolicyPreset) => void controller.updatePolicy(preset)}
            options={[
              { value: 'balanced', label: labels.balanced },
              { value: 'conservative', label: labels.conservative }
            ]}
          />
          {controller.policyReadError || controller.policyWriteError ? (
            <Button size="small" onClick={retry}>
              {labels.retry}
            </Button>
          ) : null}
        </div>
        {controller.policyWriteError ? (
          // 这次没保存上：动作是把那次修改重发一遍，不是重读——重读只会把读者改的值冲掉。
          <StateView
            state="error"
            reasonCode="operation-failed"
            size="md"
            action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: retry }}
          />
        ) : controller.policyReadError ? (
          // 读不到：没有值可选，重试是重读。
          <StateView
            state="error"
            reasonCode="unreadable"
            size="md"
            action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: retry }}
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
          <LoadingState label={labels.policyLoading} minHeight={96} />
        ) : null}
        {props.emptyTasks ? <p className="task-automation-note">{labels.policyEmptyNote}</p> : null}
      </div>
    </section>
  )
}
