import { Button, Input, InputNumber, Select, Switch } from 'antd'

import { Drawer } from '@platform/ui/components/drawer'
import { useEffect, useState } from 'react'

import type { AssistantEntity, AssistantMcpMode } from '@platform/ai/assistant-platform/schemas/assistantSchemas'
import type { PlatformText } from '../../i18n/platformText'

/**
 * 两个元素各用各的键：主抽屉与「还没加载出来」那一档今天写着同一句话，但它们是两个元素，
 * 将来其中一个改了标题，共用一条键就会让另一个跟着变（这正是「传键」改造里最容易犯的错）。
 */
export const ASSISTANT_SETTINGS_TITLE_KEY = 'assistant.settings.title'
export const ASSISTANT_SETTINGS_PLACEHOLDER_TITLE_KEY = 'assistant.settings.placeholderTitle'

type AssistantSettingsDrawerProps = {
  open: boolean
  labels: PlatformText['assistants']
  assistant: AssistantEntity | null
  onClose: () => void
  onSave: (patch: {
    name?: string
    prompt?: string
    modelId?: string | null
    settings?: Partial<AssistantEntity['settings']>
  }) => Promise<void>
}

type AssistantSettingsFormProps = {
  labels: PlatformText['assistants']
  name: string
  prompt: string
  settings: AssistantEntity['settings']
  onNameChange: (value: string) => void
  onPromptChange: (value: string) => void
  onSettingsChange: (settings: AssistantEntity['settings']) => void
}

export function AssistantSettingsDrawer({
  open,
  labels,
  assistant,
  onClose,
  onSave
}: AssistantSettingsDrawerProps): React.ReactElement {
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [settings, setSettings] = useState<AssistantEntity['settings'] | null>(null)

  useEffect(() => {
    if (!assistant) return
    setName(assistant.name)
    setPrompt(assistant.prompt)
    setSettings(assistant.settings)
  }, [assistant])

  if (!assistant || !settings) {
    return (
      <Drawer
        mode="modal"
        size="narrow"
        titleKey={ASSISTANT_SETTINGS_PLACEHOLDER_TITLE_KEY}
        resolveText={(key) =>
          key === ASSISTANT_SETTINGS_PLACEHOLDER_TITLE_KEY ? labels.assistantSettings : ''
        }
        open={open}
        onClose={onClose}>
        {null}
      </Drawer>
    )
  }

  return (
    <Drawer
      className="assistant-settings-drawer"
      mode="modal"
      size="narrow"
      titleKey={ASSISTANT_SETTINGS_TITLE_KEY}
      resolveText={(key) => (key === ASSISTANT_SETTINGS_TITLE_KEY ? labels.assistantSettings : '')}
      open={open}
      onClose={onClose}
      footer={
        <Button
          className="ant-primary-button"
          onClick={() =>
            void onSave({
              name,
              prompt,
              settings
            }).then(onClose)
          }>
          {labels.saveSettings}
        </Button>
      }>
      <AssistantSettingsForm
        labels={labels}
        name={name}
        prompt={prompt}
        settings={settings}
        onNameChange={setName}
        onPromptChange={setPrompt}
        onSettingsChange={setSettings}
      />
    </Drawer>
  )
}

export function AssistantSettingsForm({
  labels,
  name,
  prompt,
  settings,
  onNameChange,
  onPromptChange,
  onSettingsChange
}: AssistantSettingsFormProps): React.ReactElement {
  return (
    <div className="assistant-settings-form">
      <label className="assistant-settings-field">
        <span>{labels.assistantName}</span>
        <Input value={name} onChange={(event) => onNameChange(event.target.value)} />
      </label>
      <label className="assistant-settings-field">
        <span>{labels.assistantPrompt}</span>
        <Input.TextArea
          value={prompt}
          autoSize={{ minRows: 3, maxRows: 8 }}
          onChange={(event) => onPromptChange(event.target.value)}
        />
      </label>
      <p className="assistant-settings-note" data-assistant-model-note>
        {labels.modelSwitchHint}
      </p>

      <div className="assistant-settings-toggle">
        <span>{labels.enableTemperature}</span>
        <Switch
          checked={settings.enableTemperature}
          onChange={(checked) => onSettingsChange({ ...settings, enableTemperature: checked })}
        />
      </div>
      {settings.enableTemperature ? (
        <label className="assistant-settings-field">
          <span>{labels.temperature}</span>
          <InputNumber
            min={0}
            max={2}
            step={0.1}
            value={settings.temperature}
            onChange={(value) =>
              onSettingsChange({ ...settings, temperature: typeof value === 'number' ? value : settings.temperature })
            }
          />
        </label>
      ) : null}

      <div className="assistant-settings-toggle">
        <span>{labels.streamOutput}</span>
        <Switch
          checked={settings.streamOutput}
          onChange={(checked) => onSettingsChange({ ...settings, streamOutput: checked })}
        />
      </div>

      <label className="assistant-settings-field">
        <span>{labels.mcpMode}</span>
        {/*
         * 助手运行时没有 MCP 执行链路（Phase 9 deferred），这里只回显已存的值。
         * 不禁用就是一个点了没反应的假开关，所以禁用并说明；保留字段是为了不丢历史值。
         */}
        <Select<AssistantMcpMode>
          value={settings.mcpMode}
          disabled
          options={[
            { value: 'disabled', label: labels.mcpDisabled },
            { value: 'auto', label: labels.mcpAuto },
            { value: 'manual', label: labels.mcpManual }
          ]}
          onChange={(value) => onSettingsChange({ ...settings, mcpMode: value })}
        />
      </label>
      <p className="assistant-settings-note" data-assistant-mcp-unavailable>
        {labels.mcpModeUnavailableHint}
      </p>

      <div className="assistant-settings-toggle">
        <span>{labels.enableWebSearch}</span>
        <Switch
          checked={settings.enableWebSearch}
          onChange={(checked) => onSettingsChange({ ...settings, enableWebSearch: checked })}
        />
      </div>
      <p className="status-line">{labels.webSearchHint}</p>
    </div>
  )
}
