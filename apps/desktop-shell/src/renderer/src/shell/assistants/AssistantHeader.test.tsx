import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { AssistantEntity } from '@platform/ai/assistant-platform/schemas/assistantSchemas'
import { createDefaultAssistantSettings } from '@platform/ai/assistant-platform/schemas/assistantSchemas'

import { platformText } from '../../i18n/platformText'
import { AssistantHeader } from './AssistantHeader'

const labels = platformText['en-US'].assistants
const assistant: AssistantEntity = {
  id: 'assistant-1',
  name: 'Default Assistant',
  prompt: '',
  icon: '💬',
  description: '',
  modelId: 'silicon:deepseek-v3',
  modelName: null,
  settings: createDefaultAssistantSettings(),
  mcpServerIds: [],
  contextSourceIds: [],
  tags: [],
  orderKey: '0001',
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z'
}

describe('AssistantHeader', () => {
  it('hosts the standard model picker instead of the old pill', () => {
    const markup = renderToStaticMarkup(
      <AssistantHeader
        labels={labels}
        assistants={[assistant]}
        activeAssistantId={assistant.id}
        modelPicker={<span data-test-model-picker>picker</span>}
        sidebarVisible
        onSelectAssistant={() => undefined}
        onToggleSidebar={() => undefined}
        onOpenSettings={() => undefined}
      />
    )

    expect(markup).toContain('data-assistant-model-picker')
    expect(markup).toContain('data-test-model-picker')
    expect(markup).not.toContain('assistant-header-model-pill')
  })
})
