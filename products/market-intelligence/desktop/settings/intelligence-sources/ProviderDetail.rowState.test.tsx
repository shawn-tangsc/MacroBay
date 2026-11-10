// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import { ProviderDetail } from './ProviderDetail'

/**
 * 能力行的只读状态 = 「采集与数据」里用到它的那些格开关（用户 2026-11-11）：
 * 任一相关格开着 = 开；全关 = 关；**采集与数据里没有对应格的源恒显示关**（不退回 `enabled`）。
 * 页头那颗组开关管的是源自己的采集，两件事别混。
 */
const t = productText['zh-CN'].settings.intelligenceSources
let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

const labels = {
  sourceNames: {}, providerNames: {}, panelNames: t.panelNames, badges: t.sourceBadges, status: t.status,
  capabilities: t.providerSummary, toggleSource: t.toggleSource,
  toggleProvider: { enable: t.toggleProviderEnable, disable: t.toggleProviderDisable },
  credentials: t.credentialsRequired, website: t.website, signup: t.signup, inviteNote: t.inviteNote,
  testConnection: t.testConnection, jobRegistered: t.jobRegistered, jobNotRegistered: t.jobNotRegistered,
  connectionSucceeded: t.connectionSucceeded, connectionFailed: t.connectionFailed,
  connectionUnsupported: t.connectionUnsupported, apiKey: t.apiKey,
  unavailableReasonCode: t.unavailableReasonCode, unavailableReasonCodeAria: t.unavailableReasonCodeAria,
  automaticSyncStopped: t.automaticSyncStopped, health: t.health
} as never

function source(sourceId: string, kind = 'feed') {
  return {
    sourceId, providerId: 'p', displayName: sourceId, agents: [], panels: ['dashboard'],
    visibility: 'visible', collection: 'adapter', kind, capabilities: {}, readiness: 'live',
    enabled: true, healthState: 'healthy', healthMarker: 'none'
  }
}

async function render(sources: ReadonlyArray<never>, cellEnabled: Readonly<Record<string, boolean>>) {
  ;(window as unknown as { platform: unknown }).platform = { products: { invoke: vi.fn(async () => undefined) } }
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(ShellLanguageProvider, { language: 'zh-CN', children: createElement(ProviderDetail, {
      cellEnabled,
      labels,
      provider: { providerId: 'p', displayName: 'P', category: 'macro', credential: 'none', healthMarker: 'none', sources },
      readOnlyToggles: true,
      showSourceDetails: true
    } as never) }))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return host
}

function rowSwitch(host: HTMLElement, sourceId: string): HTMLElement | null {
  return host.querySelector<HTMLElement>(`[data-setting-key$="${sourceId}"] [role="switch"]`)
}

describe('能力行状态读格开关', () => {
  it('shows the row off when every cell using that source is off, and on when one is on', async () => {
    const sources = [source('binance-futures-positioning')]
    const off = await render(sources as never, {})
    expect(rowSwitch(off, 'binance-futures-positioning')?.getAttribute('aria-checked')).toBe('false')
    await act(async () => root?.unmount())
    const on = await render(sources as never, { 'quotes:btc': true })
    expect(rowSwitch(on, 'binance-futures-positioning')?.getAttribute('aria-checked')).toBe('true')
  })

  it('shows a no-cell source that is listed in 采集与数据 as on', async () => {
    // 舆情 / 日历那几条没有自己的格开关，但确实在采集与数据里列着 —— 视为开。
    const host = await render([source('binance-announcements', 'feed')] as never, {})
    expect(rowSwitch(host, 'binance-announcements')?.getAttribute('aria-checked')).toBe('true')
  })

  it('shows maintenance and un-wired sources with no place in 采集与数据 as off', async () => {
    const host = await render(
      [source('binance-api-updates'), source('binance-asset-page', 'adapter')] as never,
      {}
    )
    expect(rowSwitch(host, 'binance-api-updates')?.getAttribute('aria-checked')).toBe('false')
    expect(rowSwitch(host, 'binance-asset-page')?.getAttribute('aria-checked')).toBe('false')
  })
})
