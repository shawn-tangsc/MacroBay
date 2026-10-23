import { Button, Select } from 'antd'
import { PanelLeftClose, PanelLeftOpen, SlidersHorizontal } from 'lucide-react'

import type { PlatformText } from '../../i18n/platformText'
import type { AssistantEntity } from '@platform/ai/assistant-platform/schemas/assistantSchemas'

type AssistantHeaderProps = {
  labels: PlatformText['assistants']
  assistants: AssistantEntity[]
  activeAssistantId: string | null
  /** 标准化模型选择器（由 AssistantPage 组装，头部只负责布局）。 */
  modelPicker: React.ReactNode
  sidebarVisible: boolean
  onSelectAssistant: (assistantId: string) => void
  onToggleSidebar: () => void
  onOpenSettings: () => void
}

export function AssistantHeader({
  labels,
  assistants,
  activeAssistantId,
  modelPicker,
  sidebarVisible,
  onSelectAssistant,
  onToggleSidebar,
  onOpenSettings
}: AssistantHeaderProps): React.ReactElement {
  return (
    <header className="assistant-workspace-header">
      <div className="assistant-workspace-selectors">
        <Select
          size="small"
          className="assistant-header-select assistant-header-select-assistant"
          value={activeAssistantId ?? undefined}
          placeholder={labels.noAssistant}
          options={assistants.map((assistant) => ({
            value: assistant.id,
            label: `${assistant.icon} ${assistant.name}`
          }))}
          onChange={onSelectAssistant}
        />
        <div className="assistant-header-model" data-assistant-model-picker>
          {modelPicker}
        </div>
      </div>
      <div className="assistant-workspace-actions">
        <Button
          type="text"
          size="small"
          className="assistant-header-icon-button"
          icon={sidebarVisible ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          aria-label={sidebarVisible ? labels.hideTopics : labels.showTopics}
          onClick={onToggleSidebar}
        />
        <Button
          type="text"
          size="small"
          className="assistant-header-icon-button"
          icon={<SlidersHorizontal size={16} />}
          aria-label={labels.assistantSettings}
          onClick={onOpenSettings}
        />
      </div>
    </header>
  )
}
