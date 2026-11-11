// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
import { ProviderDetail } from './ProviderDetail'

/**
 * `focus.sourceId` 的判据：入口带了一个源进来，右栏要把**那一行**带进视野并给一个可见标记。
 *
 * 三条（缺一条就等于「看着像定位了」）：
 * 1. 合法 sourceId → `scrollIntoView` 恰好一次、且滚的就是那一行，该行获得 `data-focused`；
 * 2. 找不到该源 → **什么都不做**（不滚、不标记、不抛错），界面与不带 focus 时一模一样；
 * 3. 没带 focus → 不滚（否则以后任何一次重渲染都会把读者拽走）。
 *
 * 为什么这条判据长在 `ProviderDetail` 上：源级选中就在这层内部（`SourceConfigSurface` 只把
 * `initialSourceId` 原样透传下来），外层只会切「哪个供应商」。**选中态本身不在这里改**——
 * 它归 `SettingsSourceTree`（`aria-current`）与 `BusinessSettingsView`，本组件每次只画给它的那一个
 * `provider`，所以「找不到就不改选中」在这里的形态就是「这一层没有任何副作用」。
 */
const t = productText['zh-CN'].settings.intelligenceSources
let root: ReturnType<typeof createRoot> | undefined
/** 挂载时被滚过的元素（用普通函数取 `this`，一次记录「谁被滚了」）。 */
let scrolled: HTMLElement[] = []
let scrollCalls: unknown[] = []
let scrollSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  scrolled = []
  scrollCalls = []
  scrollSpy = vi.fn(function (this: HTMLElement, options?: unknown) {
    scrolled.push(this)
    scrollCalls.push(options)
  })
  // happy-dom 不实现滚动：把桩装在原型上，组件里那句 `row.scrollIntoView?.()` 才会落到这里。
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: scrollSpy
  })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
})

const labels = {
  sourceNames: {}, providerNames: {}, panelNames: t.panelNames, badges: t.sourceBadges, status: t.status,
  toggleSource: t.toggleSource,
  toggleProvider: { enable: t.toggleProviderEnable, disable: t.toggleProviderDisable },
  credentials: t.credentialsRequired, website: t.website, signup: t.signup, 
  testConnection: t.testConnection, jobRegistered: t.jobRegistered, jobNotRegistered: t.jobNotRegistered,
  connectionSucceeded: t.connectionSucceeded, connectionFailed: t.connectionFailed,
  connectionUnsupported: t.connectionUnsupported, apiKey: t.apiKey,
  unavailableReasonCode: t.unavailableReasonCode, unavailableReasonCodeAria: t.unavailableReasonCodeAria,
  automaticSyncStopped: t.automaticSyncStopped, health: t.health
} as never

function source(sourceId: string) {
  return {
    sourceId, providerId: 'p', displayName: sourceId, agents: [], panels: ['dashboard'],
    visibility: 'visible', collection: 'adapter', kind: 'feed', capabilities: {}, readiness: 'live',
    enabled: true, healthState: 'healthy', healthMarker: 'none'
  }
}

const SOURCES = ['binance-announcements', 'binance-api-updates', 'binance-spot-market'] as const

async function render(initialSourceId?: string) {
  ;(window as unknown as { platform: unknown }).platform = { products: { invoke: vi.fn(async () => undefined) } }
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(ShellLanguageProvider, { language: 'zh-CN', children: createElement(ProviderDetail, {
      labels,
      provider: { providerId: 'p', displayName: 'P', category: 'macro', credential: 'none', healthMarker: 'none', sources: SOURCES.map(source) },
      showSourceDetails: true,
      ...(initialSourceId === undefined ? {} : { initialSourceId })
    } as never) }))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return host
}

/** 这一屏渲染出来的行（按实例键），用来断「界面与不带 focus 时一致」。 */
function rowKeys(host: HTMLElement): string[] {
  return [...host.querySelectorAll<HTMLElement>('[data-setting-key]')]
    .map((row) => row.getAttribute('data-setting-key') ?? '')
}

describe('focus.sourceId 落到那个源的那一行', () => {
  it('scrolls that row into view exactly once and marks it', async () => {
    const host = await render('binance-api-updates')
    expect(scrollSpy).toHaveBeenCalledTimes(1)
    expect(scrollCalls[0]).toEqual({ block: 'nearest' })
    // 滚的就是这个源的那一行（不是随便某一行），且只有它带标记。
    expect(scrolled).toHaveLength(1)
    expect(scrolled[0]?.getAttribute('data-source-row')).toBe('binance-api-updates')
    const marked = [...host.querySelectorAll<HTMLElement>('[data-focused="true"]')]
    expect(marked).toHaveLength(1)
    expect(marked[0]?.getAttribute('data-source-row')).toBe('binance-api-updates')
    // 看得见 ≠ 到了：焦点也落到这一行（行本来不可聚焦，定位时临时 tabIndex=-1）。
    expect(document.activeElement).toBe(marked[0])
  })

  it('does nothing at all when that source is not in this provider', async () => {
    const got = await render('no-such-source')
    expect(scrollSpy).not.toHaveBeenCalled()
    expect(got.querySelector('[data-focused]')).toBeNull()
    // 不抛错、也不改变这一屏画出来的东西：行与顺序与不带 focus 时逐条一致。
    const plain = await render()
    expect(rowKeys(got)).toEqual(rowKeys(plain))
    expect(rowKeys(got).length).toBeGreaterThan(0)
  })

  it('does not scroll when no focus was asked for', async () => {
    await render()
    expect(scrollSpy).not.toHaveBeenCalled()
  })
  it('keeps exactly one marker after two jumps in a row', async () => {
    // 新跳转先清旧标记（副作用 cleanup），不许累计成两个描边。
    const host = await render('binance-announcements')
    const first = host.querySelector<HTMLElement>('[data-source-row="binance-announcements"]')!
    expect(first.getAttribute('data-focused')).toBe('true')

    await act(async () => {
      root!.render(createElement(ShellLanguageProvider, { language: 'zh-CN', children: createElement(ProviderDetail, {
        initialSourceId: 'binance-spot-market',
        labels,
        provider: { providerId: 'p', displayName: 'P', category: 'macro', credential: 'none', healthMarker: 'none', sources: SOURCES.map(source) },
        showSourceDetails: true
      } as never) }))
    })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    const marked = [...host.querySelectorAll<HTMLElement>('[data-focused="true"]')]
    expect(marked).toHaveLength(1)
    expect(marked[0]?.getAttribute('data-source-row')).toBe('binance-spot-market')
    expect(document.activeElement).toBe(marked[0])
    expect(first.getAttribute('data-focused')).toBeNull()
  })

})
