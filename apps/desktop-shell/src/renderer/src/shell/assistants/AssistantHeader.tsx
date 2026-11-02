import { Button, Select } from 'antd'
import { PanelLeftClose, PanelLeftOpen, SlidersHorizontal } from 'lucide-react'
import { useEffect, useRef } from 'react'

import type { PlatformText } from '../../i18n/platformText'
import type { AssistantEntity } from '@platform/ai/assistant-platform/schemas/assistantSchemas'

type AssistantHeaderProps = {
  labels: PlatformText['assistants']
  assistants: AssistantEntity[]
  activeAssistantId: string | null
  /** 标准化模型选择器（由 AssistantPage 组装，头部只负责布局）。 */
  modelPicker: React.ReactNode
  /** 每次自增表示「把读者送到模型选择器」：输入条那颗提及选择器不可用时由页面层加一。 */
  focusModelPickerTick?: number
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
  focusModelPickerTick = 0,
  sidebarVisible,
  onSelectAssistant,
  onToggleSidebar,
  onOpenSettings
}: AssistantHeaderProps): React.ReactElement {
  const pickerSlotRef = useRef<HTMLSpanElement | null>(null)

  // 到达后第一件事是换模型：焦点落到选择器自己的触发按钮上，不靠读者去找。
  useEffect(() => {
    if (focusModelPickerTick === 0) return
    pickerSlotRef.current?.querySelector<HTMLElement>('.model-picker-trigger')?.focus()
  }, [focusModelPickerTick])

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
          <span ref={pickerSlotRef}>{modelPicker}</span>
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
