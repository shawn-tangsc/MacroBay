import { X } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'

import type { AgentMentionedModel } from '../agentMentionedModels'

/** 读屏名 = 栏目标题 + 模型名；标题与模型名都来自调用方，模板里只留一个占位。 */
const REMOVE_MENTIONED_MODEL_KEY = 'agent.mentionedModels.remove'

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

  // 按键返回**模板**：占位符由 `IconButton` 用 `ariaLabelParams` 填，句子不在这里拼接。
  const resolveAriaLabel = (key: string): string => (key === REMOVE_MENTIONED_MODEL_KEY ? '{title}: {model}' : key)

  return (
    <div className="agent-mentioned-models-bar" aria-label={title}>
      {models.map((model) => (
        <span key={model.value} className="agent-mentioned-model-chip" title={`${model.label} · ${model.providerName}`}>
          <strong>{model.label}</strong>
          <small>{model.providerName}</small>
          <IconButton
            ariaLabelKey={REMOVE_MENTIONED_MODEL_KEY}
            ariaLabelParams={{ title, model: model.label }}
            icon={X}
            size="sm"
            onSelect={() => onRemove(model.value)}
            resolveText={resolveAriaLabel}
          />
        </span>
      ))}
    </div>
  )
}
