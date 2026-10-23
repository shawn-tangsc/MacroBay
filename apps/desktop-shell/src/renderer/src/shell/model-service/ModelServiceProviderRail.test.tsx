// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import { platformText } from '../../i18n/platformText'

import { arrangeProvidersForRail, ModelServiceProviderRail } from './ModelServiceProviderRail'

/**
 * PLAT-61：左栏排序规则 —— 已启用优先、组内稳定；选中态与右侧详情不受重排影响。
 * 纯函数 + DOM 两层断言；不 mock 组件内部。
 */
const labels = platformText['en-US'].models

type Fixture = Pick<SafeModelProvider, 'id' | 'name' | 'enabled'>

const initial: Fixture[] = [
  { id: 'alpha', name: 'Alpha', enabled: false },
  { id: 'bravo', name: 'Bravo', enabled: true },
  { id: 'charlie', name: 'Charlie', enabled: false },
  { id: 'delta', name: 'Delta', enabled: true }
]

function withEnabledFlags(ids: string[]): Fixture[] {
  return initial.map((provider) => ids.includes(provider.id) ? { ...provider, enabled: true } : { ...provider, enabled: false })
}

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function mountRail(props: {
  providers: Fixture[]
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
      search: '',
      onSearchChange: () => undefined,
      onSelect: () => undefined,
      onAdd: () => undefined
    }))
  })
  return container
}

/** 只数 6 个分类组里的行；PLAT-62 追加的 pinned 快捷区会重复展示已启用项，单独覆盖。 */
function rowIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-provider-row]')]
    .filter((row) => row.closest('[data-provider-group="pinned"]') === null)
    .map((row) => row.getAttribute('data-provider-row') ?? '')
}

describe('PLAT-61 供应商左栏排序', () => {
  it('keeps every enabled provider before the disabled ones and preserves source order inside each group', async () => {
    const container = await mountRail({ providers: initial })

    expect(rowIds(container)).toEqual(['bravo', 'delta', 'alpha', 'charlie'])
    expect(arrangeProvidersForRail(initial).map((provider) => provider.id)).toEqual(['bravo', 'delta', 'alpha', 'charlie'])
  })

  it('moves a newly enabled provider into the enabled group (stable, source order)', async () => {
    // 启用最后一项 ⇒ 落到已启用区末尾。
    const enabledLast = await mountRail({ providers: withEnabledFlags(['bravo', 'charlie', 'delta']) })
    expect(rowIds(enabledLast)).toEqual(['bravo', 'charlie', 'delta', 'alpha'])

    // 启用第一项 ⇒ 落到已启用区顶部；同一规则（源顺序稳定）。
    const enabledFirst = await mountRail({ providers: withEnabledFlags(['alpha', 'bravo', 'delta']) })
    expect(rowIds(enabledFirst)).toEqual(['alpha', 'bravo', 'delta', 'charlie'])
  })

  it('moves a disabled provider into the disabled group without reordering the rest', async () => {
    const disabledDelta = await mountRail({ providers: withEnabledFlags(['bravo']) })
    expect(rowIds(disabledDelta)).toEqual(['bravo', 'alpha', 'charlie', 'delta'])
  })

  it('keeps the selected provider selected when the order changes', async () => {
    const before = await mountRail({ providers: initial, selectedProviderId: 'charlie' })
    expect(before.querySelector('[data-provider-row="charlie"]')?.className).toContain('active')

    const after = await mountRail({
      providers: withEnabledFlags(['alpha', 'bravo', 'charlie', 'delta']),
      selectedProviderId: 'charlie'
    })

    const selected = after.querySelector('[data-provider-row="charlie"]')
    expect(selected?.className).toContain('active')
    expect(selected?.getAttribute('aria-current')).toBe('true')
    expect(after.querySelectorAll('.model-service-rail-row.active')).toHaveLength(2)
    // 选中项仍在列表里（没有丢行；pinned + 分类组各一份 ⇒ 2 条 active）。
    expect(after.querySelectorAll('[data-provider-row="charlie"].active')).toHaveLength(2)
    expect(rowIds(after)).toHaveLength(initial.length)
  })

  it('applies the same rule to a search-filtered subset', async () => {
    const filtered = initial.filter((provider) => provider.id === 'alpha' || provider.id === 'delta')
    const container = await mountRail({ providers: filtered, totalProviderCount: initial.length })

    expect(rowIds(container)).toEqual(['delta', 'alpha'])
  })

  it('keeps search at the top and the add action at the bottom (neither participates in sorting)', async () => {
    const container = await mountRail({ providers: initial })

    const rail = container.querySelector('[data-model-provider-rail]')
    const children = [...(rail?.children ?? [])]
    expect(children[0]?.querySelector('[data-provider-search]')).not.toBeNull()
    expect(children[children.length - 1]?.getAttribute('data-provider-add')).not.toBeNull()
    expect(container.querySelectorAll('[data-provider-row]')).toHaveLength(initial.length + 2)
  })

  it('keeps a stable rule with a single provider and with no provider', async () => {
    const single = await mountRail({ providers: [{ id: 'solo', name: 'Solo', enabled: false }] })
    expect(rowIds(single)).toEqual(['solo'])

    const empty = await mountRail({ providers: [], totalProviderCount: 0 })
    expect(rowIds(empty)).toEqual([])
    expect(empty.textContent).toContain(labels.noProviders)
  })
})
