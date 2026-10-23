import { Button, Input, InputNumber, Select, Switch } from 'antd'
import { Check, X } from 'lucide-react'

import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'
import type { Trigger } from '@platform/ai/agent-platform/schemas/taskSchemas'
import type { TaskSchedulePreview } from '@platform/ai/agent-platform/runtime/tasks/taskScheduleValidation'

import type { AgentText } from '../agentText'
import type { AgentTaskDraft } from '../agentTaskCenterViewModel'
import { buildTaskWorkspaceOptions } from '../agentTaskWorkspaceOptions'

type AgentTaskDraftFormProps = {
  draft: AgentTaskDraft
  workspaces: AgentStoreState['workspaces']
  saving: boolean
  editing: boolean
  disabled: boolean
  schedulePreview: TaskSchedulePreview | null
  labels: AgentText['taskCenter']
  onDraftChange: (patch: Partial<AgentTaskDraft>) => void
  onSave: () => void
  onCancelCreate: () => void
}

const triggerKinds: Trigger['kind'][] = ['interval', 'once', 'cron']

function isTriggerKind(value: string): value is Trigger['kind'] {
  return (triggerKinds as readonly string[]).includes(value)
}

export default function AgentTaskDraftForm({
  draft,
  workspaces,
  saving,
  editing,
  disabled,
  schedulePreview,
  labels,
  onDraftChange,
  onSave,
  onCancelCreate
}: AgentTaskDraftFormProps): React.ReactElement {
  const workspaceOptions = buildTaskWorkspaceOptions(workspaces, labels)
  return (
    <section className="agent-task-form">
      <header>
        <span>
          <strong>{editing ? labels.editTask : labels.createTask}</strong>
          <small>{labels.formDescription}</small>
        </span>
        <div className="agent-task-form-actions">
          <Button className="ant-secondary-button" size="small" icon={<X size={14} />} onClick={onCancelCreate} disabled={saving}>
            {labels.reset}
          </Button>
          <Button className="ant-primary-button" size="small" loading={saving} disabled={disabled} icon={<Check size={14} />} onClick={onSave}>
            {labels.saveTask}
          </Button>
        </div>
      </header>
      <div className="agent-task-form-grid">
        <label>
          <span>{labels.name}</span>
          <Input disabled={disabled} value={draft.name} placeholder={labels.namePlaceholder} onChange={(event) => onDraftChange({ name: event.target.value })} />
        </label>
        <label>
          <span>{labels.trigger}</span>
          <Select
            value={draft.triggerKind}
            disabled={disabled}
            options={[
              { value: 'interval', label: labels.triggerInterval },
              { value: 'once', label: labels.triggerOnce },
              { value: 'cron', label: labels.triggerCron }
            ]}
            onChange={(triggerKind: string) => {
              if (isTriggerKind(triggerKind)) onDraftChange({ triggerKind })
            }}
          />
        </label>
        {draft.triggerKind === 'interval' ? (
          <label>
            <span>{labels.intervalMinutes}</span>
            <InputNumber min={1} disabled={disabled} value={draft.intervalMinutes} onChange={(value) => onDraftChange({ intervalMinutes: Number(value ?? 1) })} />
          </label>
        ) : null}
        {draft.triggerKind === 'once' ? (
          <label>
            <span>{labels.onceAt}</span>
            <Input disabled={disabled} value={draft.onceAt} placeholder={labels.onceAtPlaceholder} onChange={(event) => onDraftChange({ onceAt: event.target.value })} />
          </label>
        ) : null}
        {draft.triggerKind === 'cron' ? (
          <>
            <label>
              <span>{labels.cronExpr}</span>
              <Input disabled={disabled} value={draft.cronExpr} placeholder={labels.cronExprPlaceholder} onChange={(event) => onDraftChange({ cronExpr: event.target.value })} />
            </label>
            <label>
              <span>{labels.timezone}</span>
              <Input disabled={disabled} value={draft.timezone} placeholder={labels.timezonePlaceholder} onChange={(event) => onDraftChange({ timezone: event.target.value })} />
            </label>
          </>
        ) : null}
        <label>
          <span>{labels.timeoutMinutes}</span>
          <InputNumber min={1} disabled={disabled} value={draft.timeoutMinutes} onChange={(value) => onDraftChange({ timeoutMinutes: Number(value ?? 1) })} />
        </label>
        <label>
          <span>{labels.workspace}</span>
          <Select
            value={draft.workspace.type === 'user' ? draft.workspace.workspaceId : '__system__'}
            disabled={disabled}
            options={workspaceOptions.map((option) => ({ value: option.value, label: option.label }))}
            onChange={(value: string) => {
              const option = workspaceOptions.find((item) => item.value === value)
              if (option) onDraftChange({ workspace: option.workspace })
            }}
          />
        </label>
        <div className="agent-task-switch-row">
          <span>
            <strong>{labels.enabled}</strong>
            <small>{labels.enabledDescription}</small>
          </span>
          <Switch disabled={disabled} checked={draft.enabled} onChange={(enabled) => onDraftChange({ enabled })} />
        </div>
      </div>
      {schedulePreview ? (
        <div className={`agent-task-preview ${schedulePreview.ok ? 'ready' : 'invalid'}`}>
          {schedulePreview.ok
            ? `${labels.schedulePreview}: ${schedulePreview.nextRunAt.replace('T', ' ').slice(0, 16)}`
            : schedulePreview.code === 'task-timezone-invalid'
              ? labels.timezoneInvalid
              : labels.scheduleInvalid}
        </div>
      ) : null}
      <label className="agent-task-prompt-field">
        <span>{labels.prompt}</span>
        <Input.TextArea
          value={draft.prompt}
          disabled={disabled}
          rows={5}
          placeholder={labels.promptPlaceholder}
          onChange={(event) => onDraftChange({ prompt: event.target.value })}
        />
      </label>
    </section>
  )
}
