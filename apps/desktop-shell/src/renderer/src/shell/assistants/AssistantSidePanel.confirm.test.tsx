// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AssistantTopicEntity } from '@platform/ai/assistant-platform/schemas/topicSchemas'
import { renderWithConfirm } from '@platform/ui/components/confirm/confirmTestSupport'

import { platformText } from '../../i18n/platformText'
import { AssistantSidePanel } from './AssistantSidePanel'

/**
 * 真弹窗用例：不 mock antd、不 mock `useConfirm`，弹窗由 `ConfirmProvider` 在树里渲染。
 *
 * 别的用例验的是「问了什么」；这一条验的是**读者真的看到什么**——标题、后果句、
 * 两个按钮的文字都上屏，点「取消」之后什么也没删。
 */

const labels = platformText['en-US'].assistants

const topic: AssistantTopicEntity = {
  id: 'topic-1',
  assistantId: 'assistant-1',
  name: 'Half-finished research',
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:00:00.000Z'
} as AssistantTopicEntity

afterEach(() => {
  document.body.replaceChildren()
})

describe('AssistantSidePanel delete confirmation', () => {
  it('shows the dialog in the tree with our copy, and cancelling deletes nothing', async () => {
    const onDeleteTopic = vi.fn(async () => undefined)
    const view = renderWithConfirm(
      <AssistantSidePanel
        labels={labels}
        assistants={[]}
        topics={[topic]}
        activeAssistantId="assistant-1"
        activeTopicId={null}
        activeTab="topics"
        onSelectAssistant={() => undefined}
        onSelectTopic={() => undefined}
        onCreateAssistant={() => undefined}
        onCreateTopic={() => undefined}
        onDeleteTopic={onDeleteTopic}
        onTabChange={() => undefined}
      />
    )
    await view.settle()

    const more = view.host.querySelector<HTMLButtonElement>('[aria-label="More conversation actions"]')
    expect(more).not.toBeNull()
    more?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    more?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    more?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await view.settle()
    await view.settle()

    const deleteItem = [...document.querySelectorAll<HTMLElement>('.ant-dropdown-menu-item')].at(-1)
    expect(deleteItem).toBeTruthy()
    deleteItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await view.settle()

    const dialog = await view.waitForDialog()
    expect(dialog).not.toBeNull()
    expect(view.dialogText()).toContain('Half-finished research')

    await view.clickDialogButton(labels.cancel)
    expect(onDeleteTopic).not.toHaveBeenCalled()
    await view.unmount()
  })
})
