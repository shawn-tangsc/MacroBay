import { Button, Popover } from 'antd'

import { useToast } from '@platform/ui/components/toast'
import { AtSign, Check, X } from 'lucide-react'

import type { PlatformText } from '../../i18n/platformText'
import { resolveAssistantsText, type AssistantsTextPath } from '../../i18n/assistantsTextKey'
import type { AssistantMentionedModel } from './assistantMentionedModels'

type AssistantMentionedModelsPickerProps = {
  labels: PlatformText['assistants']
  modelOptions: readonly AssistantMentionedModel[]
  mentionedModels: readonly AssistantMentionedModel[]
  disabled: boolean
  /** 不可用时的下一步：把读者送到顶部模型选择器（页面层实现焦点，选择器自己不查 DOM）。 */
  onRequireModel: () => void
  onToggleMentionedModel: (value: string) => void
  onClearMentionedModels: () => void
}

export function AssistantMentionedModelsPicker({
  labels,
  modelOptions,
  mentionedModels,
  disabled,
  onRequireModel,
  onToggleMentionedModel,
  onClearMentionedModels
}: AssistantMentionedModelsPickerProps): React.ReactElement {
  const selected = new Set(mentionedModels.map((model) => model.value))
  const unavailable = disabled || modelOptions.length === 0
  const toast = useToast()
  const resolveText = (key: string): string => resolveAssistantsText(labels, key as AssistantsTextPath)
  const handleUnavailable = (): void => {
    toast.info({ titleKey: 'mentionedModelsMissingHint', resolveText })
    onRequireModel()
  }
  const trigger = (
    <Button
      aria-label={labels.mentionedModels}
      className="assistant-inputbar-tool"
      icon={<AtSign size={14} />}
      onClick={unavailable ? handleUnavailable : undefined}
      size="small"
      type="text"
    />
  )

  return (
    <div className="assistant-mentioned-model-picker">
      {unavailable ? trigger : (
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
        {trigger}
      </Popover>
      )}

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
