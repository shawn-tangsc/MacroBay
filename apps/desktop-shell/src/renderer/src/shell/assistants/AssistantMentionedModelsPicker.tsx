import { Button, Popover } from 'antd'
import { AtSign, Check, X } from 'lucide-react'

import type { PlatformText } from '../../i18n/platformText'
import type { AssistantMentionedModel } from './assistantMentionedModels'

type AssistantMentionedModelsPickerProps = {
  labels: PlatformText['assistants']
  modelOptions: readonly AssistantMentionedModel[]
  mentionedModels: readonly AssistantMentionedModel[]
  disabled: boolean
  onToggleMentionedModel: (value: string) => void
  onClearMentionedModels: () => void
}

export function AssistantMentionedModelsPicker({
  labels,
  modelOptions,
  mentionedModels,
  disabled,
  onToggleMentionedModel,
  onClearMentionedModels
}: AssistantMentionedModelsPickerProps): React.ReactElement {
  const selected = new Set(mentionedModels.map((model) => model.value))

  return (
    <div className="assistant-mentioned-model-picker">
      <Popover
        trigger="click"
        placement="topLeft"
        content={
          <div className="assistant-model-picker-menu">
            {modelOptions.map((option) => {
              const active = selected.has(option.value)
              return (
                <button
                  key={option.value}
                  type="button"
                  className={active ? 'assistant-model-picker-option active' : 'assistant-model-picker-option'}
                  onClick={() => onToggleMentionedModel(option.value)}>
                  <span>{option.label}</span>
                  {active ? <Check size={14} /> : null}
                </button>
              )
            })}
          </div>
        }>
        <Button
          type="text"
          size="small"
          className="assistant-inputbar-tool"
          icon={<AtSign size={14} />}
          aria-label={labels.mentionedModels}
          disabled={disabled || modelOptions.length === 0}
        />
      </Popover>

      {mentionedModels.length > 0 ? (
        <div className="assistant-mentioned-model-tags" aria-label={labels.mentionedModels}>
          {mentionedModels.map((model) => (
            <button
              key={model.value}
              type="button"
              className="assistant-mentioned-model-tag"
              onClick={() => onToggleMentionedModel(model.value)}>
              <span>{model.label}</span>
              <X size={12} />
            </button>
          ))}
          <Button size="small" type="text" onClick={onClearMentionedModels}>
            {labels.clearMentionedModels}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
