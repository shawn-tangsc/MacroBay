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
 * 抽屉常驻，别处改了格级设置，这里不跟就是一张过期表。
 *
 * 三条判据：不轮询（只靠域信号）、连点只引出一轮在读（次数可数）、自己写出的那条信号不重读。
 *
 * **等待一律条件等待**（`vi.waitFor`），不数 `await flush()` 的次数：全量并发下固定的两拍不够，
 * 会把「时机」当成「行为」判红（2026-11-11 全量唯一一例 flaky）。`vi.waitFor` 自带超时，
 * 等不到就是真红。
 */
const t = productText['zh-CN'].settings.intelligenceSources
let root: ReturnType<typeof createRoot> | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

/** 只给「此刻不该发生」的断言用：让挂起的 promise 链跑完，不当作成功条件。 */
const settle = async (): Promise<void> => {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)) })
}

async function render(options: Readonly<{ origin?: string }> = {}): Promise<{ reads: () => number }> {
  const counter = { reads: 0 }
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(createElement(ShellLanguageProvider, {
      language: 'zh-CN',
      children: createElement(SourcesSettingsPane, {
        cellEnabledIo: {
          read: async () => {
            counter.reads += 1
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
  // 挂载时那一轮读：等到它真的跑完，而不是数两拍。
  await vi.waitFor(() => { expect(counter.reads).toBe(1) })
  return { reads: () => counter.reads }
}

describe('设置页格开关表跟随来源域信号重读', () => {
  it('re-reads once when another interface changes a cell', async () => {
    const state = await render({ origin: 'settings-instance' })
    await act(async () => { notifySettingsRevision('sources', 'drawer-instance') })
    await vi.waitFor(() => { expect(state.reads()).toBe(2) })
  })

  it('coalesces a burst of signals into one extra read (no polling per click)', async () => {
    const state = await render({ origin: 'settings-instance' })
    await act(async () => {
      notifySettingsRevision('sources', 'a')
      notifySettingsRevision('sources', 'b')
      notifySettingsRevision('sources', 'c')
    })
    // 三条信号、读一轮在飞 → 只补一次（等到 +1 成立）。
    await vi.waitFor(() => { expect(state.reads()).toBe(2) })
    // 补读跑完之后不许再冒出第三次（这一条断言「没有多读」，不是成功条件，所以用 settle）。
    await settle()
    expect(state.reads()).toBe(2)
  })

  it('ignores the signal it emitted itself', async () => {
    const state = await render({ origin: 'settings-instance' })
    await act(async () => { notifySettingsRevision('sources', 'settings-instance') })
    await settle()
    expect(state.reads()).toBe(1)
  })
})
