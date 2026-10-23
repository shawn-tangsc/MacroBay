import { Input, InputNumber } from 'antd'

import type { AgentFormState } from '@platform/ai/agent-platform/agents/agentConfigDescriptor'

import { useAgentText } from '../../agentTextProvider'

type AdvancedSectionProps = {
  form: AgentFormState
  onChange: (patch: Partial<AgentFormState>) => void
}

export default function AdvancedSection({ form, onChange }: AdvancedSectionProps): React.ReactElement {
  const t = useAgentText()

  return (
    <div className="agent-form-section">
      <header>
        <h3>{t.editor.advanced.title}</h3>
        <p>{t.editor.advanced.description}</p>
      </header>

      <label className="agent-form-field">
        <span>{t.editor.advanced.maxTurns}</span>
        <InputNumber
          min={0}
          max={100}
          precision={0}
          value={form.maxTurns || null}
          placeholder="0"
          onChange={(value) => onChange({ maxTurns: typeof value === 'number' ? value : 0 })}
        />
      </label>

      <label className="agent-form-field">
        <span>{t.editor.advanced.envVars}</span>
        <Input.TextArea
          rows={6}
          value={form.envVarsText}
          placeholder={'KEY=value\nANOTHER_KEY=another_value'}
          onChange={(event) => onChange({ envVarsText: event.target.value })}
        />
      </label>
    </div>
  )
}
