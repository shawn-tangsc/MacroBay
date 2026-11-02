// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'

import { agentText } from '../agentText'

import AgentSearchModal from './AgentSearchModal'

/**
 * 这处弹窗迁到共享 `Modal` 骨架后补的守卫。
 *
 * 判据只有三条，都是调用点自己的义务——骨架的能力由 `platform/ui/components/modal` 的用例管：
 * ① 标题给的是**键**，屏幕上要是**句子**（`resolveText` 接错了就会露出键名或空标题）；
 * ② 宽度是档位 `expanded`（720），不是调用点传的数字；
 * ③ 没有页脚（`footer` 不传即不渲染），关闭键由骨架内置、点它回调到 `onClose`。
 */

/** 搜索框在无关键词时列表为空；空 store 足够，不伪造数据。 */
const EMPTY_STATE = { agents: [], sessions: [] } as unknown as AgentStoreState

const ZH = agentText['zh-CN']

let root: Root | undefined
let container: HTMLElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function renderModal(onClose = vi.fn()): Promise<{ onClose: ReturnType<typeof vi.fn> }> {
  await act(async () => {
    root = createRoot(container)
    root.render(
      createElement(AgentSearchModal, {
        open: true,
        state: EMPTY_STATE,
        onClose,
        onSelectAgent: vi.fn(),
        onSelectSession: vi.fn()
      })
    )
  })
  return { onClose }
}

function dialog(): HTMLElement {
  const node = document.querySelector<HTMLElement>('.ant-modal')
  if (!node) throw new Error('dialog did not render')
  return node
}

describe('AgentSearchModal on the shared modal', () => {
  it('shows the sentence the caller resolved, never the key it passed', async () => {
    await renderModal()
    expect(dialog().textContent).toContain(ZH.search.title)
    expect(dialog().textContent).not.toContain('agents.search.title')
  })

  it('takes its width from the expanded tier, not from a number at the call site', async () => {
    await renderModal()
    expect(dialog().style.width).toBe('720px')
  })

  it('renders no footer, and its close control reports back to onClose', async () => {
    const { onClose } = await renderModal()
    expect(dialog().querySelector('.ant-modal-footer')).toBeNull()
    // 空 store ⇒ 既没有结果行也没有页脚按钮。
    expect(dialog().querySelectorAll('button')).toHaveLength(1)

    const close = dialog().querySelector<HTMLButtonElement>('.ant-modal-close')
    if (!close) throw new Error('close control missing')
    await act(async () => close.click())
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
