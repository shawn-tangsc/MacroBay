import { Input, Switch, InputNumber } from 'antd'

import { useMemo } from 'react'

import type { AgentFormState } from '@platform/ai/agent-platform/agents/agentConfigDescriptor'
import type { AgentRuntimeCompatibilityResult } from '@platform/ai/agent-platform/runtime/compatibility/agentRuntimeCompatibilityTypes'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import { buildAgentModelOptions, flattenAgentModelOptions } from '../../agentModelOptions'
import { useAgentLanguage, useAgentText } from '../../agentTextProvider'
import { ModelPicker } from '../../../components/ModelPicker/ModelPicker'
import type { ModelPickerCandidate } from '../../../components/ModelPicker/modelPickerOptions'
import { platformText } from '../../../../i18n/platformText'

type BasicSectionProps = {
  form: AgentFormState
  providers: SafeModelProvider[]
  compatibilityByModelKey?: ReadonlyMap<string, AgentRuntimeCompatibilityResult>
  onChange: (patch: Partial<AgentFormState>) => void
}

const avatarPresets = ['🤖', '🧠', '⚡', '🚀', '🛠️', '🎯', '📊', '🔬'] as const

/**
 * 智能体配置页三个模型字段的约束（唯一事实）：它们都跑在智能体运行时（Anthropic `/v1/messages`），
 * 所以只列 messages 且具备 chat 能力的模型；已保存的旧值不满足时由选择器回显 + 提示。
 */
const AGENT_EDITOR_MODEL_CONSTRAINTS = {
  requireCapabilities: ['chat'],
  protocols: ['messages']
} as const

export default function BasicSection({
  form,
  providers,
  compatibilityByModelKey,
  onChange
}: BasicSectionProps): React.ReactElement {
  const t = useAgentText()
  const language = useAgentLanguage()
  // PLAT-70：候选判据仍是 `buildAgentModelOptions`；messages 硬约束由选择器数据层执行。
  const modelCandidates = useMemo<ModelPickerCandidate[]>(
    () =>
      flattenAgentModelOptions(buildAgentModelOptions(providers, 'claude-code', compatibilityByModelKey))
        .filter((option) => option.selectable)
        .map((option) => ({ providerId: option.providerId, model: option.model })),
    [compatibilityByModelKey, providers]
  )
  const modelLabels = platformText[language].models

  return (
    <div className="agent-form-section">
      <header>
        <h3>{t.editor.basic.title}</h3>
        <p>{t.editor.basic.description}</p>
      </header>

      <label className="agent-form-field">
        <span>{t.editor.basic.avatar}</span>
        <div className="agent-avatar-picker">
          {avatarPresets.map((avatar) => (
            <button
              key={avatar}
              type="button"
              className={form.avatar === avatar ? 'active' : ''}
              onClick={() => onChange({ avatar })}>
              {avatar}
            </button>
          ))}
        </div>
      </label>

      <label className="agent-form-field">
        <span>{t.editor.basic.name}</span>
        <Input value={form.name} placeholder={t.editor.basic.namePlaceholder} onChange={(event) => onChange({ name: event.target.value })} />
      </label>

      <div className="agent-form-grid">
        <label className="agent-form-field">
          <span>{t.editor.basic.mainModel}</span>
          <ModelPicker
            pickerId="agent-main-model"
            value={form.model || null}
            onChange={(value) => onChange({ model: value })}
            models={modelCandidates}
            providers={providers}
            labels={modelLabels}
            constraints={AGENT_EDITOR_MODEL_CONSTRAINTS}
          />
        </label>
        <label className="agent-form-field">
          <span>{t.editor.basic.planModel}</span>
          <ModelPicker
            pickerId="agent-plan-model"
            value={form.planModel || null}
            onChange={(value) => onChange({ planModel: value })}
            onClear={() => onChange({ planModel: '' })}
            allowClear
            models={modelCandidates}
            providers={providers}
            labels={modelLabels}
            constraints={AGENT_EDITOR_MODEL_CONSTRAINTS}
          />
        </label>
        <label className="agent-form-field">
          <span>{t.editor.basic.smallModel}</span>
          <ModelPicker
            pickerId="agent-small-model"
            value={form.smallModel || null}
            onChange={(value) => onChange({ smallModel: value })}
            onClear={() => onChange({ smallModel: '' })}
            allowClear
            models={modelCandidates}
            providers={providers}
            labels={modelLabels}
            constraints={AGENT_EDITOR_MODEL_CONSTRAINTS}
          />
        </label>
      </div>

      <div className="agent-switch-row">
        <div>
          <strong>{t.editor.basic.soulMode}</strong>
          <span>{t.editor.basic.soulModeDescription}</span>
        </div>
        <Switch size="small" checked={form.soulEnabled} onChange={(checked) => onChange({ soulEnabled: checked })} />
      </div>

      <div className="agent-switch-row">
        <div>
          <strong>{t.editor.basic.heartbeat}</strong>
          <span>{t.editor.basic.heartbeatDescription}</span>
        </div>
        <Switch size="small" checked={form.heartbeatEnabled} onChange={(checked) => onChange({ heartbeatEnabled: checked })} />
      </div>

      {form.heartbeatEnabled ? (
        <label className="agent-form-field">
          <span>{t.editor.basic.heartbeatInterval}</span>
          <InputNumber
            min={1}
            max={1440}
            precision={0}
            value={form.heartbeatInterval}
            onChange={(value) => onChange({ heartbeatInterval: typeof value === 'number' ? value : 30 })}
          />
        </label>
      ) : null}

      <label className="agent-form-field">
        <span>{t.editor.basic.agentDescription}</span>
        <Input.TextArea
          rows={3}
          value={form.description}
          placeholder={t.editor.basic.agentDescriptionPlaceholder}
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </label>
    </div>
  )
}
