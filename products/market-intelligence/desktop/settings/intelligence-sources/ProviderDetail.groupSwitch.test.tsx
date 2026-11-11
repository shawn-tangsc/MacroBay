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
    status: t.status, toggleSource: t.toggleSource,
    toggleProvider: { enable: t.toggleProviderEnable, disable: t.toggleProviderDisable },
    credentials: t.credentialsRequired, website: t.website, signup: t.signup, 
    testConnection: t.testConnection, jobRegistered: t.jobRegistered, jobNotRegistered: t.jobNotRegistered,
    connectionSucceeded: t.connectionSucceeded, connectionFailed: t.connectionFailed,
    connectionUnsupported: t.connectionUnsupported, apiKey: t.apiKey,
    unavailableReasonCode: t.unavailableReasonCode, unavailableReasonCodeAria: t.unavailableReasonCodeAria,
    automaticSyncStopped: t.automaticSyncStopped, health: t.health
  } as never
}

async function render(enabled: boolean[], extra: { credential?: 'none' | 'api-key'; hasCredential?: boolean; pendingIndex?: number; invite?: boolean } = {}) {
  const invoke = vi.fn(async (_p: string, method: string) => method === 'intelligenceSources.getPageState'
    ? { detail: { credentialStatus: { hasCredential: extra.hasCredential === true } } }
    : undefined)
  ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }
  const onToggleSource = vi.fn(async (_source: Readonly<{ sourceId: string; kind: string }>, _enabled: boolean) => true)
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
        sources: enabled.map((value, index) => source(`s${index}`, value, extra.pendingIndex === index ? 'pending' : 'visible'))
      },
      showSourceDetails: false
    } as never) }))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return { host, onToggleSource }
}

function groupSwitch(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>('.source-provider-detail__group-toggle [role="switch"]')
}

describe('页头整组启停 = 源采集开关的唯一编辑入口', () => {
  it('writes every capability to off in one click, and the header follows', async () => {
    // 用户 2026-11-12：编辑入口回到「数据源」页头这颗；它写的是**源自己的 enabled**（整组一起写）。
    const { host, onToggleSource } = await render([true, true])
    const control = groupSwitch(host)
    expect(control?.getAttribute('aria-checked')).toBe('true')
    expect(control?.getAttribute('aria-disabled')).toBeNull()
    await act(async () => { control?.click() })
    expect(onToggleSource).toHaveBeenCalledTimes(2)
    for (const [source, enabled] of onToggleSource.mock.calls) {
      expect((source as unknown as { sourceId: string }).sourceId).toMatch(/^s[01]$/)
      expect(enabled).toBe(false)
    }
    expect(groupSwitch(host)?.getAttribute('aria-checked')).toBe('false')
  })

  it('turns a mixed group fully on', async () => {
    const { host, onToggleSource } = await render([true, false])
    expect(groupSwitch(host)?.getAttribute('aria-checked')).toBe('false')
    await act(async () => { groupSwitch(host)?.click() })
    // 混合按 off 显示，点一下把可操作项全开——已经开的那项不重复写。
    expect(onToggleSource).toHaveBeenCalledTimes(1)
    expect(onToggleSource.mock.calls[0]?.[1]).toBe(true)
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

describe('组开关按能力算，不被单独一项待接入锁死', () => {
  it('counts only the wired capabilities for its displayed state', async () => {
    // BEA 那种：一项已接入（开）+ 一项待接入 → 组开关显示开（待接入项不参与）。
    const { host } = await render([true, false], { pendingIndex: 1 })
    const control = groupSwitch(host)
    expect(control?.getAttribute('aria-checked')).toBe('true')
    expect(control?.getAttribute('aria-disabled')).toBeNull()
  })

  it('writes only the operable capabilities when part of the group is pending', async () => {
    const { host, onToggleSource } = await render([false, true], { pendingIndex: 0 })
    await act(async () => { groupSwitch(host)?.click() })
    // s0 待接入：不写、不会被打开；s1 已接入 → 只写它。
    expect(onToggleSource).toHaveBeenCalledTimes(1)
    expect((onToggleSource.mock.calls[0]?.[0] as unknown as { sourceId: string }).sourceId).toBe('s1')
    expect(onToggleSource.mock.calls[0]?.[1]).toBe(false)
    expect(groupSwitch(host)?.getAttribute('aria-checked')).toBe('false')
  })

  it('locks the switch and shows the hint when every capability is pending', async () => {
    const { host, onToggleSource } = await render([false], { pendingIndex: 0 })
    const control = groupSwitch(host)
    expect(control?.getAttribute('aria-disabled')).toBe('true')
    expect(host.querySelector(`[aria-label="${t.providerPendingAria}"]`)).not.toBeNull()
    await act(async () => { control?.click() })
    expect(onToggleSource).not.toHaveBeenCalled()
  })

  it('does not show the credential hint when some capability is pending (hint is for all-pending)', async () => {
    const { host } = await render([false, true], { pendingIndex: 0 })
    // 一项待接入、一项已接入 → 不挂「还没接入」那句（那句只在整组都不可操作时出现）。
    expect(host.querySelector(`[aria-label="${t.providerPendingAria}"]`)).toBeNull()
  })
})

describe('两张卡的范围', () => {
  it('keeps the API Key row inside the header card', async () => {
    // 用户 2026-11-11：卡一 = 名字/动作/组开关 + API Key 行，三行同一张卡；卡二 = 能力行。
    // 邀请推广句已按用户 2026-11-12 删除（`28518a1`），这里只剩 API Key 行要核。
    const { host } = await render([true], {
      credential: 'api-key',
      hasCredential: true,
    })
    const cards = [...host.querySelectorAll<HTMLElement>('.source-provider-detail__card')]
    expect(cards).toHaveLength(2)
    const header = cards[0]!
    // API Key 行在页头卡里（不是被拆到卡外）。
    expect(header.querySelector(`[aria-label="${t.apiKey.label}"]`)).not.toBeNull()
    // 能力行在第二张卡里。
    expect(cards[1]!.querySelectorAll('.source-provider-detail__row').length).toBeGreaterThan(0)
    expect(cards[1]!.querySelector(`[aria-label="${t.apiKey.label}"]`)).toBeNull()
  })
})
