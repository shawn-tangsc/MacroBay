// @vitest-environment happy-dom

import { act } from 'react'
import type { Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { createSystemProviderPresets } from '@platform/ai/providers/providerPresets'
import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import { firstProviderIdForRail } from './ModelServiceProviderRail'
import { renderModelServiceSettings } from './modelServicePageHarness'

/**
 * 默认选中必须取**左栏第一行**，而不是供应商源数组的第一项。
 *
 * 左栏渲染顺序是「已启用（pinned）→ 推荐（按奖励排名）→ 分类」，
 * 源数组顺序不参与视觉排序。回归夹具故意把未启用的 silicon 放在源数组第一位，
 * 把已启用的 openrouter 放在第二位：raw order 会选 silicon，grouped order 应选 openrouter。
 */
const presets = createSystemProviderPresets()

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root | undefined

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

function providerOf(id: string, overrides: Partial<SafeModelProvider>): SafeModelProvider {
  const preset = presets.find((candidate) => candidate.id === id)
  if (!preset) throw new Error(`Missing provider preset: ${id}`)
  return { ...(preset as SafeModelProvider), ...overrides }
}

function rawOrderedProviders(): SafeModelProvider[] {
  return [
    providerOf('silicon', { enabled: false, hasApiKey: false, apiKeyPreview: '' }),
    providerOf('openrouter', { enabled: true, hasApiKey: true, apiKeyPreview: 'sk-o**********1234' })
  ]
}

describe('默认选中左栏第一行', () => {
  it('returns the first id of the grouped rail, not the raw array order', () => {
    const providers = rawOrderedProviders()

    // 前提：raw order 的第一项就是「错误答案」。
    expect(providers[0]?.id).toBe('silicon')
    expect(firstProviderIdForRail(providers)).toBe('openrouter')
  })

  it('opens model service with the first grouped row active', async () => {
    const page = await renderModelServiceSettings({ providers: rawOrderedProviders() })
    root = page.root

    const railRows = [...page.container.querySelectorAll<HTMLElement>('[data-provider-row]')]
    // 第一行是已启用的 openrouter（pinned 组），而不是源数组首项 silicon。
    expect(railRows[0]?.getAttribute('data-provider-row')).toBe('openrouter')
    expect(railRows.some((row) => row.getAttribute('data-provider-row') === 'silicon')).toBe(true)

    // pinned 与分类组会重复展示同一家供应商 ⇒ 所有副本都应是 active，且没有 silicon 的 active 副本。
    const activeRows = railRows.filter((row) => row.getAttribute('aria-current') === 'true')
    expect(activeRows.length).toBeGreaterThan(0)
    expect(activeRows.every((row) => row.getAttribute('data-provider-row') === 'openrouter')).toBe(true)
  })
})
