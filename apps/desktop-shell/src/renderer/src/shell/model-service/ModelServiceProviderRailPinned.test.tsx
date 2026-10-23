// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import { platformText } from '../../i18n/platformText'

import { ModelServiceProviderRail } from './ModelServiceProviderRail'

/**
 * PLAT-62 追加：左栏最顶部「已启用」快捷分组（pinned）。
 * 与分类组**重复展示**（不是搬走）；组内先按分类顺序聚拢、再保持源顺序；
 * 空/无命中不渲染；可折叠（内存态）；同一个 provider 的两份副本共享选中态。
 */
const labels = platformText['en-US'].models

type Fixture = Pick<SafeModelProvider, 'id' | 'name' | 'enabled'>

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function mountRail(props: {
  providers: Fixture[]
  search?: string
  selectedProviderId?: string | null
  onSelect?: (providerId: string) => void
}): Promise<HTMLElement> {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(ModelServiceProviderRail, {
      labels,
      providers: props.providers as unknown as SafeModelProvider[],
      totalProviderCount: props.providers.length,
      selectedProviderId: props.selectedProviderId ?? null,
      search: props.search ?? '',
      onSearchChange: () => undefined,
      onSelect: props.onSelect ?? (() => undefined),
      onAdd: () => undefined
    }))
  })
  return container
}

function headerIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-provider-group-header]')]
    .map((header) => header.getAttribute('data-provider-group') ?? '')
}

function groupRows(container: HTMLElement, groupId: string): string[] {
  return [...container.querySelectorAll(`[data-provider-group="${groupId}"] [data-provider-row]`)]
    .map((row) => row.getAttribute('data-provider-row') ?? '')
}

function groupCount(container: HTMLElement, groupId: string): string | null {
  return container
    .querySelector(`[data-provider-group-header][data-provider-group="${groupId}"] [data-provider-group-count]`)
    ?.textContent?.trim() ?? null
}

const mixed: Fixture[] = [
  { id: 'silicon', name: 'Silicon', enabled: false },
  { id: 'aihubmix', name: 'AiHubMix', enabled: true },
  { id: 'deepseek', name: 'DeepSeek', enabled: true },
  { id: 'openai', name: 'OpenAI', enabled: false }
]

describe('PLAT-62 已启用置顶分组', () => {
  it('puts a pinned group first and keeps the same providers in their category groups', async () => {
    const container = await mountRail({ providers: mixed })

    // pinned 恒第一；silicon 未启用但「链接 + 规则」都齐 ⇒ 出现在推荐组。
    expect(headerIds(container)[0]).toBe('pinned')
    expect(headerIds(container)).toEqual(['pinned', 'recommended', 'relay', 'domestic', 'international'])
    expect(groupRows(container, 'pinned')).toEqual(['aihubmix', 'deepseek'])
    expect(groupCount(container, 'pinned')).toBe('2')
    expect(groupRows(container, 'recommended')).toEqual(['silicon'])
    // 重复展示：分类组里仍然各有一份（分类组已启用优先、源顺序）。
    expect(groupRows(container, 'relay')).toEqual(['aihubmix', 'silicon'])
    expect(groupRows(container, 'domestic')).toEqual(['deepseek'])
  })

  it('orders pinned rows by provider category order, then source order', async () => {
    const container = await mountRail({
      providers: [
        { id: 'azure-openai', name: 'Azure OpenAI', enabled: true },
        { id: 'aihubmix', name: 'AiHubMix', enabled: true },
        { id: 'new-api', name: 'New API', enabled: true },
        { id: 'deepseek', name: 'DeepSeek', enabled: true }
      ]
    })

    // 都是已启用 ⇒ 推荐档次（此处无）之后按源顺序，不再按分类聚拢。
    expect(groupRows(container, 'pinned')).toEqual(['azure-openai', 'aihubmix', 'new-api', 'deepseek'])
  })

  it('does not render the pinned group when nothing is enabled', async () => {
    const container = await mountRail({
      providers: [
        { id: 'aihubmix', name: 'AiHubMix', enabled: false },
        { id: 'deepseek', name: 'DeepSeek', enabled: false }
      ]
    })

    // 没有已启用项 ⇒ pinned 不渲染；两者都没有邀请规则 ⇒ 推荐也不渲染。
    expect(headerIds(container)).toEqual(['relay', 'domestic'])
    expect(headerIds(container)).not.toContain('pinned')
  })

  it('keeps the pinned group for a search hit and counts only the hits', async () => {
    const container = await mountRail({
      providers: [{ id: 'deepseek', name: 'DeepSeek', enabled: true }],
      search: 'de'
    })

    expect(headerIds(container)).toEqual(['pinned', 'domestic'])
    expect(groupCount(container, 'pinned')).toBe('1')
    expect(groupRows(container, 'pinned')).toEqual(['deepseek'])
  })

  it('selects the provider from a pinned row and marks every copy active', async () => {
    const selected: string[] = []
    const container = await mountRail({
      providers: mixed,
      selectedProviderId: 'aihubmix',
      onSelect: (providerId) => selected.push(providerId)
    })

    // aihubmix 已启用但不在推荐链接里 ⇒ pinned / relay 两处副本。
    const copies = container.querySelectorAll('[data-provider-row="aihubmix"]')
    expect(copies).toHaveLength(2)
    for (const copy of copies) {
      expect(copy.className).toContain('active')
      expect(copy.getAttribute('aria-current')).toBe('true')
    }
    expect(container.querySelectorAll('.model-service-rail-row.active')).toHaveLength(2)

    await act(async () => container
      .querySelector<HTMLElement>('[data-provider-group="pinned"] [data-provider-row="aihubmix"]')
      ?.click())
    expect(selected).toEqual(['aihubmix'])
  })

  it('collapses the pinned group without touching the category groups', async () => {
    const container = await mountRail({ providers: mixed })
    const header = container.querySelector<HTMLElement>('[data-provider-group-header][data-provider-group="pinned"]')
    expect(header?.getAttribute('aria-expanded')).toBe('true')

    await act(async () => header?.click())
    expect(groupRows(container, 'pinned')).toEqual([])
    expect(header?.getAttribute('aria-expanded')).toBe('false')
    expect(groupRows(container, 'domestic')).toEqual(['deepseek'])
    expect(groupRows(container, 'relay')).toEqual(['aihubmix', 'silicon'])

    await act(async () => header?.click())
    expect(groupRows(container, 'pinned')).toEqual(['aihubmix', 'deepseek'])
  })
})
