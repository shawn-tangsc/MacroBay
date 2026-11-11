// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import {
  SETTINGS_REVISION_EVENT,
  type SettingsRevisionDetail
} from '../../shared/events/settingsRevision'
import { productText } from '../../shared/i18n/productText'
import { SourcesSettingsPane } from './SourcesSettingsPane'

/**
 * 卡片项那颗开关**只写格**（用户 2026-11-12）：
 * - 开：写格 true + 选中该源；
 * - 关：写格 false。
 *
 * 源采不采只由「数据源」页头那颗决定——关一格**不许**顺手把源停掉（用户原话：
 * 「关某个源项，怎么能自动把源也关了」）。所以两条用例都断言 `onToggleSource` **零调用**；
 * 谁把「关最后一格就停源」加回来，这两条都会红。
 */
const t = productText['zh-CN'].settings.intelligenceSources
let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

function source(sourceId: string) {
  return {
    sourceId, providerId: 'p', displayName: sourceId, agents: [], panels: ['dashboard'],
    visibility: 'visible', collection: 'adapter', kind: 'feed', capabilities: {}, readiness: 'live',
    enabled: true, healthState: 'healthy', healthMarker: 'none'
  }
}

async function render(
  initial: Readonly<Record<string, boolean>> = {},
  options: Readonly<{ failWrite?: boolean; origin?: string }> = {}
): Promise<{
  host: HTMLElement
  onToggleSource: ReturnType<typeof vi.fn>
  writes: Array<[string, boolean]>
  selections: Array<[string, string | null]>
  events: SettingsRevisionDetail[]
}> {
  const onToggleSource = vi.fn(async () => true)
  const writes: Array<[string, boolean]> = []
  const selections: Array<[string, string | null]> = []
  const events: SettingsRevisionDetail[] = []
  const onRevision = (event: Event): void => {
    const detail = (event as CustomEvent<SettingsRevisionDetail>).detail
    if (detail?.domain === 'sources') events.push(detail)
  }
  window.addEventListener(SETTINGS_REVISION_EVENT, onRevision)
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(ShellLanguageProvider, {
      language: 'zh-CN',
      children: createElement(SourcesSettingsPane, {
        cellEnabledIo: {
          read: async () => initial,
          write: async (cellId: string, enabled: boolean) => {
            writes.push([cellId, enabled])
            if (options.failWrite === true) throw new Error('write failed')
          },
          writeSelection: async (cellId: string, sourceId: string | null) => { selections.push([cellId, sourceId]) }
        },
        filter: 'all',
        onFilterChange: vi.fn(),
        onSelectProvider: vi.fn(),
        pane: 'business',
        surface: {
          text: t,
          onDraftChange: vi.fn(),
          onRunNow: async () => undefined,
          onToggleSource,
          policy: { labels: t.collectionPolicy, onChange: vi.fn(), profiles: {} },
          showSourceDetails: true,
          ...(options.origin === undefined ? {} : { revisionOrigin: options.origin })
        } as never,
        treeLabels: {
          title: t.title, categories: t.sourceCategories, providerNames: t.providerNames,
          unavailableCountOne: t.unavailableCountOne,
          unavailableCountOther: t.unavailableCountOther
        } as never,
        view: {
          groups: [{ category: 'macro', providers: [{ providerId: 'p', displayName: 'p', category: 'macro', credential: 'none', healthMarker: 'none', sources: [source('binance-futures-positioning'), source('realmarketapi-market')] }] }],
          counts: { total: 2, enabled: 2, pending: 0, failed: 0 }
        } as never
      })
    }))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return {
    host,
    onToggleSource,
    writes,
    selections,
    events,
    dispose: () => window.removeEventListener(SETTINGS_REVISION_EVENT, onRevision)
  } as never
}

describe('卡片项开关只写格，不碰源启停', () => {
  it('writes the cell and its selection when a cell is enabled, and never toggles the source', async () => {
    const { host, onToggleSource, writes, selections } = await render({ 'quotes:btc': false })
    const row = host.querySelector<HTMLElement>('[data-cell-id="quotes:btc"]')
    const control = row?.querySelector<HTMLElement>('[role="switch"]')
    await act(async () => { control?.click() })
    expect(writes).toContainEqual(['quotes:btc', true])
    expect(selections).toContainEqual(['quotes:btc', 'binance-futures-positioning'])
    expect(onToggleSource).not.toHaveBeenCalled()
  })

  it('writes only the cell when it is disabled — even when it is the last cell using that source', async () => {
    // 纳指那格是 binance-futures-positioning 的唯一一格：关它，源仍必须保持启用。
    const { host, onToggleSource, writes } = await render({ 'quotes:ndx': true })
    const row = host.querySelector<HTMLElement>('[data-cell-id="quotes:ndx"]')
    const control = row?.querySelector<HTMLElement>('[role="switch"]')
    await act(async () => { control?.click() })
    expect(writes).toContainEqual(['quotes:ndx', false])
    expect(onToggleSource).not.toHaveBeenCalled()
  })
})

/**
 * 格级写入要发**一次**域信号（用户 2026-11-12 真机：在看板打开 FOMC 那格，回看板仍显示
 * 「来源没有启用」，必须重开界面才变）。开一格是两次写（写格 + 选源），信号只许发一条。
 */
describe('卡片项开关写完发一次来源域信号', () => {
  it('emits exactly one sources event for one click, with the host banner origin', async () => {
    const { host, events, dispose } = await render({ 'quotes:btc': false }, { origin: 'drawer-instance' }) as never as {
      host: HTMLElement
      events: SettingsRevisionDetail[]
      dispose: () => void
    }
    const control = host.querySelector<HTMLElement>('[data-cell-id="quotes:btc"] [role="switch"]')
    await act(async () => { control?.click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    dispose()
    // 两次写（写格 true + 写选源）合并成**一条**信号。
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ domain: 'sources', origin: 'drawer-instance' })
  })

  it('emits one event when switching the cell off too', async () => {
    const { host, events, dispose } = await render({ 'quotes:ndx': true }, { origin: 'drawer-instance' }) as never as {
      host: HTMLElement
      events: SettingsRevisionDetail[]
      dispose: () => void
    }
    const control = host.querySelector<HTMLElement>('[data-cell-id="quotes:ndx"] [role="switch"]')
    await act(async () => { control?.click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    dispose()
    expect(events).toHaveLength(1)
  })

  it('emits nothing when the write fails (a failed write must not look applied)', async () => {
    const { host, events, dispose } = await render({ 'quotes:btc': false }, { origin: 'drawer-instance', failWrite: true }) as never as {
      host: HTMLElement
      events: SettingsRevisionDetail[]
      dispose: () => void
    }
    const control = host.querySelector<HTMLElement>('[data-cell-id="quotes:btc"] [role="switch"]')
    await act(async () => { control?.click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    dispose()
    expect(events).toHaveLength(0)
  })
})
