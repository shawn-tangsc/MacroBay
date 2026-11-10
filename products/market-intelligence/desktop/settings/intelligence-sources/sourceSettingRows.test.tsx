// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { settingRegistry } from '../../shared/settings/registry'
import { ProviderDetail, type ProviderDetailLabels } from './ProviderDetail'
import { MIGRATED_SOURCE_SETTING_KEYS } from './sourceSettingRows'
import type { ProviderView, SourceView } from '../../../service/intelligence/application/sourceProjection'

/**
 * C2 第 3 步·来源屏：菜单 1 的三行按注册表声明渲染。
 *
 * 双向守卫（与通知屏同一套口径，架构师 2026-11-10 那三条）：
 * ① 视图里成立的声明，页面必须渲染（`data-setting-key` 在 DOM 上）；
 * ② 页面渲染的每一行，都必须是菜单 1 的真实声明且 `surfaces` 含 `settings`。
 * 只做 ①，清单里新加一行而页面不画不会红；只做 ②，页面多画一行也不会红。
 */
const settingsText = productText['zh-CN'].settings.intelligenceSources

let root: Root | null = null
afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

function labels(): ProviderDetailLabels {
  return {
    sourceNames: {}, providerNames: {}, panelNames: settingsText.panelNames, badges: settingsText.sourceBadges,
    status: settingsText.status, capabilities: settingsText.providerSummary, toggleSource: settingsText.toggleSource,
    credentials: settingsText.credentialsRequired, website: settingsText.website, signup: settingsText.signup,
    inviteNote: settingsText.inviteNote, testConnection: settingsText.testConnection, jobRegistered: settingsText.jobRegistered,
    jobNotRegistered: settingsText.jobNotRegistered, connectionSucceeded: settingsText.connectionSucceeded,
    connectionFailed: settingsText.connectionFailed, connectionUnsupported: settingsText.connectionUnsupported,
    apiKey: settingsText.apiKey, unavailableReasonCode: settingsText.unavailableReasonCode,
    unavailableReasonCodeAria: settingsText.unavailableReasonCodeAria,
    collectionPolicyStopped: settingsText.collectionPolicyStopped,
    automaticSyncStopped: settingsText.automaticSyncStopped, lastSuccessfulSync: settingsText.lastSuccessfulSync,
    health: settingsText.health
  }
}

function source(overrides: Partial<SourceView>): SourceView {
  return {
    sourceId: 's1', providerId: 'p1', displayName: 'S1', agents: ['crypto'], panels: ['dashboard'],
    visibility: 'visible', collection: 'adapter', kind: 'feed', capabilities: { runNow: 'adapter', testConnection: true },
    readiness: 'live', enabled: true, healthState: 'healthy', healthMarker: 'none',
    ...overrides
  }
}

function provider(): ProviderView {
  return {
    providerId: 'p1', displayName: 'P1', category: 'macro', credential: 'none', healthMarker: 'none',
    sources: [
      source({ sourceId: 's1', displayName: 'S1' }),
      // 待接入的源：启用开关仍要画（禁用），否则「为什么这一条没有」只能是悬案。
      source({ sourceId: 's2', displayName: 'S2', visibility: 'pending' })
    ]
  }
}

async function mount(enabledWrite = vi.fn(async () => true)): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<ProviderDetail
      labels={labels()}
      onToggleSource={enabledWrite}
      provider={provider()}
      showSourceDetails
      surface="settings"
    />)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return container
}

function renderedKeys(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[data-setting-key]')]
    .map((node) => node.getAttribute('data-setting-key') ?? '')
}

describe('the source screen renders menu 1 from the registry (C2)', () => {
  it('renders one enabled row per source, keyed by the declared instance key', async () => {
    const container = await mount()
    expect(renderedKeys(container).sort()).toEqual([
      'setting:sources.enabled@s1',
      'setting:sources.enabled@s2'
    ])
  })

  it('renders every migrated declaration and nothing outside the registry', async () => {
    const container = await mount()
    const keys = renderedKeys(container)

    // ① 清单 → 页面：清单里每一条，只要它对这份源视图成立，就必须画出来（不是「大概画了」）。
    const expected = provider().sources.flatMap((entry) => MIGRATED_SOURCE_SETTING_KEYS
      .filter((template) => {
        const declared = settingRegistry.sources.find((row) => row.key === template)
        return declared?.visibleWhen?.({ sourceId: entry.sourceId, displayName: entry.displayName, enabled: entry.enabled, profile: {} }) ?? true
      })
      .map((template) => template.replace('<sourceId>', entry.sourceId)))
    expect(keys.sort()).toEqual(expected.sort())

    // ② 页面 → 清单：渲染出来的每个键都必须是菜单 1 的真实声明，且只给设置页这一面。
    for (const key of keys) {
      const template = key.replace(/@[^@]+$/, '@<sourceId>')
      const declared = settingRegistry.sources.find((row) => row.key === template)
      expect(declared?.surfaces).toEqual(['settings'])
    }
  })

  it('keeps the single enable write path when the row is registry-rendered', async () => {
    const invoke = vi.fn(async (_productId: string, _method: string) => undefined)
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }
    const write = vi.fn(async () => true)
    const container = await mount(write)

    const toggle = container.querySelector<HTMLButtonElement>('[data-setting-key="setting:sources.enabled@s1"] button[role="switch"]')!
    await act(async () => { toggle.click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 's1' }), false)
    // 组件自己不再调 IPC——启用仍只有宿主那一条写入口。
    expect(invoke.mock.calls.some(([, method]) => method === 'intelligenceSources.setEnabled')).toBe(false)
  })
})
