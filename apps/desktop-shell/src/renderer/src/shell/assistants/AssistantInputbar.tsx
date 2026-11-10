import { Button, Input } from 'antd'
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

import { IconButton } from '@platform/ui/components/icon-button'
import { navigateTo } from '@platform/workspace/navigation/navigationRequest'
import { useToast } from '@platform/ui/components/toast'
import type { ChatSettings } from '@platform/settings/schema/appSettings'
import { isSendShortcut } from '../chat/chatSendShortcut'
import type { PlatformText } from '../../i18n/platformText'
import { resolveAssistantsText, type AssistantsTextPath } from '../../i18n/assistantsTextKey'
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
  /** 与智能体输入栏同一份 `settings.chat.sendShortcut`，判定走 `chatSendShortcut`。 */
  sendShortcut: ChatSettings['sendShortcut']
  /** 话题还没选时，把读者送到话题选择器去（页面层给回调；输入条不自己找 DOM）。 */
  onRequireTopic: () => void
  /** 提及选择器不可用时，把读者送到顶部模型选择器（同样由页面层做焦点交接）。 */
  onRequireModel: () => void
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

const SETTINGS_TOOLTIP_KEY = 'assistants.assistantSettings'
const INPUTBAR_TOOL_KEYS = {
  attachment: 'assistants.inputbarTools.attachment',
  'new-topic': 'assistants.inputbarTools.new-topic',
  'clear-topic': 'assistants.inputbarTools.clear-topic',
  'quick-panel': 'assistants.inputbarTools.quick-panel',
  'mcp-tools': 'assistants.inputbarTools.mcp-tools',
  'web-search': 'assistants.inputbarTools.web-search',
  'context-source': 'assistants.inputbarTools.context-source'
} as const satisfies Record<AssistantInputbarToolId, string>
const TOPIC_REQUIRED_KEY = 'assistants.topicRequiredHint'
/** 设置 → 模型服务；id 来自 `builtInNavEntries.ts:79`（`label: t.settings.modelService`）。 */
const MODEL_SERVICE_PANEL_ID = 'models'

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
  sendShortcut,
  onRequireTopic,
  onRequireModel,
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
  const resolveAssistantText = (key: string): string => {
    const path = key.startsWith('assistants.') ? key.slice('assistants.'.length) : key
    return resolveAssistantsText(labels, path as AssistantsTextPath)
  }
  const toast = useToast()
  const handleImageUnavailable = (): void => {
    toast.info({ titleKey: 'imageEndpointMissingHint', resolveText: resolveAssistantText })
    navigateTo({ page: 'settings', panel: MODEL_SERVICE_PANEL_ID })
  }
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
          if (isSendShortcut(event, sendShortcut)) {
            event.preventDefault()
            onSend()
          }
        }}
      />
      <div className="assistant-composer-footer">
        <div className="assistant-inputbar-tools">
          <AssistantImageGenerateControl labels={labels} onUnavailable={handleImageUnavailable} view={imageGeneration} />
          <AssistantImageEditControl availableImages={sessionImages} labels={labels} onUnavailable={handleImageUnavailable} view={imageGeneration} />
          {tools.map((tool) => {
            const Icon = TOOL_ICONS[tool.id]
            return (
              <IconButton
                key={tool.id}
                ariaLabelKey={INPUTBAR_TOOL_KEYS[tool.id]}
                className="assistant-inputbar-tool"
                icon={Icon}
                onSelect={() => {
                    // 临时不可用不等于禁用：按钮保持可点，点了把读者送到话题选择器，并说一句为什么。
                    if (tool.id === 'clear-topic' && !topicSelected) {
                      onRequireTopic()
                      toast.info({
                        titleKey: TOPIC_REQUIRED_KEY,
                        resolveText: (key) => (key === TOPIC_REQUIRED_KEY ? labels.topicRequiredHint : '')
                      })
                      return
                    }
                    onToolAction(tool.id)
                  }}
                resolveText={resolveAssistantText}
                size="md"
                tooltipKey={INPUTBAR_TOOL_KEYS[tool.id]}
              />
            )
          })}
          <AssistantMentionedModelsPicker
            onRequireModel={onRequireModel}
            labels={labels}
            modelOptions={modelOptions}
            mentionedModels={mentionedModels}
            disabled={!canCompose}
            onToggleMentionedModel={onToggleMentionedModel}
            onClearMentionedModels={onClearMentionedModels}
          />
          <IconButton
            ariaLabelKey={SETTINGS_TOOLTIP_KEY}
            className="assistant-inputbar-tool"
            icon={Settings2}
            onSelect={onOpenSettings}
            resolveText={resolveAssistantText}
            size="md"
            tooltipKey={SETTINGS_TOOLTIP_KEY}
          />
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
