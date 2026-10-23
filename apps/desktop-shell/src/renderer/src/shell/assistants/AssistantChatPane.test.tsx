import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { platformText } from '../../i18n/platformText'

import { AssistantChatPane } from './AssistantChatPane'

describe('AssistantChatPane', () => {
  it('shows the start-conversation empty state when an assistant is selected but no topic exists yet', () => {
    const labels = platformText['zh-CN'].assistants
    const markup = renderToStaticMarkup(
      <AssistantChatPane
        labels={labels}
        topic={null}
        messages={[]}
        streamSnapshot={null}
        draft=""
        isSending={false}
        assistantSelected
        composerEnabled
        modelReady
        statusMessage={null}
        confirmDeleteMessage={false}
        chatSettings={null}
        onDraftChange={() => undefined}
        onSend={() => undefined}
        onStop={() => undefined}
        onToolAction={() => undefined}
        onOpenSettings={() => undefined}
        onSelectSibling={() => undefined}
        onDeleteMessage={() => undefined}
        onRegenerate={() => undefined}
        onEditResend={() => undefined}
        onSearch={() => undefined}
        imageGeneration={{
          target: null,
          editTarget: null,
          isGenerating: false,
          errorText: null,
          onGenerate: async () => false,
          onEdit: async () => false
        }}
        sessionImages={[]}
        pendingImage={null}
        mentionedModels={[]}
        modelOptions={[]}
        onToggleMentionedModel={() => undefined}
        onClearMentionedModels={() => undefined}
      />
    )

    expect(markup).toContain(labels.startConversation)
    expect(markup).not.toContain(labels.selectTopic)
  })

  it('renders a generated image card at the end of the message list', () => {
    const labels = platformText['zh-CN'].assistants
    const markup = renderToStaticMarkup(
      <AssistantChatPane
        labels={labels}
        topic={null}
        messages={[]}
        streamSnapshot={null}
        draft=""
        isSending={false}
        assistantSelected
        composerEnabled
        modelReady
        statusMessage={null}
        confirmDeleteMessage={false}
        chatSettings={null}
        onDraftChange={() => undefined}
        onSend={() => undefined}
        onStop={() => undefined}
        onToolAction={() => undefined}
        onOpenSettings={() => undefined}
        onSelectSibling={() => undefined}
        onDeleteMessage={() => undefined}
        onRegenerate={() => undefined}
        onEditResend={() => undefined}
        onSearch={() => undefined}
        imageGeneration={{
          target: null,
          editTarget: null,
          isGenerating: false,
          errorText: null,
          onGenerate: async () => false,
          onEdit: async () => false
        }}
        sessionImages={[]}
        pendingImage={{ id: 'image-1', createdAt: 1_700_000_000_000, kind: 'generate', prompt: '一只狐狸' }}
        mentionedModels={[]}
        modelOptions={[]}
        onToggleMentionedModel={() => undefined}
        onClearMentionedModels={() => undefined}
      />
    )

    expect(markup).toContain('data-generated-image-status="pending"')
    expect(markup).toContain(labels.imageGenerating)
  })

  it('applies shared chat display settings to assistant messages', () => {
    const labels = platformText['zh-CN'].assistants
    const markup = renderToStaticMarkup(
      <AssistantChatPane
        labels={labels}
        topic={{
          id: 'topic-1',
          assistantId: 'assistant-1',
          name: '话题',
          activeNodeId: null,
          isNameManuallyEdited: false,
          orderKey: '001',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }}
        messages={[]}
        streamSnapshot={null}
        draft=""
        isSending={false}
        assistantSelected
        composerEnabled
        modelReady
        statusMessage={null}
        confirmDeleteMessage={false}
        chatSettings={{ fontSize: 18, messageStyle: 'bubble', narrowMode: true }}
        onDraftChange={() => undefined}
        onSend={() => undefined}
        onStop={() => undefined}
        onToolAction={() => undefined}
        onOpenSettings={() => undefined}
        onSelectSibling={() => undefined}
        onDeleteMessage={() => undefined}
        onRegenerate={() => undefined}
        onEditResend={() => undefined}
        onSearch={() => undefined}
        imageGeneration={{
          target: null,
          editTarget: null,
          isGenerating: false,
          errorText: null,
          onGenerate: async () => false,
          onEdit: async () => false
        }}
        sessionImages={[]}
        pendingImage={null}
        mentionedModels={[]}
        modelOptions={[]}
        onToggleMentionedModel={() => undefined}
        onClearMentionedModels={() => undefined}
      />
    )

    expect(markup).toContain('class="assistant-message-list bubble narrow"')
    expect(markup).toContain('--chat-message-font-size:18px')
  })
})
