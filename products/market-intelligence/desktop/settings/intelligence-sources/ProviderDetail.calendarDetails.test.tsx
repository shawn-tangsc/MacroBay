// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { ProviderDetail } from './ProviderDetail'
import type { ProviderDetailLabels } from './ProviderDetail'
import type { ProviderView, SourceView } from '../../../service/intelligence/application/sourceProjection'

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
    sourceNames: {},
    providerNames: {},
    panelNames: settingsText.panelNames,
    badges: settingsText.sourceBadges,
    status: settingsText.status,
    capabilities: settingsText.providerSummary,
    toggleSource: settingsText.toggleSource,
    credentials: settingsText.credentialsRequired,
    website: settingsText.website,
    signup: settingsText.signup,
    inviteNote: settingsText.inviteNote,
    testConnection: settingsText.testConnection,
    jobRegistered: settingsText.jobRegistered,
    jobNotRegistered: settingsText.jobNotRegistered,
    connectionSucceeded: settingsText.connectionSucceeded,
    connectionFailed: settingsText.connectionFailed,
    connectionUnsupported: settingsText.connectionUnsupported,
    apiKey: settingsText.apiKey,
    unavailableReasonCode: settingsText.unavailableReasonCode,
    automaticSyncStopped: settingsText.automaticSyncStopped,
    lastSuccessfulSync: settingsText.lastSuccessfulSync
  }
}

function source(input: Partial<SourceView> & Pick<SourceView, 'sourceId' | 'displayName'>): SourceView {
  return {
    providerId: 'fed',
    agents: ['crypto'],
    panels: [],
    visibility: 'visible',
    collection: 'provider',
    kind: 'feed',
    capabilities: { runNow: 'provider', testConnection: true },
    readiness: 'live',
    enabled: true,
    ...input
  }
}

function fedProvider(): ProviderView {
  return {
    providerId: 'fed',
    displayName: 'Federal Reserve Board (Fed)',
    category: 'macro',
    credential: 'none',
    sources: [
      source({ sourceId: 'macro-calendar-fed', displayName: 'Fed official schedule', kind: 'official-calendar', panels: ['dashboard', 'economic-calendar'] }),
      source({ sourceId: 'federal-reserve-rss', displayName: 'Fed RSS', collection: 'adapter', kind: 'feed' })
    ]
  }
}

async function flush(): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

describe('ProviderDetail source details', () => {
  it('does not ask the generic source service for calendar feed details', async () => {
    const pageStateRequests: string[] = []
    const invoke = vi.fn(async (_productId: string, method: string, payload?: { sourceId?: string }) => {
      if (method === 'intelligenceSources.getPageState' && payload?.sourceId) {
        pageStateRequests.push(payload.sourceId)
      }
      return undefined
    })
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }

    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ProviderDetail, {
        labels: labels(),
        provider: fedProvider(),
        showSourceDetails: true,
        onSelectSource: () => undefined
      }))
      await Promise.resolve()
    })
    await flush()

    expect(pageStateRequests).not.toContain('macro-calendar-fed')
    expect(pageStateRequests).toContain('federal-reserve-rss')
  })

  it('does not paint an enabled calendar source healthy when it has no health data', async () => {
    // 缺陷（宏观线报）：已启用 + jobRegistered + 无健康数据 → 过去这里画绿的 healthy。
    // BLS 正是这种源：已启用、实际取不到；假绿比没有状态更坏。
    const invoke = vi.fn(async () => undefined)
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }

    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ProviderDetail, {
        labels: labels(),
        provider: {
          providerId: 'bls',
          displayName: 'Bureau of Labor Statistics (BLS)',
          category: 'macro',
          credential: 'none',
          sources: [source({
            providerId: 'bls',
            sourceId: 'macro-calendar-bls',
            displayName: 'BLS official schedule',
            kind: 'official-calendar',
            jobRegistered: true
          })]
        },
        showSourceDetails: true,
        onSelectSource: () => undefined
      }))
      await Promise.resolve()
    })
    await flush()

    expect(container.textContent).not.toContain(settingsText.health.statuses.healthy)
    expect(container.querySelector('.status-pill--ok')).toBeNull()
  })

  it('shows “unavailable”, the reason and the last good date for a source the platform cannot fetch', async () => {
    const invoke = vi.fn(async () => undefined)
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }

    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ProviderDetail, {
        labels: labels(),
        provider: {
          providerId: 'bls',
          displayName: 'Bureau of Labor Statistics (BLS)',
          category: 'macro',
          credential: 'none',
          sources: [source({
            providerId: 'bls',
            sourceId: 'macro-calendar-bls',
            displayName: 'BLS official schedule',
            kind: 'official-calendar',
            jobRegistered: false,
            unavailable: {
              reasonCode: 'official-endpoint-returned-403',
              automaticSync: 'stopped',
              lastSuccessfulSyncAt: '2026-10-22T07:29:41.000Z',
              decidedAt: '2026-11-08'
            }
          })]
        },
        showSourceDetails: true,
        onSelectSource: () => undefined
      }))
      await Promise.resolve()
    })
    await flush()

    // 设置页用**短句**（逐字，含「暂时」）：这里不显示内容，不套「先显示上次同步的内容」全句。
    expect(container.textContent).toContain('官方源暂时不可用')
    expect(container.textContent).not.toContain('先显示上次成功同步的内容')
    // 原因码、自动同步已停止、上次成功日期照原样给。
    expect(container.textContent).toContain('official-endpoint-returned-403')
    expect(container.textContent).toContain('自动同步已停止')
    expect(container.textContent).toContain('2026-10-22')
    expect(container.querySelector('.status-pill--ok')).toBeNull()
    // 「未安排」不许显示成「已启用」。
    expect(container.textContent).toContain(settingsText.jobNotRegistered)
  })

  it('does not paint “enabled” next to “unavailable”: one of them has to win', async () => {
    // 缺陷（界面自查退回 ③）：已启用 + 未安排 + 不可用 三个标签并排，读者不知道哪个说了算。
    // 这个源是启用的（开关位为真），但这不改变「现在取不到」——启用词在这一行必须让位。
    const invoke = vi.fn(async () => undefined)
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }

    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ProviderDetail, {
        labels: labels(),
        provider: {
          providerId: 'bls',
          displayName: 'Bureau of Labor Statistics (BLS)',
          category: 'macro',
          credential: 'none',
          sources: [source({
            providerId: 'bls',
            sourceId: 'macro-calendar-bls',
            displayName: 'BLS official schedule',
            kind: 'official-calendar',
            jobRegistered: false,
            // panels 非空：否则首标签是「待接入」，这条用例就测不到启用词本身。
            panels: ['economic-calendar'],
            unavailable: {
              reasonCode: 'official-endpoint-returned-403',
              automaticSync: 'stopped',
              lastSuccessfulSyncAt: '2026-10-22T07:29:41.000Z',
              decidedAt: '2026-11-08'
            }
          })]
        },
        showSourceDetails: true,
        onSelectSource: () => undefined
      }))
      await Promise.resolve()
    })
    await flush()

    // 只看这一行的标签排（页头的「1 项能力 · 已启用 1」是另一件事）。
    const rowTags = container.querySelector('.source-provider-detail__row .intelligence-source-tags')?.textContent ?? ''
    expect(rowTags).toContain('官方源暂时不可用')
    expect(rowTags).toContain(settingsText.jobNotRegistered)
    expect(rowTags).not.toContain(settingsText.status.enabled)
    expect(rowTags).not.toContain(settingsText.status.disabled)
  })
})
