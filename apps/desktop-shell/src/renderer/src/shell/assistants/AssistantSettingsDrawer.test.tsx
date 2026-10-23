import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDefaultAssistantSettings } from '@platform/ai/assistant-platform/schemas/assistantSchemas'
import { platformText } from '../../i18n/platformText'
import { AssistantSettingsForm } from './AssistantSettingsDrawer'

describe('AssistantSettingsDrawer', () => {
  it('points at the header model picker instead of duplicating the model select', () => {
    const labels = platformText['zh-CN'].assistants
    const entity = createDefaultAssistantSettings()
    const markup = renderToStaticMarkup(
      <AssistantSettingsForm
        labels={labels}
        name="Default Assistant"
        prompt="Help."
        settings={entity}
        onNameChange={() => undefined}
        onPromptChange={() => undefined}
        onSettingsChange={() => undefined}
      />
    )

    expect(markup).toContain(labels.modelSwitchHint)
    // 同一概念只留一处：设置抽屉里不再有模型下拉（只有那行说明）。
    expect(markup).toContain('data-assistant-model-note')
    expect(markup).not.toContain('默认模型')
  })
})
