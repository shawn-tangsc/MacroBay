// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { AssistantTemplateDetail } from '@platform/ai/assistant-platform/library/assistantTemplateSchemas'
import { ToastHost } from '@platform/ui/components/toast'

import { platformText } from '../../../i18n/platformText'
import { AssistantTemplateDetailDialog } from './AssistantTemplateDetailDialog'
import { CreateAssistantDialog } from './CreateAssistantDialog'
import { ImportAssistantDialog } from './ImportAssistantDialog'

/**
 * 三个助手库弹窗的标题都从键解析（模板详情那处还有运行时名字与回落键两态）。
 * 断言渲染值，不是「文字在页面上」——键写错时标题渲染成空串，包含式断言发现不了。
 */

const labels = platformText['zh-CN'].assistants.library

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function mount(node: React.ReactElement): Promise<void> {
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    // 导入弹窗迁到 `useToast` 后要宿主；`useToast` 是 fail-closed，没有宿主直接抛。
    root!.render(<ToastHost>{node}</ToastHost>)
  })
  await act(async () => {
    await Promise.resolve()
  })
}

function title(): string | null {
  return document.querySelector('.ant-modal-title')?.textContent ?? null
}

describe('助手库弹窗的标题', () => {
  it('resolves the create dialog title from its key', async () => {
    await mount(<CreateAssistantDialog labels={labels} open onClose={() => undefined} onCreate={async () => undefined} />)

    expect(title()).toBe(labels.createTitle)
  })

  it('resolves the import dialog title from its key', async () => {
    await mount(<ImportAssistantDialog labels={labels} open onClose={() => undefined} onImport={async () => undefined} />)

    expect(title()).toBe(labels.importTitle)
  })

  it('shows the template name when one is loaded and falls back to the key sentence when it is not', async () => {
    const template = {
      templateId: 'template-1',
      name: '研究助手',
      icon: 'R',
      description: '整理研究材料',
      promptPreview: '整理研究材料',
      prompt: '整理研究材料',
      tags: [],
      sourceKind: 'platform',
      installed: false
    } as unknown as AssistantTemplateDetail
    await mount(
      <AssistantTemplateDetailDialog
        labels={labels}
        template={template}
        open
        installing={false}
        onClose={() => undefined}
        onInstall={() => undefined}
      />
    )
    expect(title()).toBe('研究助手')

    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()

    await mount(
      <AssistantTemplateDetailDialog
        labels={labels}
        template={null}
        open
        installing={false}
        onClose={() => undefined}
        onInstall={() => undefined}
      />
    )
    expect(title()).toBe(labels.title)
  })
})
