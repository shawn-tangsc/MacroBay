import { useMemo, useState } from 'react'
import { Popover } from 'antd'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'

import type { AgentEffort, AgentEntity, UniqueModelId } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { AgentRuntimeCompatibilityResult } from '@platform/ai/agent-platform/runtime/compatibility/agentRuntimeCompatibilityTypes'
import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { platformText } from '../../../i18n/platformText'
import { buildAgentModelOptions, flattenAgentModelOptions, type AgentModelOption } from '../agentModelOptions'
import { setAgentEffort, setAgentModel } from '../agentStateActions'
import { setAgentModelViaApi, setAgentViaApi } from '../agentSessionDataApi'
import { useAgentLanguage, useAgentText } from '../agentTextProvider'
import {
  isUnconfiguredAgentModel,
  resolveConfiguredAgentModel
} from '@platform/ai/agent-platform/runtime/effectiveAgentModel'
import { ModelPicker } from '../../components/ModelPicker/ModelPicker'
import type { ModelPickerCandidate } from '../../components/ModelPicker/modelPickerOptions'

const AGENT_MODEL_PICKER_CONSTRAINTS = {
  requireCapabilities: ['chat'],
  protocols: ['messages'],
  showProtocolFilter: true
} as const

type View = 'menu' | 'effort'

export default function AgentComposerModelMenu({
  agent,
  providers,
  compatibilityByModelKey,
  defaultAgentModelId,
  onStateChange
}: {
  agent: AgentEntity
  providers: SafeModelProvider[]
  compatibilityByModelKey?: ReadonlyMap<string, AgentRuntimeCompatibilityResult>
  defaultAgentModelId?: string
  onStateChange: (updater: (state: AgentStoreState) => AgentStoreState) => void
}): React.ReactElement {
  const t = useAgentText()
  const language = useAgentLanguage()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>('menu')

  const candidates = useMemo<ModelPickerCandidate[]>(
    () =>
      flattenAgentModelOptions(buildAgentModelOptions(providers, agent.type, compatibilityByModelKey))
        .filter((option: AgentModelOption) => option.selectable)
        .map((option: AgentModelOption) => ({ providerId: option.providerId, model: option.model })),
    [agent.type, compatibilityByModelKey, providers]
  )
  const resolvedDefaultModel = useMemo(() => {
    if (!isUnconfiguredAgentModel(agent.model)) return null
    const resolved = resolveConfiguredAgentModel({
      providers,
      configuredDefaultModelId: defaultAgentModelId,
      agentType: agent.type
    })
    return resolved.ok ? resolved : null
  }, [agent.model, agent.type, defaultAgentModelId, providers])
  const effectiveModelId = isUnconfiguredAgentModel(agent.model)
    ? resolvedDefaultModel?.model
    : agent.model
  const selectedOption = candidates.find(
    (candidate) => `${candidate.providerId}:${candidate.model.id}` === effectiveModelId
  )
  const modelLabel = selectedOption?.model.name ?? resolvedDefaultModel?.modelName ?? t.input.placeholder
  /** 厂商明确声明不支持推理的模型不给选强度；未声明（未同步到能力）时保持原行为。 */
  const canChooseReasoningEffort = selectedOption?.model.capabilities?.reasoning !== false
  const effort: AgentEffort = agent.configuration?.effort ?? 'high'
  const effortLabel = t.input.effortLevels[effort]

  function changeOpen(next: boolean): void {
    setOpen(next)
    if (!next) setView('menu')
  }

  const content = view === 'menu' || !canChooseReasoningEffort ? (
    <div className="agent-composer-menu">
      <ModelPicker
        pickerId="agent-composer"
        value={isUnconfiguredAgentModel(agent.model) ? null : agent.model}
        onChange={(modelId: UniqueModelId) => {
          void setAgentModelViaApi(window.platform, agent.id, modelId).catch(() => {
            onStateChange((current) => setAgentModel(current, agent.id, modelId))
          })
        }}
        models={candidates}
        providers={providers}
        labels={platformText[language].models}
        constraints={AGENT_MODEL_PICKER_CONSTRAINTS}
        placement="topLeft"
        trigger={
          <button type="button" className="agent-composer-menu__row">
            <span>{platformText[language].models.modelCatalog}</span>
            <strong>{modelLabel}</strong>
            <ChevronRight size={13} />
          </button>
        }
      />
      {canChooseReasoningEffort ? (
        <button type="button" className="agent-composer-menu__row" onClick={() => setView('effort')}>
          <span>{t.input.reasoningEffort}</span>
          <strong>{effortLabel}</strong>
          <ChevronRight size={13} />
        </button>
      ) : null}
    </div>
  ) : (
    <div className="agent-composer-menu">
      {(['off', 'low', 'high', 'max'] as const).map((level) => (
        <button
          type="button"
          key={level}
          className="agent-composer-menu__option"
          onClick={() => {
            if (level !== effort) {
              void setAgentViaApi(window.platform, agent.id, {
                configuration: { ...agent.configuration, effort: level }
              }).catch(() => {
                onStateChange((current) => setAgentEffort(current, agent.id, level))
              })
            }
            changeOpen(false)
          }}>
          <span>{t.input.effortLevels[level]}</span>
          {level === effort ? <Check size={13} /> : null}
        </button>
      ))}
    </div>
  )

  return (
    <Popover
      open={open}
      onOpenChange={changeOpen}
      trigger="click"
      placement="topLeft"
      content={<div className="agent-composer-popover">{content}</div>}>
      <button type="button" className="agent-composer-model-trigger" aria-label={t.input.reasoningEffort}>
        <span className="agent-composer-model-trigger__name">{modelLabel}</span>
        {canChooseReasoningEffort ? (
          <span className="agent-composer-model-trigger__effort">{effortLabel}</span>
        ) : null}
        <ChevronDown size={13} aria-hidden="true" />
      </button>
    </Popover>
  )
}
