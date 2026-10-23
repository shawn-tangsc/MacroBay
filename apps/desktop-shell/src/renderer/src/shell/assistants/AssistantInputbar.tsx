import { Button, Input, Tooltip } from 'antd'
import {
  Database,
  Eraser,
  FolderPlus,
  type LucideIcon,
  Paperclip,
  PanelTopOpen,
  Search,
  Settings2,
  SendHorizontal,
  Square,
  Wrench
} from 'lucide-react'

import type { PlatformText } from '../../i18n/platformText'
import {
  createAssistantInputbarTools,
  listVisibleAssistantInputbarTools,
  type AssistantInputbarToolId
} from './inputbar/assistantInputbarRegistry'
import type { AssistantMentionedModel } from './assistantMentionedModels'
import { AssistantMentionedModelsPicker } from './AssistantMentionedModelsPicker'
import { AssistantImageGenerateControl } from './imageGeneration/AssistantImageGenerateControl'
import { AssistantImageEditControl } from './imageGeneration/AssistantImageEditControl'
import type { AssistantImageGenerationView } from './imageGeneration/imageGenerationModel'
import type { AssistantImageMessagePart } from '@platform/ai/assistant-platform/schemas/messageSchemas'

type AssistantInputbarProps = {
  labels: PlatformText['assistants']
  draft: string
  isSending: boolean
  isStreaming: boolean
  modelReady: boolean
  assistantSelected?: boolean
  composerEnabled?: boolean
  topicSelected: boolean
  statusMessage?: string | null
  mentionedModels: readonly AssistantMentionedModel[]
  /** T1–T3：图像生成 / 编辑入口（未配置端点时按钮禁用）。 */
  imageGeneration: AssistantImageGenerationView
  /** 本会话已生成的图片（编辑时的原图来源）。 */
  sessionImages: readonly AssistantImageMessagePart[]
  modelOptions: readonly AssistantMentionedModel[]
  onDraftChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  onToolAction: (toolId: AssistantInputbarToolId) => void
  onOpenSettings: () => void
  onToggleMentionedModel: (value: string) => void
  onClearMentionedModels: () => void
}

const TOOL_ICONS: Record<AssistantInputbarToolId, LucideIcon> = {
  attachment: Paperclip,
  'new-topic': FolderPlus,
  'clear-topic': Eraser,
  'quick-panel': PanelTopOpen,
  'mcp-tools': Wrench,
  'web-search': Search,
  'context-source': Database
}

export function AssistantInputbar({
  labels,
  draft,
  isSending,
  isStreaming,
  modelReady,
  assistantSelected = true,
  composerEnabled,
  topicSelected,
  statusMessage,
  mentionedModels,
  imageGeneration,
  sessionImages,
  modelOptions,
  onDraftChange,
  onSend,
  onStop,
  onToolAction,
  onOpenSettings,
  onToggleMentionedModel,
  onClearMentionedModels
}: AssistantInputbarProps): React.ReactElement {
  const tools = listVisibleAssistantInputbarTools(createAssistantInputbarTools())
  const canCompose = composerEnabled ?? (assistantSelected && modelReady)

  return (
    <footer className="assistant-composer assistant-inputbar">
      {assistantSelected && !modelReady ? <p className="status-line">{labels.modelNotReady}</p> : null}
      {statusMessage ? <p className="status-line assistant-status-line-error">{statusMessage}</p> : null}
      <Input.TextArea
        value={draft}
        autoSize={{ minRows: 2, maxRows: 6 }}
        placeholder={labels.inputPlaceholder}
        disabled={!canCompose}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            onSend()
          }
        }}
      />
      <div className="assistant-composer-footer">
        <div className="assistant-inputbar-tools">
          <AssistantImageGenerateControl labels={labels} view={imageGeneration} />
          <AssistantImageEditControl labels={labels} view={imageGeneration} availableImages={sessionImages} />
          {tools.map((tool) => {
            const Icon = TOOL_ICONS[tool.id]
            const label = labels.inputbarTools[tool.labelKey]
            return (
              <Tooltip key={tool.id} title={tool.placeholder ? labels.comingSoon : label}>
                <Button
                  type="text"
                  size="small"
                  className="assistant-inputbar-tool"
                  disabled={!tool.enabled || (tool.id === 'clear-topic' && !topicSelected)}
                  icon={<Icon size={14} />}
                  aria-label={label}
                  onClick={() => onToolAction(tool.id)}
                />
              </Tooltip>
            )
          })}
          <Tooltip title={labels.mentionedModels}>
            <span>
              <AssistantMentionedModelsPicker
                labels={labels}
                modelOptions={modelOptions}
                mentionedModels={mentionedModels}
                disabled={!canCompose}
                onToggleMentionedModel={onToggleMentionedModel}
                onClearMentionedModels={onClearMentionedModels}
              />
            </span>
          </Tooltip>
          <Tooltip title={labels.assistantSettings}>
            <Button
              type="text"
              size="small"
              className="assistant-inputbar-tool"
              icon={<Settings2 size={14} />}
              aria-label={labels.assistantSettings}
              onClick={onOpenSettings}
            />
          </Tooltip>
        </div>
        <div className="assistant-composer-actions">
          {isStreaming || isSending ? (
            <Button
              className="assistant-stop-button"
              shape="circle"
              icon={<Square size={13} />}
              aria-label={labels.stop}
              title={labels.stop}
              onClick={onStop}>
              <span className="assistant-button-label">{labels.stop}</span>
            </Button>
          ) : (
            <Button
              className="assistant-send-button"
              type="primary"
              shape="circle"
              icon={<SendHorizontal size={16} />}
              aria-label={labels.send}
              title={labels.send}
              disabled={!draft.trim() || !canCompose}
              onClick={onSend}>
              <span className="assistant-button-label">{labels.send}</span>
            </Button>
          )}
        </div>
      </div>
    </footer>
  )
}
