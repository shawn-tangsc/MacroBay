import { Select } from 'antd'

import type { AgentFormState } from '@platform/ai/agent-platform/agents/agentConfigDescriptor'
import { agentPermissionModes } from '@platform/ai/agent-platform/schemas/agentSchemas'

import { useAgentText } from '../../agentTextProvider'

type PermissionSectionProps = {
  form: AgentFormState
  onChange: (patch: Partial<AgentFormState>) => void
}

export default function PermissionSection({ form, onChange }: PermissionSectionProps): React.ReactElement {
  const t = useAgentText()

  return (
    <div className="agent-form-section">
      <header>
        <h3>{t.editor.permission.title}</h3>
        <p>{t.editor.permission.description}</p>
      </header>

      <label className="agent-form-field">
        <span>{t.editor.permission.executionPermission}</span>
        <Select
          value={form.permissionMode || 'default'}
          options={agentPermissionModes.map((mode) => ({ value: mode, label: t.permissionMode[mode] }))}
          onChange={(value) => onChange({ permissionMode: value })}
        />
      </label>
    </div>
  )
}
