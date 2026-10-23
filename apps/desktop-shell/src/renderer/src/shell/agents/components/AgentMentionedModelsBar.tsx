import { X } from 'lucide-react'

import type { AgentMentionedModel } from '../agentMentionedModels'

type AgentMentionedModelsBarProps = {
  title: string
  models: readonly AgentMentionedModel[]
  onRemove: (modelValue: string) => void
}

export default function AgentMentionedModelsBar({
  title,
  models,
  onRemove
}: AgentMentionedModelsBarProps): React.ReactElement | null {
  if (models.length === 0) return null

  return (
    <div className="agent-mentioned-models-bar" aria-label={title}>
      {models.map((model) => (
        <span key={model.value} className="agent-mentioned-model-chip" title={`${model.label} · ${model.providerName}`}>
          <strong>{model.label}</strong>
          <small>{model.providerName}</small>
          <button type="button" aria-label={`${title}: ${model.label}`} onClick={() => onRemove(model.value)}>
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  )
}
