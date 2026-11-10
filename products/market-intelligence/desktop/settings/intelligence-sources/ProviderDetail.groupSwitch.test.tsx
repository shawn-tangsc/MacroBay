// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import { ProviderDetail } from './ProviderDetail'

/**
 * 页头那颗**整组**启停（用户 2026-11-11，照模型服务供应商详情页头那一行）：
 * 源名 → 官网 → 测试连接 →（贴右缘）开关；全开 = on、全关 = off、**混合按 off 显示**（点击后全开）。
 * 语义是整组：点击把它下面**每个能力**一起写成同一个 enabled。
 */
const t = productText['zh-CN'].settings.intelligenceSources
let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

function source(sourceId: string, enabled: boolean) {
  return {
    sourceId, providerId: 'bls', displayName: sourceId, agents: [], panels: ['economic-calendar'],
    visibility: 'visible', collection: 'provider', kind: 'official-calendar',
    capabilities: { runNow: 'provider', testConnection: true }, readiness: 'live',
    enabled, healthState: enabled ? 'healthy' : 'off', healthMarker: 'none'
  }
}

function labels() {
  return {
    sourceNames: {}, providerNames: {}, panelNames: t.panelNames, badges: t.sourceBadges,
    status: t.status, capabilities: t.providerSummary, toggleSource: t.toggleSource,
    toggleProvider: { enable: t.toggleProviderEnable, disable: t.toggleProviderDisable },
    credentials: t.credentialsRequired, website: t.website, signup: t.signup, inviteNote: t.inviteNote,
    testConnection: t.testConnection, jobRegistered: t.jobRegistered, jobNotRegistered: t.jobNotRegistered,
    connectionSucceeded: t.connectionSucceeded, connectionFailed: t.connectionFailed,
    connectionUnsupported: t.connectionUnsupported, apiKey: t.apiKey,
    unavailableReasonCode: t.unavailableReasonCode, unavailableReasonCodeAria: t.unavailableReasonCodeAria,
    automaticSyncStopped: t.automaticSyncStopped, health: t.health
  } as never
}

async function render(enabled: boolean[], extra: { credential?: 'none' | 'api-key'; hasCredential?: boolean; readOnlyToggles?: boolean } = {}) {
  const invoke = vi.fn(async (_p: string, method: string) => method === 'intelligenceSources.getPageState'
    ? { detail: { credentialStatus: { hasCredential: extra.hasCredential === true } } }
    : undefined)
  ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }
  const onToggleSource = vi.fn(async () => true)
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(ShellLanguageProvider, { language: 'zh-CN', children: createElement(ProviderDetail, {
      labels: labels(),
      onToggleSource,
      provider: {
        providerId: 'bls', displayName: 'Bureau of Labor Statistics (BLS)', category: 'macro',
        credential: extra.credential ?? 'none', healthMarker: 'none',
        website: 'https://www.bls.gov',
        sources: enabled.map((value, index) => source(`s${index}`, value))
      },
      showSourceDetails: false,
      ...(extra.readOnlyToggles === true ? { readOnlyToggles: true } : {})
    } as never) }))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return { host, onToggleSource }
}

function groupSwitch(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>('.source-provider-detail__group-toggle [role="switch"]')
}

describe('页头整组启停', () => {
  it('shows on when every capability is on, and turns them all off in one click', async () => {
    const { host, onToggleSource } = await render([true, true])
    const control = groupSwitch(host)
    expect(control?.getAttribute('aria-checked')).toBe('true')
    await act(async () => { control?.click() })
    const written = onToggleSource.mock.calls.map((call) => (call as unknown as [{ sourceId: string }, boolean])[1])
    expect(written).toEqual([false, false])
  })

  it('shows off for a mixed group, and one click turns everything on', async () => {
    // 混合态按 off 显示（点击后全开）——否则读者看不出到底开没开。
    const { host, onToggleSource } = await render([true, false])
    const control = groupSwitch(host)
    expect(control?.getAttribute('aria-checked')).toBe('false')
    await act(async () => { control?.click() })
    const written = onToggleSource.mock.calls.map((call) => (call as unknown as [{ sourceId: string }, boolean])[1])
    // 已经开着的那一项不再重复写。
    expect(written).toEqual([true])
  })

  it('disables the group switch while a required key is missing, and writes nothing', async () => {
    const { host, onToggleSource } = await render([false, false], { credential: 'api-key', hasCredential: false })
    const control = groupSwitch(host)
    expect(control?.getAttribute('aria-disabled')).toBe('true')
    expect(host.querySelector(`[aria-label="${t.credentialRequiredToEnableAria}"]`)).not.toBeNull()
    await act(async () => { control?.click() })
    expect(onToggleSource).not.toHaveBeenCalled()
  })
})

describe('「数据源」屏只读', () => {
  it('makes the header group switch read-only and writes nothing', async () => {
    // 启停的唯一编辑入口是「采集与数据」里的卡片开关；这一屏只显示状态。
    const { host, onToggleSource } = await render([true, true], { readOnlyToggles: true })
    const control = groupSwitch(host)
    expect(control?.getAttribute('aria-disabled')).toBe('true')
    await act(async () => { control?.click() })
    expect(onToggleSource).not.toHaveBeenCalled()
  })
})
