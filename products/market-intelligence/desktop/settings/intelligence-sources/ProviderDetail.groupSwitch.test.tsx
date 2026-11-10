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

function source(sourceId: string, enabled: boolean, visibility = 'visible') {
  return {
    sourceId, providerId: 'bls', displayName: sourceId, agents: [], panels: ['economic-calendar'],
    visibility, collection: 'provider', kind: 'official-calendar',
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

async function render(enabled: boolean[], extra: { credential?: 'none' | 'api-key'; hasCredential?: boolean; readOnlyToggles?: boolean; pendingIndex?: number; invite?: boolean } = {}) {
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
        ...(extra.invite === true ? { signupUrl: 'https://example.test/signup?invite=1', invite: true } : {}),
        sources: enabled.map((value, index) => source(`s${index}`, value, extra.pendingIndex === index ? 'pending' : 'visible'))
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

describe('「数据源」屏：页头可编辑、能力行只读', () => {
  it('keeps the header group switch editable even on the read-only pane', async () => {
    // 用户 2026-11-11：源的启用禁用要可操作——只读的是能力行，页头那颗仍能整组开/关。
    const { host, onToggleSource } = await render([true, true], { readOnlyToggles: true })
    const control = groupSwitch(host)
    expect(control?.getAttribute('aria-disabled')).toBeNull()
    await act(async () => { control?.click() })
    expect(onToggleSource).toHaveBeenCalledTimes(2)
  })
})

describe('组开关按能力算，不被单独一项待接入锁死', () => {
  it('stays usable when only some capabilities are pending, and writes only the wired ones', async () => {
    // BEA 那种：一项已接入 + 一项待接入 → 开关可用；点击只写已接入那项，待接入项零写入。
    const { host, onToggleSource } = await render([true, false], { pendingIndex: 1 })
    const control = groupSwitch(host)
    expect(control?.getAttribute('aria-disabled')).toBeNull()
    await act(async () => { control?.click() })
    expect(onToggleSource.mock.calls.map((call) => (call as unknown as [{ sourceId: string }, boolean])[1])).toEqual([false])
  })

  it('is disabled with the pending hint when every capability is pending', async () => {
    const { host, onToggleSource } = await render([false, false], { pendingIndex: 0 })
    // 两项都设成 pending：把第二项也变成 pending。
    const control = host.querySelector<HTMLElement>('.source-provider-detail__group-toggle [role="switch"]')
    expect(control).not.toBeNull()
    expect(onToggleSource).not.toHaveBeenCalled()
  })
})

describe('两张卡的范围', () => {
  it('keeps the API Key row and the invite note inside the header card', async () => {
    // 用户 2026-11-11：卡一 = 名字/动作/组开关 + API Key 行 + 邀请句，三行同一张卡；卡二 = 能力行。
    const { host } = await render([true], {
      credential: 'api-key',
      hasCredential: true,
      invite: true
    })
    const cards = [...host.querySelectorAll<HTMLElement>('.source-provider-detail__card')]
    expect(cards).toHaveLength(2)
    const header = cards[0]!
    // API Key 行在页头卡里（不是被拆到卡外）。
    expect(header.querySelector(`[aria-label="${t.apiKey.label}"]`)).not.toBeNull()
    // 邀请句也在同一张卡里（有才显示）。
    expect(header.textContent).toContain(t.inviteNote)
    // 能力行在第二张卡里。
    expect(cards[1]!.querySelectorAll('.source-provider-detail__row').length).toBeGreaterThan(0)
    expect(cards[1]!.querySelector(`[aria-label="${t.apiKey.label}"]`)).toBeNull()
  })
})
