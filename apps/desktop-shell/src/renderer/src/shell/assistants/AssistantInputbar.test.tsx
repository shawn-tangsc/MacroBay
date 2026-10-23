import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { platformText } from '../../i18n/platformText'

import { AssistantInputbar } from './AssistantInputbar'

describe('AssistantInputbar', () => {
  it('keeps mentioned model options behind a picker instead of rendering every model as a visible button chip', () => {
    const labels = platformText['zh-CN'].assistants
    const markup = renderToStaticMarkup(
      <AssistantInputbar
        labels={labels}
        draft=""
        isSending={false}
        isStreaming={false}
        modelReady
        topicSelected
        mentionedModels={[]}
        imageGeneration={{
          target: null,
          editTarget: null,
          isGenerating: false,
          errorText: null,
          onGenerate: async () => false,
          onEdit: async () => false
        }}
        sessionImages={[]}
        modelOptions={[
          { value: 'openai:gpt-a', label: 'OpenAI / GPT A', providerId: 'openai', modelId: 'gpt-a' },
          { value: 'anthropic:claude', label: 'Anthropic / Claude', providerId: 'anthropic', modelId: 'claude' }
        ]}
        onDraftChange={() => undefined}
        onSend={() => undefined}
        onStop={() => undefined}
        onToolAction={() => undefined}
        onOpenSettings={() => undefined}
        onToggleMentionedModel={() => undefined}
        onClearMentionedModels={() => undefined}
      />
    )

    expect(markup).not.toContain('OpenAI / GPT A')
    expect(markup).not.toContain('Anthropic / Claude')
  })

  it('does not reuse the settings glyph for both context sources and assistant settings', () => {
    const labels = platformText['zh-CN'].assistants
    const markup = renderToStaticMarkup(
      <AssistantInputbar
        labels={labels}
        draft=""
        isSending={false}
        isStreaming={false}
        modelReady
        topicSelected
        mentionedModels={[]}
        imageGeneration={{
          target: null,
          editTarget: null,
          isGenerating: false,
          errorText: null,
          onGenerate: async () => false,
          onEdit: async () => false
        }}
        sessionImages={[]}
        modelOptions={[]}
        onDraftChange={() => undefined}
        onSend={() => undefined}
        onStop={() => undefined}
        onToolAction={() => undefined}
        onOpenSettings={() => undefined}
        onToggleMentionedModel={() => undefined}
        onClearMentionedModels={() => undefined}
      />
    )

    const settingsGlyphMatches = markup.match(/lucide-settings-2/g) ?? []
    expect(settingsGlyphMatches).toHaveLength(1)
  })
})
