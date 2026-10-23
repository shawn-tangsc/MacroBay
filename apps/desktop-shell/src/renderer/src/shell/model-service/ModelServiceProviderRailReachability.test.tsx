// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import { platformText } from '../../i18n/platformText'

import { ModelServiceProviderRail } from './ModelServiceProviderRail'

/**
 * PLAT-62 追加：左栏行内可达性标签。
 * - proxy：行右侧（状态点左侧）网络图标 + title「· 需代理访问」；
 * - direct：不加图标，仅 title 追加「· 国内直连」；
 * - 未收录 id 一律 direct；标记不改变行结构（仍只有头像/名称/状态点）。
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

async function mountRail(providers: Fixture[]): Promise<HTMLElement> {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(ModelServiceProviderRail, {
      labels,
      providers: providers as unknown as SafeModelProvider[],
      totalProviderCount: providers.length,
      selectedProviderId: null,
      search: '',
      onSearchChange: () => undefined,
      onSelect: () => undefined,
      onAdd: () => undefined
    }))
  })
  return container
}

function row(container: HTMLElement, providerId: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-provider-row="${providerId}"]`)
}

describe('PLAT-62 供应商可达性标签', () => {
  it('marks a proxy provider with the lock icon and the proxy title', async () => {
    const container = await mountRail([{ id: 'openai', name: 'OpenAI', enabled: false }])
    const target = row(container, 'openai')

    expect(target?.getAttribute('data-reachability')).toBe('proxy')
    expect(target?.querySelector('[data-provider-reachability-icon]')).not.toBeNull()
    expect(target?.getAttribute('title')).toContain(labels.reachabilityProxy)
    expect(target?.getAttribute('title')).toContain('OpenAI')
    // 行结构没变：头像 + 名称 + 状态点。
    expect(target?.querySelector('[data-provider-status-dot]')).not.toBeNull()
  })

  it('marks a direct provider without any icon and with the direct title', async () => {
    const container = await mountRail([{ id: 'deepseek', name: 'DeepSeek', enabled: false }])
    const target = row(container, 'deepseek')

    expect(target?.getAttribute('data-reachability')).toBe('direct')
    expect(target?.querySelector('[data-provider-reachability-icon]')).toBeNull()
    expect(target?.getAttribute('title')).toContain(labels.reachabilityDirect)
    expect(target?.getAttribute('title')).toContain('DeepSeek')
  })

  it('treats an unlisted custom provider as direct', async () => {
    const container = await mountRail([{ id: 'acme-custom', name: 'Acme Custom', enabled: false }])

    expect(row(container, 'acme-custom')?.getAttribute('data-reachability')).toBe('direct')
    expect(row(container, 'acme-custom')?.querySelector('[data-provider-reachability-icon]')).toBeNull()
    expect(row(container, 'acme-custom')?.getAttribute('title')).toContain(labels.reachabilityDirect)
  })

  it('keeps the reachability mark on both the pinned copy and the grouped copy', async () => {
    const container = await mountRail([
      { id: 'openai', name: 'OpenAI', enabled: true },
      { id: 'deepseek', name: 'DeepSeek', enabled: true }
    ])

    const openaiCopies = [...container.querySelectorAll<HTMLElement>('[data-provider-row="openai"]')]
    expect(openaiCopies).toHaveLength(2)
    for (const copy of openaiCopies) {
      expect(copy.getAttribute('data-reachability')).toBe('proxy')
      expect(copy.querySelector('[data-provider-reachability-icon]')).not.toBeNull()
      expect(copy.getAttribute('title')).toContain(labels.reachabilityProxy)
    }

    const deepseekCopies = [...container.querySelectorAll<HTMLElement>('[data-provider-row="deepseek"]')]
    expect(deepseekCopies).toHaveLength(2)
    for (const copy of deepseekCopies) {
      expect(copy.getAttribute('data-reachability')).toBe('direct')
      expect(copy.querySelector('[data-provider-reachability-icon]')).toBeNull()
    }
  })
})
