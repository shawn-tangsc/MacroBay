import { Button, Drawer, Input, InputNumber, Select, Switch } from 'antd'
import { useEffect, useState } from 'react'

import type { AssistantEntity, AssistantMcpMode } from '@platform/ai/assistant-platform/schemas/assistantSchemas'
import type { PlatformText } from '../../i18n/platformText'

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
    return <Drawer open={open} onClose={onClose} title={labels.assistantSettings} />
  }

  return (
    <Drawer
      className="assistant-settings-drawer"
      open={open}
      onClose={onClose}
      title={labels.assistantSettings}
      width={420}
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
        <Select<AssistantMcpMode>
          value={settings.mcpMode}
          options={[
            { value: 'disabled', label: labels.mcpDisabled },
            { value: 'auto', label: labels.mcpAuto },
            { value: 'manual', label: labels.mcpManual }
          ]}
          onChange={(value) => onSettingsChange({ ...settings, mcpMode: value })}
        />
      </label>

      <div className="assistant-settings-toggle">
        <span>{labels.enableWebSearch}</span>
        <Switch
          checked={settings.enableWebSearch}
          onChange={(checked) => onSettingsChange({ ...settings, enableWebSearch: checked })}
        />
      </div>
      <p className="status-line">{labels.webSearchHint}</p>
      <p className="status-line">{labels.contextSourcesPlaceholder}</p>
    </div>
  )
}
