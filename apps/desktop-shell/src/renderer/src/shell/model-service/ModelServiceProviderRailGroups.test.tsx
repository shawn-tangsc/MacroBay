// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import { platformText } from '../../i18n/platformText'

import { ModelServiceProviderRail } from './ModelServiceProviderRail'

/**
 * PLAT-62：左栏按 5 个分组渲染（按「国内站 / 国际站」分，不再拆模型厂/云）。
 * - 组顺序固定（不随启用状态跳动）；组内已启用优先、保持源顺序。
 * - 组头可折叠，折叠状态只在内存里（不写设置）。
 * - 搜索（上游已过滤）后只显示含命中项的组，组头计数＝命中数。
 * - 0 个供应商的组不渲染；未收录 id 归 gateway。
 */
const labels = platformText['en-US'].models

type Fixture = Pick<SafeModelProvider, 'id' | 'name' | 'enabled'>

const groupIds = ['relay', 'domestic', 'international', 'local', 'gateway'] as const

const allGroups: Fixture[] = [
  { id: 'aihubmix', name: 'AiHubMix', enabled: true },
  { id: 'ocoolai', name: 'OcoolAI', enabled: false },
  { id: 'deepseek', name: 'DeepSeek', enabled: true },
  { id: 'zhipu', name: 'Zhipu', enabled: false },
  { id: 'dashscope', name: 'DashScope', enabled: true },
  { id: 'modelscope', name: 'ModelScope', enabled: false },
  { id: 'openai', name: 'OpenAI', enabled: true },
  { id: 'anthropic', name: 'Anthropic', enabled: false },
  { id: 'groq', name: 'Groq', enabled: false },
  { id: 'ollama', name: 'Ollama', enabled: false },
  { id: 'lmstudio', name: 'LM Studio', enabled: true },
  { id: 'new-api', name: 'New API', enabled: false },
  { id: 'acme-custom', name: 'Acme Custom', enabled: true }
]

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
  totalProviderCount?: number
  selectedProviderId?: string | null
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
      totalProviderCount: props.totalProviderCount ?? props.providers.length,
      selectedProviderId: props.selectedProviderId ?? null,
      search: props.search ?? '',
      onSearchChange: () => undefined,
      onSelect: () => undefined,
      onAdd: () => undefined
    }))
  })
  return container
}

function headerIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-provider-group-header]')]
    .map((header) => header.getAttribute('data-provider-group') ?? '')
}

function rowIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-provider-row]')]
    .map((row) => row.getAttribute('data-provider-row') ?? '')
}

/** 五分类组（排除 `pinned` 与 `recommended` 快捷区；两者由各自测试覆盖）。 */
function categoryHeaderIds(container: HTMLElement): string[] {
  return headerIds(container).filter((groupId) => groupId !== 'pinned' && groupId !== 'recommended')
}

function categoryRowIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-provider-row]')]
    .filter((row) => row.closest('[data-provider-group="pinned"]') === null)
    .filter((row) => row.closest('[data-provider-group="recommended"]') === null)
    .map((row) => row.getAttribute('data-provider-row') ?? '')
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

