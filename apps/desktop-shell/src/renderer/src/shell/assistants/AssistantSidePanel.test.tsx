// @vitest-environment happy-dom

import { act, createElement, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { platformText } from '../../i18n/platformText'
import type { AssistantEntity } from '@platform/ai/assistant-platform/schemas/assistantSchemas'
import type { AssistantTopicEntity } from '@platform/ai/assistant-platform/schemas/topicSchemas'

import { AssistantSidePanel } from './AssistantSidePanel'

const modal = vi.hoisted(() => ({ confirm: vi.fn() }))

vi.mock('antd', () => ({
  Button: ({
    children,
    icon,
    onClick,
    ...props
  }: {
    children?: ReactNode
    icon?: ReactNode
    onClick?: (event: { stopPropagation: () => void }) => void
  }) =>
    createElement('button', { ...props, onClick }, icon, children),
  Dropdown: ({
    children,
    menu,
    trigger
  }: {
    children?: ReactNode
    trigger?: string[]
    menu?: {
      items?: Array<{ key: string; label: ReactNode; disabled?: boolean }>
      onClick?: (info: { key: string }) => void
    }
  }) => {
    const [open, setOpen] = useState(false)
    const opensOnClick = trigger?.includes('click')
    const opensOnContextMenu = trigger?.includes('contextMenu')
    return createElement(
      'div',
      {
        'data-dropdown-trigger': trigger?.join(','),
        onClickCapture: opensOnClick ? () => setOpen(true) : undefined,
        onContextMenu: opensOnContextMenu ? () => setOpen(true) : undefined
      },
      children,
      open
        ? menu?.items?.map((item) =>
            createElement(
              'button',
              {
                key: item.key,
                'data-menu-item': item.key,
                disabled: item.disabled,
                onClick: () => menu.onClick?.({ key: item.key })
              },
              item.label
            )
          )
        : null
    )
  },
  Modal: { confirm: modal.confirm }
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.replaceChildren()
  modal.confirm.mockReset()
})

const timestamp = '2026-07-11T00:00:00.000Z'

describe('AssistantSidePanel', () => {
  it('renders assistant and topic tabs instead of stacking both lists together', () => {
    const labels = platformText['zh-CN'].assistants
    const markup = renderToStaticMarkup(
      <AssistantSidePanel
        labels={labels}
        assistants={[assistant('assistant-1', '商业数据分析'), assistant('assistant-2', '产品经理')]}
        topics={[topic('topic-1', 'BTC 复盘'), topic('topic-2', 'ETH 复盘')]}
        activeAssistantId="assistant-1"
        activeTopicId="topic-1"
        activeTab="assistants"
        onSelectAssistant={() => undefined}
        onSelectTopic={() => undefined}
        onCreateAssistant={() => undefined}
        onCreateTopic={() => undefined}
        onTabChange={() => undefined}
      />
    )

    expect(markup).toContain('role="tablist"')
    expect(markup).toContain('>助手<')
    expect(markup).toContain('>话题<')
    expect(markup).toContain('添加助手')
    expect(markup).toContain('商业数据分析')
    expect(markup).not.toContain('BTC 复盘')
  })

  it('exposes the delete-conversation context menu and keyboard alternative only on the topics tab', () => {
    const labels = platformText['en-US'].assistants
    const topicsMarkup = renderToStaticMarkup(
      <AssistantSidePanel
        labels={labels}
        assistants={[assistant('assistant-1', 'Assistant')]}
        topics={[topic('topic-1', 'Conversation')]}
        activeAssistantId="assistant-1"
        activeTopicId="topic-1"
        activeTab="topics"
        onSelectAssistant={() => undefined}
        onSelectTopic={() => undefined}
        onCreateAssistant={() => undefined}
        onCreateTopic={() => undefined}
        onDeleteTopic={async () => undefined}
        onTabChange={() => undefined}
      />
    )
    const assistantsMarkup = renderToStaticMarkup(
      <AssistantSidePanel
        labels={labels}
        assistants={[assistant('assistant-1', 'Assistant')]}
        topics={[topic('topic-1', 'Conversation')]}
        activeAssistantId="assistant-1"
        activeTopicId="topic-1"
        activeTab="assistants"
        onSelectAssistant={() => undefined}
        onSelectTopic={() => undefined}
        onCreateAssistant={() => undefined}
        onCreateTopic={() => undefined}
        onDeleteTopic={async () => undefined}
        onTabChange={() => undefined}
      />
    )

    expect(topicsMarkup).toContain('Delete conversation')
    expect(topicsMarkup).toContain('More conversation actions')
    expect(assistantsMarkup).not.toContain('More conversation actions')
  })

  it('dispatches the more-menu delete action through Dropdown and suppresses duplicate confirmation submits', async () => {
    const labels = platformText['en-US'].assistants
    const onSelectTopic = vi.fn()
    let resolveDelete: (() => void) | undefined
    const onDeleteTopic = vi.fn(
      () => new Promise<void>((resolve) => {
        resolveDelete = resolve
      })
    )
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <AssistantSidePanel
          labels={labels}
          assistants={[assistant('assistant-1', 'Assistant')]}
          topics={[topic('current', 'Current'), topic('other', 'Other')]}
          activeAssistantId="assistant-1"
          activeTopicId="current"
          activeTab="topics"
          onSelectAssistant={() => undefined}
          onSelectTopic={onSelectTopic}
          onCreateAssistant={() => undefined}
          onCreateTopic={() => undefined}
          onDeleteTopic={onDeleteTopic}
          onTabChange={() => undefined}
        />
      )
    })

    const otherRow = [...container.querySelectorAll('.assistant-side-panel-item')].find((row) => row.textContent?.includes('Other'))
    const moreButton = otherRow?.querySelector<HTMLButtonElement>('[aria-label="More conversation actions"]')
    await act(async () => moreButton?.click())
    expect(onSelectTopic).not.toHaveBeenCalled()

    await act(async () => {
      const moreMenu = otherRow?.querySelector<HTMLElement>('[data-dropdown-trigger="click"]')
      const deleteButton = moreMenu?.querySelector<HTMLButtonElement>('[data-menu-item="delete"]')
      deleteButton?.click()
    })
    expect(modal.confirm).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ title: 'Delete conversation', content: expect.stringContaining('Other') })
    )

    const confirmation = modal.confirm.mock.calls[0]?.[0] as { onOk: () => Promise<void> }
    let firstSubmit: Promise<void> | undefined
    let duplicateSubmit: Promise<void> | undefined
    await act(async () => {
      firstSubmit = confirmation.onOk()
      duplicateSubmit = confirmation.onOk()
      expect(onDeleteTopic).toHaveBeenCalledExactlyOnceWith('other')
      resolveDelete?.()
      await firstSubmit
      await duplicateSubmit
    })
    expect(onSelectTopic).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })

  it('dispatches the right-click delete action without switching the current topic', async () => {
    const labels = platformText['en-US'].assistants
    const onSelectTopic = vi.fn()
    const onDeleteTopic = vi.fn(async () => undefined)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <AssistantSidePanel
          labels={labels}
          assistants={[assistant('assistant-1', 'Assistant')]}
          topics={[topic('current', 'Current'), topic('other', 'Other')]}
          activeAssistantId="assistant-1"
          activeTopicId="current"
          activeTab="topics"
          onSelectAssistant={() => undefined}
          onSelectTopic={onSelectTopic}
          onCreateAssistant={() => undefined}
          onCreateTopic={() => undefined}
          onDeleteTopic={onDeleteTopic}
          onTabChange={() => undefined}
        />
      )
    })

    const otherRow = [...container.querySelectorAll('.assistant-side-panel-item')].find((row) => row.textContent?.includes('Other'))
    await act(async () => {
      otherRow?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })

    await act(async () => {
      const contextMenu = [...container.querySelectorAll<HTMLElement>('[data-dropdown-trigger="contextMenu"]')].find((dropdown) =>
        dropdown.querySelector('.assistant-side-panel-item')?.textContent?.includes('Other')
      )
      const deleteButton = [...(contextMenu?.children ?? [])].find((child) => child.matches('[data-menu-item="delete"]'))
      ;(deleteButton as HTMLButtonElement | undefined)?.click()
    })

    expect(onSelectTopic).not.toHaveBeenCalled()
    expect(modal.confirm).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ title: 'Delete conversation', content: expect.stringContaining('Other') })
    )
    const confirmation = modal.confirm.mock.calls[0]?.[0] as { onOk: () => Promise<void> }
    await act(async () => confirmation.onOk())
    expect(onDeleteTopic).toHaveBeenCalledExactlyOnceWith('other')
    expect(onSelectTopic).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })
})

function assistant(id: string, name: string): AssistantEntity {
  return {
    id,
    name,
    prompt: '你是一个乐于助人的助手。',
    icon: '💬',
    description: '',
    settings: {
      temperature: 0.7,
      enableTemperature: false,
      topP: 1,
      enableTopP: false,
      maxTokens: 4096,
      enableMaxTokens: false,
      streamOutput: true,
      reasoningEffort: '',
      mcpMode: 'disabled',
      maxToolCalls: 20,
      enableMaxToolCalls: false,
      enableWebSearch: false,
      customParameters: []
    },
    modelId: null,
    modelName: null,
    mcpServerIds: [],
    contextSourceIds: [],
    tags: [],
    orderKey: id,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}

function topic(id: string, name: string): AssistantTopicEntity {
  return {
    id,
    assistantId: 'assistant-1',
    name,
    isNameManuallyEdited: false,
    activeNodeId: null,
    orderKey: id,
    createdAt: timestamp,
    updatedAt: timestamp
  }
}
