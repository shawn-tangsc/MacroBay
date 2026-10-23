import { Input } from 'antd'

import type { AgentFormState } from '@platform/ai/agent-platform/agents/agentConfigDescriptor'

import { useAgentText } from '../../agentTextProvider'

type PromptSectionProps = {
  form: AgentFormState
  onChange: (patch: Partial<AgentFormState>) => void
}

export default function PromptSection({ form, onChange }: PromptSectionProps): React.ReactElement {
  const t = useAgentText()

  return (
    <div className="agent-form-section">
      <header>
        <h3>{t.editor.prompt.title}</h3>
        <p>{t.editor.prompt.description}</p>
      </header>

      <label className="agent-form-field">
        <span>{t.editor.prompt.systemInstructions}</span>
        <Input.TextArea
          className="agent-prompt-textarea"
          rows={14}
          value={form.instructions}
          placeholder={t.editor.prompt.placeholder}
          onChange={(event) => onChange({ instructions: event.target.value })}
        />
      </label>
    </div>
  )
}
