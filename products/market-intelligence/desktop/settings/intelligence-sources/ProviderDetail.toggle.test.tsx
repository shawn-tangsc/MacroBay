// @vitest-environment happy-dom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { ProviderDetail, type ProviderDetailLabels } from './ProviderDetail'
import type { ProviderView, SourceView } from '../../../service/intelligence/application/sourceProjection'

/**
 * S1：启用状态**一个值、一个写入点**。
 *
 * 两处控件（这里是同一投影出的两份宿主）读同一个 `enabled`，点哪一处都走同一个回调；
 * 写入失败时两处一起保持旧值——不许一处乐观、一处不动。
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

describe('one enable value, one write (S1)', () => {
  it('toggles through the injected writer and keeps the component from calling the client itself', async () => {
    const invoke = vi.fn(async (_productId: string, _method: string) => undefined)
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }
    const write = vi.fn(async () => true)
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ProviderDetail, {
        labels: labels(), onToggleSource: write, provider: provider(true), showSourceDetails: true
      }))
      await Promise.resolve()
    })
    await flush()

    const toggle = container.querySelector<HTMLButtonElement>('button[role="switch"]')!
    await act(async () => { toggle.click() })
    await flush()

    expect(write).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 's1' }), false)
    // 组件自己不再调 IPC——写入只有宿主那一条路。
    expect(invoke.mock.calls.some(([, method]) => method === 'intelligenceSources.setEnabled')).toBe(false)
    expect(container.querySelector('button[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
  })

  it('keeps both places on the same value: one write, both switches follow', async () => {
    const invoke = vi.fn(async (_productId: string, _method: string) => undefined)
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }
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

    const switches = container.querySelectorAll<HTMLButtonElement>('[data-pane="a"] button[role="switch"]')
    expect(switches).toHaveLength(1)
    await act(async () => { switches[0]!.click() })
    await flush()

    // 一次写入；两处读同一个值，都跟着变成关。
    expect(writes).toEqual([['s1', false]])
    for (const pane of ['a', 'b']) {
      expect(container.querySelector(`[data-pane="${pane}"] button[role="switch"]`)?.getAttribute('aria-checked')).toBe('false')
    }
  })

  it('rolls both places back when the single write fails', async () => {
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke: vi.fn(async () => undefined) } }
    let resolveWrite: (ok: boolean) => void = () => {}
    const write = vi.fn(() => new Promise<boolean>((resolve) => { resolveWrite = resolve }))

    function Host(): React.ReactElement {
      const [enabled, setEnabled] = useState(true)
      const apply = async (target: Readonly<{ sourceId: string; kind: string }>, next: boolean): Promise<boolean> => {
        const ok = await write()
        if (ok) setEnabled(next)
        return ok
      }
      const detail = <ProviderDetail labels={labels()} onToggleSource={apply} provider={provider(enabled)} showSourceDetails />
      return <div><div data-pane="a">{detail}</div><div data-pane="b">{detail}</div></div>
    }

    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => { root?.render(createElement(Host)); await Promise.resolve() })
    await flush()

    const toggle = container.querySelector<HTMLButtonElement>('[data-pane="a"] button[role="switch"]')!
    await act(async () => { toggle.click() })
    // 乐观：先翻过去。
    expect(container.querySelector('[data-pane="a"] button[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
    resolveWrite(false)
    await flush()

    // 失败：宿主值没变，两处都回到开。
    for (const pane of ['a', 'b']) {
      expect(container.querySelector(`[data-pane="${pane}"] button[role="switch"]`)?.getAttribute('aria-checked')).toBe('true')
    }
  })

  it('does not let a confirmed local value shadow a later change from another place', async () => {
    // 回归：一次成功拨动后乐观值从不清，另一处关掉同一个源、这边重读了仍显示开——C8 的联动失效。
    function Host(): React.ReactElement {
      const [serverEnabled, setServerEnabled] = useState(false)
      const [tick, setTick] = useState(0)
      const write = async (_target: Readonly<{ sourceId: string; kind: string }>, next: boolean): Promise<boolean> => {
        // 写成功后宿主的重读带回新值（这里直接反映到 serverEnabled）。
        setServerEnabled(next)
        return true
      }
      return <div data-tick={tick}>
        <button onClick={() => setServerEnabled(false)} type="button">server-off</button>
        <button onClick={() => setTick((value) => value + 1)} type="button">rerender</button>
        <ProviderDetail labels={labels()} onToggleSource={write} provider={provider(serverEnabled)} showSourceDetails />
      </div>
    }

    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => { root?.render(createElement(Host)); await Promise.resolve() })
    await flush()

    const toggle = container.querySelector<HTMLButtonElement>('button[role="switch"]')!
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    await act(async () => { toggle.click() })
    await flush()
    expect(container.querySelector('button[role="switch"]')?.getAttribute('aria-checked')).toBe('true')

    // 另一处把同一个源关掉：宿主重读后必须跟着关。
    const serverOff = [...container.querySelectorAll('button')].find((button) => button.textContent === 'server-off')
    await act(async () => { serverOff?.click() })
    await flush()
    expect(container.querySelector('button[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
  })

  it('keeps the value the reader just picked while the write is still in flight', async () => {
    // 对立面：只做上一条会变成「一拨就弹回服务端旧值」，那是另一个 bug。
    let resolveWrite: (ok: boolean) => void = () => {}
    const write = vi.fn(() => new Promise<boolean>((resolve) => { resolveWrite = resolve }))

    function Host(): React.ReactElement {
      const [tick, setTick] = useState(0)
      return <div data-tick={tick}>
        <button onClick={() => setTick((value) => value + 1)} type="button">rerender</button>
        <ProviderDetail labels={labels()} onToggleSource={write} provider={provider(false)} showSourceDetails />
      </div>
    }

    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => { root?.render(createElement(Host)); await Promise.resolve() })
    await flush()

    const toggle = container.querySelector<HTMLButtonElement>('button[role="switch"]')!
    await act(async () => { toggle.click() })
    expect(container.querySelector('button[role="switch"]')?.getAttribute('aria-checked')).toBe('true')

    // 服务端还是旧值（false），但读者刚拨过、写还没回来：不许弹回去。
    const rerender = [...container.querySelectorAll('button')].find((button) => button.textContent === 'rerender')
    await act(async () => { rerender?.click() })
    await flush()
    expect(container.querySelector('button[role="switch"]')?.getAttribute('aria-checked')).toBe('true')

    resolveWrite(false)
    await flush()
    // 写失败才回滚。
    expect(container.querySelector('button[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
  })
})
