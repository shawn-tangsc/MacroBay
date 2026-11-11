// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { notifySettingsRevision } from '../../shared/events/settingsRevision'
import { productText } from '../../shared/i18n/productText'
import { SourcesSettingsPane } from './SourcesSettingsPane'

/**
 * 设置页「采集与数据」那张格开关表要和看板那条**互为镜像**（用户 2026-11-12）：
 * 抽屉常驻，别处（看板、另一个窗口里的自己）改了格级设置，这里不跟就是一张过期表。
 *
 * 三条判据：不轮询（只靠域信号）、连点只引出一轮在读（次数可数）、自己写出的那条信号不重读。
 */
const t = productText['zh-CN'].settings.intelligenceSources
let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

const flush = async (): Promise<void> => {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

async function render(options: Readonly<{ origin?: string }> = {}): Promise<{ reads: number }> {
  let reads = 0
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(ShellLanguageProvider, {
      language: 'zh-CN',
      children: createElement(SourcesSettingsPane, {
        cellEnabledIo: {
          read: async () => {
            reads += 1
            // 让读**留在飞行中**：连发的信号必须合并成一次补读，而不是各读一遍。
            await new Promise((resolve) => setTimeout(resolve, 5))
            return { 'quotes:btc': false }
          },
          write: async () => undefined
        },
        filter: 'all',
        onFilterChange: vi.fn(),
        onSelectProvider: vi.fn(),
        pane: 'business',
        surface: {
          text: t,
          onDraftChange: vi.fn(),
          onRunNow: async () => undefined,
          onToggleSource: async () => true,
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
          groups: [{ category: 'macro', providers: [{ providerId: 'p', displayName: 'p', category: 'macro', credential: 'none', healthMarker: 'none', sources: [{
            sourceId: 'binance-futures-positioning', providerId: 'p', displayName: 'p', agents: [], panels: ['dashboard'],
            visibility: 'visible', collection: 'adapter', kind: 'feed', capabilities: {}, readiness: 'live',
            enabled: true, healthState: 'healthy', healthMarker: 'none'
          }] }] }],
          counts: { total: 1, enabled: 1, pending: 0, failed: 0 }
        } as never
      })
    }))
  })
  await flush()
  await flush()
  return { get reads() { return reads } } as never as { reads: number }
}

describe('设置页格开关表跟随来源域信号重读', () => {
  it('re-reads once when another interface changes a cell', async () => {
    const state = await render({ origin: 'settings-instance' })
    const before = state.reads
    await act(async () => { notifySettingsRevision('sources', 'drawer-instance') })
    await flush()
    await flush()
    expect(state.reads).toBe(before + 1)
  })

  it('coalesces a burst of signals into one extra read (no polling per click)', async () => {
    const state = await render({ origin: 'settings-instance' })
    const before = state.reads
    await act(async () => {
      notifySettingsRevision('sources', 'a')
      notifySettingsRevision('sources', 'b')
      notifySettingsRevision('sources', 'c')
    })
    await flush()
    await flush()
    // 三条信号、读一轮在飞 → 只补一次。
    expect(state.reads).toBe(before + 1)
  })

  it('ignores the signal it emitted itself', async () => {
    const state = await render({ origin: 'settings-instance' })
    const before = state.reads
    await act(async () => { notifySettingsRevision('sources', 'settings-instance') })
    await flush()
    await flush()
    expect(state.reads).toBe(before)
  })
})