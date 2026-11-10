// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import { ProviderDetail } from './ProviderDetail'

/**
 * 能力行的只读状态 = **这个源自己开没开**（`source.enabled`）。
 *
 * 用户 2026-11-11：「币安」摘要写「已启用 4」，点进去只有 2 颗开关是开的——因为行开关当时读的是
 * 「看板某一格有没有用它」。同一个词在两处指两件事，两个数必然对不上。
 * 现在页头组开关、行开关、左上角摘要读同一个字段；「哪一格用不用它」归「采集与数据」那面。
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

function source(sourceId: string, enabled = true, kind = 'feed') {
  return {
    sourceId, providerId: 'p', displayName: sourceId, agents: [], panels: ['dashboard'],
    visibility: 'visible', collection: 'adapter', kind, capabilities: {}, readiness: 'live',
    enabled, healthState: enabled ? 'healthy' : 'off', healthMarker: 'none'
  }
}

async function render(sources: ReadonlyArray<unknown>) {
  ;(window as unknown as { platform: unknown }).platform = { products: { invoke: vi.fn(async () => undefined) } }
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(ShellLanguageProvider, { language: 'zh-CN', children: createElement(ProviderDetail, {
      labels,
      provider: { providerId: 'p', displayName: 'P', category: 'macro', credential: 'none', healthMarker: 'none', sources },
      showSourceDetails: true
    } as never) }))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return host
}

function rowSwitch(host: HTMLElement, sourceId: string): HTMLElement | null {
  return host.querySelector<HTMLElement>(`[data-setting-key$="${sourceId}"] [role="switch"]`)
}

describe('能力行状态读源自己的 enabled', () => {
  it('shows exactly the enabled sources as on, and the disabled ones as off', async () => {
    const host = await render([
      source('binance-announcements', true),
      source('binance-futures-positioning', true),
      source('binance-api-updates', false),
      source('binance-spot-market', false)
    ])
    expect(rowSwitch(host, 'binance-announcements')?.getAttribute('aria-checked')).toBe('true')
    expect(rowSwitch(host, 'binance-futures-positioning')?.getAttribute('aria-checked')).toBe('true')
    expect(rowSwitch(host, 'binance-api-updates')?.getAttribute('aria-checked')).toBe('false')
    expect(rowSwitch(host, 'binance-spot-market')?.getAttribute('aria-checked')).toBe('false')
  })

  it('keeps working for a source used by no dashboard cell at all', async () => {
    // 维护备用 / 只供分析的源没有格开关：它们的开关现在只回答「这个源自己开没开」。
    const on = await render([source('binance-api-updates', true)])
    expect(rowSwitch(on, 'binance-api-updates')?.getAttribute('aria-checked')).toBe('true')
    await act(async () => root?.unmount())
    const off = await render([source('binance-api-updates', false)])
    expect(rowSwitch(off, 'binance-api-updates')?.getAttribute('aria-checked')).toBe('false')
  })

  it('never renders a writable row: the header group switch is the only write path', async () => {
    const host = await render([source('binance-announcements', true), source('binance-api-updates', false)])
    const rows = [...host.querySelectorAll<HTMLButtonElement>(
      '[data-setting-key^="setting:sources.enabled"] [role="switch"]'
    )]
    expect(rows.length).toBe(2)
    for (const control of rows) expect(control.disabled).toBe(true)
  })
})
