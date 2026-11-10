// @vitest-environment happy-dom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { ProviderDetail, type ProviderDetailLabels } from './ProviderDetail'
import type { ProviderView, SourceView } from '../../../service/intelligence/application/sourceProjection'

/**
 * 启用状态**一个值、一个写入点**（用户 2026-11-12 定稿）：
 * 页头那颗组开关写**源自己的采集开关**（`enabled`），它是这一屏唯一的写入口；
 * 下面能力行的开关只读——读的是「采集与数据」里用到它的那些格，点了不发写请求。
 *
 * 两处控件（这里是同一投影出的两份宿主）读同一个 `enabled`，写入失败时一起保持旧值。
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
    automaticSyncStopped: settingsText.automaticSyncStopped, lastSuccessfulSync: settingsText.lastSuccessfulSync,
    health: settingsText.health
  }
}

function source(enabled: boolean): SourceView {
  return {
    sourceId: 's1', providerId: 'p1', displayName: 'S1', agents: ['crypto'], panels: ['dashboard'],
    visibility: 'visible', collection: 'adapter', kind: 'feed', capabilities: { runNow: 'adapter', testConnection: true },
    readiness: 'live', enabled, healthState: enabled ? 'healthy' : 'off', healthMarker: 'none'
  }
}

function provider(enabled: boolean): ProviderView {
  return { providerId: 'p1', displayName: 'P1', category: 'macro', credential: 'none', healthMarker: 'none', sources: [source(enabled)] }
}

async function flush(): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

const HEADER_SWITCH = '.source-provider-detail__group-toggle button[role="switch"]'
const ROW_SWITCH = '.source-provider-detail__list [role="switch"]'

describe('one enable value, one write', () => {
  it('writes through the header switch and keeps the capability row read-only', async () => {
    const writes: Array<[string, boolean]> = []
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke: vi.fn(async () => undefined) } }
    const write = async (target: Readonly<{ sourceId: string; kind: string }>, next: boolean): Promise<boolean> => {
      writes.push([target.sourceId, next])
      return true
    }
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => { root?.render(createElement(ProviderDetail, {
      labels: labels(),
      onToggleSource: write,
      provider: provider(true),
      showSourceDetails: true
    })); await Promise.resolve() })
    await flush()

    const header = container.querySelector<HTMLButtonElement>(HEADER_SWITCH)
    expect(header?.getAttribute('aria-checked')).toBe('true')
    expect(header?.disabled).toBe(false)
    await act(async () => { header?.click() })
    await flush()
    expect(writes).toEqual([['s1', false]])

    // 能力行那颗只读：点了不发写请求（状态由「采集与数据」的格开关决定）。
    const row = container.querySelector<HTMLButtonElement>(ROW_SWITCH)
    expect(row?.disabled).toBe(true)
    await act(async () => { row?.click() })
    await flush()
    expect(writes).toEqual([['s1', false]])
  })

  it('keeps both hosts on the same value: one write, both headers follow', async () => {
    const writes: Array<[string, boolean]> = []

    function Host(): React.ReactElement {
      const [enabled, setEnabled] = useState(true)
      const write = async (target: Readonly<{ sourceId: string; kind: string }>, next: boolean): Promise<boolean> => {
        writes.push([target.sourceId, next])
        setEnabled(next)
        return true
      }
      const detail = <ProviderDetail labels={labels()} onToggleSource={write} provider={provider(enabled)} showSourceDetails />
      return <div>
        <div data-pane="a">{detail}</div>
        <div data-pane="b">{detail}</div>
      </div>
    }

    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => { root?.render(createElement(Host)); await Promise.resolve() })
    await flush()

    await act(async () => { container.querySelector<HTMLButtonElement>(`[data-pane="a"] ${HEADER_SWITCH}`)?.click() })
    await flush()

    // 一次写入；两处读同一个值，都跟着变成关。
    expect(writes).toEqual([['s1', false]])
    for (const pane of ['a', 'b']) {
      expect(container.querySelector(`[data-pane="${pane}"] ${HEADER_SWITCH}`)?.getAttribute('aria-checked')).toBe('false')
    }
  })

  it('rolls both places back when the single write fails', async () => {
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke: vi.fn(async () => undefined) } }
    const write = vi.fn(async () => false)

    function Host(): React.ReactElement {
      const [enabled] = useState(true)
      return <div>
        <div data-pane="a"><ProviderDetail labels={labels()} onToggleSource={write} provider={provider(enabled)} showSourceDetails /></div>
        <div data-pane="b"><ProviderDetail labels={labels()} onToggleSource={write} provider={provider(enabled)} showSourceDetails /></div>
      </div>
    }

    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => { root?.render(createElement(Host)); await Promise.resolve() })
    await flush()

    await act(async () => { container.querySelector<HTMLButtonElement>(`[data-pane="a"] ${HEADER_SWITCH}`)?.click() })
    await flush()

    expect(write).toHaveBeenCalledTimes(1)
    // 写失败 → 乐观值回滚，两处都留在旧值（开）。
    for (const pane of ['a', 'b']) {
      expect(container.querySelector(`[data-pane="${pane}"] ${HEADER_SWITCH}`)?.getAttribute('aria-checked')).toBe('true')
    }
  })
})
