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

const KEYS = {
  Enter: {},
  'Shift+Enter': { shiftKey: true },
  'Ctrl+Enter': { ctrlKey: true },
  'Cmd+Enter': { metaKey: true }
} as const satisfies Record<string, KeyboardEventInit>

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

async function press(textarea: HTMLTextAreaElement, init: KeyboardEventInit): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init })
  await act(async () => {
    textarea.dispatchEvent(event)
  })
  return event
}

/**
 * 一次按键只允许两种结局：**发送**（阻止默认 + 调一次 onSend）或**换行**（不阻止默认，
 * 输入框自己插入换行）。第三种——阻止了默认却没发送——就是「按了没反应」，必须红。
 */
function outcomeOf(event: KeyboardEvent, onSend: ReturnType<typeof vi.fn>): 'send' | 'newline' | 'swallowed' | 'send-and-newline' {
  const sent = onSend.mock.calls.length > 0
  if (sent) return event.defaultPrevented ? 'send' : 'send-and-newline'
  return event.defaultPrevented ? 'swallowed' : 'newline'
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

  /**
   * 每档 × 四种键组合 = 8 次按键，每次都必须落到「发送」或「换行」。
   * `happy-dom` 没有排版/编辑引擎，不会真往 textarea 里插 `\n`，所以「换行」用
   * **未阻止默认** 表示——那正是浏览器插入换行的前提；阻止了却没发送才是被吞掉。
   */
  it.each([
    { setting: 'enter', keys: 'Enter', outcome: 'send' },
    { setting: 'enter', keys: 'Shift+Enter', outcome: 'newline' },
    { setting: 'enter', keys: 'Ctrl+Enter', outcome: 'newline' },
    { setting: 'enter', keys: 'Cmd+Enter', outcome: 'newline' },
    { setting: 'mod-enter', keys: 'Enter', outcome: 'newline' },
    { setting: 'mod-enter', keys: 'Shift+Enter', outcome: 'newline' },
    { setting: 'mod-enter', keys: 'Ctrl+Enter', outcome: 'send' },
    { setting: 'mod-enter', keys: 'Cmd+Enter', outcome: 'send' }
  ] as const)('$setting 档 · $keys → 只能是「发送」或「换行」', async ({ setting, keys, outcome }) => {
    const onSend = vi.fn()
    const textarea = await mount(setting, onSend)
    const event = await press(textarea, KEYS[keys])
    expect(outcomeOf(event, onSend)).toBe(outcome)
  })
})
