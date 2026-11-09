// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ProductAgentToolPackageEditorView } from '@platform/ai/agent-platform/productTools/productAgentToolViewModel'

import { agentText } from '../../../agentText'
import { AgentTextProvider } from '../../../agentTextProvider'
import { ProductToolPackagesCatalog } from './ProductToolPackagesCatalog'

const text = agentText['zh-CN']

function tool(
  toolName: string,
  title: string,
  options: { readOnly?: boolean; asOf?: boolean } = {}
): ProductAgentToolPackageEditorView['tools'][number] {
  return {
    toolName,
    title: { 'zh-CN': title, 'en-US': title },
    description: '模型侧长指令，不应出现在列表里。',
    readOnly: options.readOnly ?? true,
    requiresTemporalBoundary: options.asOf ?? false,
    schemaVersion: 1,
    requiresApproval: options.readOnly === false ? 'always' : 'never'
  }
}

function packageFixture(
  overrides: Partial<ProductAgentToolPackageEditorView> = {}
): ProductAgentToolPackageEditorView {
  return {
    productId: 'sample-product',
    status: 'available',
    permissionMode: 'disabled',
    staleBinding: false,
    diagnostics: [],
    tools: [
      tool('get_context_sample', '示例上下文', { asOf: true }),
      tool('configure_sample_source', '修改示例来源配置', { readOnly: false }),
      ...Array.from({ length: 8 }, (_, index) =>
        tool(`get_sample_${index}`, `示例工具 ${index}`, { asOf: index === 0 })
      )
    ],
    ...overrides
  }
}

let root: Root | undefined

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('ProductToolPackagesCatalog', () => {
  it('labels tools with their localized title and keeps the raw tool name as context', async () => {
    stubPlatform([packageFixture()])
    const container = await mount({ search: '' })

    expect(container.textContent).toContain('示例产品')
    // 内部包名不再印在卡片上（产品 2026-11-09）；「不出现」由下面两条专门的用例判，
    // 这里只保留工具行的判据——同一事实不在两处重复断言。
    expect(container.textContent).toContain('示例上下文')
    expect(container.textContent).toContain('get_context_sample')
    expect(container.textContent).toContain('修改示例来源配置')
    expect(container.textContent).toContain('可写')
    expect(container.textContent).toContain('可用')
  })

  it('summarizes the package instead of repeating the model-facing description', async () => {
    stubPlatform([packageFixture()])
    const container = await mount({ search: '' })

    expect(container.querySelector('.agent-product-summary')?.textContent)
      .toBe('10 个工具 · 9 个只读 · 1 个可写 · 2 个需要 asOf')
    expect(container.textContent).not.toContain('模型侧长指令')
  })

  it('explains that a disabled package is invisible to the agent', async () => {
    stubPlatform([packageFixture()])
    const container = await mount({ search: '' })

    expect(container.querySelector('.agent-product-note')?.textContent).toContain('已禁用')
  })

  it('shows eight tools first and reveals the rest on demand', async () => {
    stubPlatform([packageFixture()])
    const container = await mount({ search: '' })

    expect(rows(container)).toHaveLength(8)
    const toggle = container.querySelector<HTMLButtonElement>('.agent-product-tools-more')
    expect(toggle?.textContent).toContain('展开全部 10 个工具')

    await act(async () => toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(rows(container)).toHaveLength(10)
    expect(container.querySelector('.agent-product-tools-more')?.textContent).toContain('收起')
  })

  it('narrows the table to the matching tools while a search query is active', async () => {
    stubPlatform([packageFixture()])
    const container = await mount({ search: '示例工具' })

    expect(container.querySelector('.agent-product-tools-more')).toBeNull()
    expect(rows(container)).toHaveLength(8)
  })

  it('finds a tool by its raw name even when the product does not match', async () => {
    stubPlatform([packageFixture()])
    const container = await mount({ search: 'configure_sample_source' })

    expect(rows(container)).toHaveLength(1)
    expect(container.textContent).toContain('修改示例来源配置')
  })

  it('never shows the internal package id: a name-less package gets a neutral word', async () => {
    // 产品口径（2026-11-09）：产品包名是**身份**不是技术引用——读者拿着 `sample-product`
    // 做不了任何事，复制到别处没人认，报障时日志里本来就有。没有名字就显示中性词，
    // **绝不把内部 slug 顶上去**；悬停露出也算露出，所以 `title` 也不许带它。
    stubPlatform([packageFixture()], { withProductSummaries: false })
    const container = await mount({ search: '' })

    expect(container.textContent).not.toContain('sample-product')
    expect(container.querySelector('.agent-product-package-name')?.textContent).toContain('未命名工具包')
    expect(container.querySelector('.agent-product-package-id')).toBeNull()
    // 悬停提示也会露出来，所以整张卡片上任何元素都不许把 slug 挂进 title。
    for (const element of container.querySelectorAll('[title]')) {
      expect(element.getAttribute('title')).not.toContain('sample-product')
    }
  })

  it('shows the product name and still does not print the package id next to it', async () => {
    stubPlatform([packageFixture()])
    const container = await mount({ search: '' })

    const name = container.querySelector('.agent-product-package-name')
    expect(name?.textContent).toContain('示例产品')
    expect(container.textContent).not.toContain('sample-product')
    expect(container.querySelector('.agent-product-package-id')).toBeNull()
  })
})

async function mount({ search }: { search: string }): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(
      <AgentTextProvider language="zh-CN">
        <ProductToolPackagesCatalog text={text} agentId="agent-1" search={search} onClearSearch={() => undefined} />
      </AgentTextProvider>
    )
  })
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  return container
}

function rows(container: HTMLElement): Element[] {
  return [...container.querySelectorAll('.agent-product-tools tbody tr')]
}

function stubPlatform(
  packages: ProductAgentToolPackageEditorView[],
  { withProductSummaries = true }: { withProductSummaries?: boolean } = {}
): void {
  Object.assign(window, {
    platform: {
      agents: {
        productTools: {
          listPackages: vi.fn(async () => packages),
          updatePackageBinding: vi.fn(async () => [])
        }
      },
      app: withProductSummaries
        ? {
            getProductSummaries: vi.fn(async () => [
              { id: 'sample-product', name: { 'zh-CN': '示例产品', 'en-US': 'Sample product' } }
            ])
          }
        : {}
    }
  })
}
