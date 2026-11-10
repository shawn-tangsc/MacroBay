// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

// 静态宿主不挂真 toast；这里只验发送键行为。
vi.mock('@platform/ui/components/toast', () => ({
  useToast: () => ({ success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() })
}))

import { platformText } from '../../i18n/platformText'
import { AssistantChatPane } from './AssistantChatPane'

const labels = platformText['zh-CN'].assistants

type SendShortcut = 'enter' | 'mod-enter'

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  container?.remove()
  container = undefined
})

/** 与页面层传下来的形状一致：`chatSettings` 就是 `settings.chat` 的窄化。 */
function paneProps(sendShortcut: SendShortcut, onSend: () => void): Parameters<typeof AssistantChatPane>[0] {
  return {
    labels,
    topic: null,
    messages: [],
    streamSnapshot: null,
    draft: 'hello',
    isSending: false,
    assistantSelected: true,
    composerEnabled: true,
    modelReady: true,
    statusMessage: null,
    confirmDeleteMessage: false,
    chatSettings: { fontSize: 14, messageStyle: 'plain', narrowMode: false, sendShortcut },
    onDraftChange: () => undefined,
    onSend,
    onStop: () => undefined,
    onToolAction: () => undefined,
    onOpenSettings: () => undefined,
    onSelectSibling: () => undefined,
    onDeleteMessage: () => undefined,
    onRegenerate: () => undefined,
    onEditResend: () => undefined,
    onSearch: () => undefined,
    imageGeneration: {
      target: null,
      editTarget: null,
      isGenerating: false,
      errorText: null,
      onGenerate: async () => false,
      onEdit: async () => false
    },
    sessionImages: [],
    pendingImage: null,
    mentionedModels: [],
    modelOptions: [],
    onToggleMentionedModel: () => undefined,
    onClearMentionedModels: () => undefined,
    onRequireTopic: () => undefined,
    onRequireModel: () => undefined
  }
}

async function mount(sendShortcut: SendShortcut, onSend: () => void): Promise<HTMLTextAreaElement> {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(<AssistantChatPane {...paneProps(sendShortcut, onSend)} />))
  const textarea = container.querySelector('textarea')
  if (!textarea) throw new Error('the assistant inputbar rendered no textarea')
  return textarea
}

async function changeSetting(sendShortcut: SendShortcut, onSend: () => void): Promise<HTMLTextAreaElement> {
  await act(async () => root?.render(<AssistantChatPane {...paneProps(sendShortcut, onSend)} />))
  const textarea = container?.querySelector('textarea')
  if (!textarea) throw new Error('the assistant inputbar rendered no textarea')
  return textarea
}

async function press(textarea: HTMLTextAreaElement, init: KeyboardEventInit): Promise<void> {
  await act(async () => {
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }))
  })
}

describe('assistant inputbar reads the shared send shortcut', () => {
  it('follows settings.chat.sendShortcut and flips back when the setting flips back', async () => {
    const onSend = vi.fn()

    // 1) 平台设置是 `mod-enter`：裸 Enter 不发送，Cmd/Ctrl+Enter 才发送。
    let textarea = await mount('mod-enter', onSend)
    await press(textarea, {})
    expect(onSend).toHaveBeenCalledTimes(0)
    await press(textarea, { metaKey: true })
    expect(onSend).toHaveBeenCalledTimes(1)

    // 2) 设置改成 `enter`：同一份 chatSettings 变，助手面立刻跟着变。
    textarea = await changeSetting('enter', onSend)
    await press(textarea, {})
    expect(onSend).toHaveBeenCalledTimes(2)

    // 3) 再改回 `mod-enter`：裸 Enter 又不发送（对偶）。
    textarea = await changeSetting('mod-enter', onSend)
    await press(textarea, {})
    expect(onSend).toHaveBeenCalledTimes(2)
    await press(textarea, { ctrlKey: true })
    expect(onSend).toHaveBeenCalledTimes(3)
  })

  it('never sends on Shift+Enter, whatever the setting', async () => {
    const onSend = vi.fn()
    let textarea = await mount('enter', onSend)
    await press(textarea, { shiftKey: true })
    expect(onSend).toHaveBeenCalledTimes(0)

    textarea = await changeSetting('mod-enter', onSend)
    await press(textarea, { shiftKey: true })
    expect(onSend).toHaveBeenCalledTimes(0)
  })
})