describe('PLAT-62 供应商分组左栏', () => {
  it('renders the five group headers in the fixed order', async () => {
    const container = await mountRail({ providers: allGroups })

    // pinned 恒第一；本轮没有「链接 + 规则」都齐的未启用家 ⇒ 推荐组不渲染。
    expect(headerIds(container)[0]).toBe('pinned')
    expect(headerIds(container)).not.toContain('recommended')
    expect(categoryHeaderIds(container)).toEqual([...groupIds])
    for (const groupId of groupIds) {
      expect(groupCount(container, groupId), `count of ${groupId}`).toBe(
        String(allGroups.filter((provider) => groupIdOf(provider.id) === groupId).length)
      )
    }
  })

  it('keeps enabled providers first inside their own group without mixing groups', async () => {
    const container = await mountRail({ providers: allGroups })

    // domestic / international 源顺序已启用在前；local / gateway 故意源顺序落后。
    expect(categoryRowIds(container)).toEqual([
      'aihubmix',
      'ocoolai',
      'deepseek',
      'dashscope',
      'zhipu',
      'modelscope',
      'openai',
      'anthropic',
      'groq',
      'lmstudio',
      'ollama',
      'acme-custom',
      'new-api'
    ])
    // 已启用的 openai 不会跳到 relay 的 aihubmix 前面（组间不混排）。
    expect(groupRows(container, 'relay')[0]).toBe('aihubmix')
    expect(groupRows(container, 'domestic')).toEqual(['deepseek', 'dashscope', 'zhipu', 'modelscope'])
    expect(groupRows(container, 'local')).toEqual(['lmstudio', 'ollama'])
  })

  it('collapses a group on header click (0 rows) and expands it again', async () => {
    const container = await mountRail({ providers: allGroups })
    expect(groupRows(container, 'local')).toEqual(['lmstudio', 'ollama'])

    const header = container.querySelector<HTMLElement>('[data-provider-group-header][data-provider-group="local"]')
    expect(header).not.toBeNull()
    expect(header?.getAttribute('aria-expanded')).toBe('true')

    await act(async () => header?.click())
    expect(groupRows(container, 'local')).toEqual([])
    expect(header?.getAttribute('aria-expanded')).toBe('false')
    // 其它组不受影响。
    expect(groupRows(container, 'domestic')).toEqual(['deepseek', 'dashscope', 'zhipu', 'modelscope'])
    expect(categoryRowIds(container)).toHaveLength(allGroups.length - 2)

    await act(async () => header?.click())
    expect(groupRows(container, 'local')).toEqual(['lmstudio', 'ollama'])
    expect(header?.getAttribute('aria-expanded')).toBe('true')
    expect(categoryRowIds(container)).toHaveLength(allGroups.length)
  })

  it('shows only groups with search hits and counts the hits on the header', async () => {
    // 上游已按搜索词过滤：只剩 domestic 的 2 个命中项。
    const hits: Fixture[] = [
      { id: 'deepseek', name: 'DeepSeek', enabled: false },
      { id: 'zhipu', name: 'Zhipu', enabled: false }
    ]
    const container = await mountRail({ providers: hits, search: 'de', totalProviderCount: allGroups.length })

    expect(headerIds(container)).toEqual(['domestic'])
    expect(groupCount(container, 'domestic')).toBe('2')
    expect(rowIds(container)).toEqual(['deepseek', 'zhipu'])
  })

  it('does not render a group with zero providers (e.g. local filtered out)', async () => {
    const withoutLocal = allGroups.filter((provider) => groupIdOf(provider.id) !== 'local')
    const container = await mountRail({ providers: withoutLocal })

    expect(headerIds(container)).not.toContain('local')
    expect(categoryHeaderIds(container)).toEqual(['relay', 'domestic', 'international', 'gateway'])
    // 每个渲染出来的组至少有 1 行。
    for (const groupId of categoryHeaderIds(container)) {
      expect(groupRows(container, groupId).length, `rows of ${groupId}`).toBeGreaterThan(0)
    }

    const searched = await mountRail({
      providers: withoutLocal.filter((provider) => provider.id === 'deepseek' || provider.id === 'openai'),
      search: 'e'
    })
    expect(categoryHeaderIds(searched)).toEqual(['domestic', 'international'])
    expect(headerIds(searched)).not.toContain('local')
  })

  it('puts an unlisted custom provider into the gateway group', async () => {
    const container = await mountRail({
      providers: [{ id: 'acme-custom', name: 'Acme Custom', enabled: false }]
    })

    expect(headerIds(container)).toEqual(['gateway'])
    expect(groupCount(container, 'gateway')).toBe('1')
    const row = container.querySelector('[data-provider-row="acme-custom"]')
    expect(row?.getAttribute('data-provider-group')).toBe('gateway')
    expect(container.querySelector('[data-provider-group-header][data-provider-group="gateway"]')?.textContent)
      .toContain(labels.providerCategories.gateway)
  })
})

/** 测试夹具的期望分组（与 providerPresets 的映射一致，避免测试依赖被测实现）。 */
function groupIdOf(providerId: string): string {
  if (['aihubmix', 'ocoolai', 'silicon'].includes(providerId)) return 'relay'
  if (['deepseek', 'zhipu', 'dashscope', 'modelscope', 'ppio', 'infini'].includes(providerId)) return 'domestic'
  if (['openai', 'anthropic', 'groq', 'cerebras'].includes(providerId)) return 'international'
  if (['ollama', 'lmstudio'].includes(providerId)) return 'local'
  return 'gateway'
}
