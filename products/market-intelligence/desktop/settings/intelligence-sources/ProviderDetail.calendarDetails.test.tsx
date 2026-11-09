// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
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
    unavailableReasonCodeAria: settingsText.unavailableReasonCodeAria,
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
        showSourceDetails: true
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
      
      }))
      await Promise.resolve()
    })
    await flush()

    // 设置页用**短句**（逐字，含「暂时」）：这里不显示内容，不套「先显示上次同步的内容」全句。
    expect(container.textContent).toContain('官方源暂时不可用')
    expect(container.textContent).not.toContain('先显示上次成功同步的内容')
    // 正文只给读者说法（映射表），**完整原因码不进正文**；它在 ⓘ 里，恰一处。
    expect(container.textContent).toContain('官方源暂时不可用（403）')
    expect(container.textContent).not.toContain('official-endpoint-returned-403')
    const reasonTrigger = container.querySelector<HTMLElement>('[aria-label="原因码"]')
    expect(reasonTrigger).not.toBeNull()
    expect(container.querySelectorAll('[aria-label="原因码"]')).toHaveLength(1)
    expect(container.textContent).toContain('自动同步已停止')
    expect(container.textContent).toContain('2026-10-22')
    expect(container.querySelector('.status-pill--ok')).toBeNull()
    // 「未安排」不许显示成「已启用」。
    expect(container.textContent).toContain(settingsText.jobNotRegistered)
  })

  it('falls back to the sentence without a number when the reason code is unknown', async () => {
    // 码名一改（或加了个没登记的新码）就该落到这一支：**不从码里截数字，也不许抛错**。
    // 没有这条，「表里没有的码」永远没人跑过——`?? fallback` 写成抛错也照样全绿。
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
            jobRegistered: true,
            unavailable: {
              // 今天原因码是**闭集**，未知码只能这样注进来——这条用例钉的正是「以后加码时
              // fallback 必须活着」：不截数字、不抛错。
              reasonCode: 'endpoint-vanished-somewhere' as never,
              automaticSync: 'stopped',
              lastSuccessfulSyncAt: '2026-10-22T07:29:41.000Z',
              decidedAt: '2026-11-08'
            }
          })]
        },
        showSourceDetails: true
      }))
      await Promise.resolve()
    })
    await flush()

    const text = container.textContent ?? ''
    expect(text).toContain(settingsText.unavailableShort)
    // 不带数字：退回的是那句没有括号的说法。
    expect(text).not.toContain('（403）')
    // 码本身仍然在 ⓘ 里（不是被吞掉），只是不进正文。
    expect(container.querySelectorAll('[aria-label="原因码"]')).toHaveLength(1)
  })

  it('does not dress a source row as an entrance it cannot honour', async () => {
    // 缺陷（MI-10-R17）：行入口的 onSelectSource 一直是空回调，点了没有任何反应——「看着能点、
    // 其实没有去处」。修法是**渲染成非交互行**：不是按钮、没有箭头、没有 hover 指路。
    const invoke = vi.fn(async () => undefined)
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }

    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ProviderDetail, {
        labels: labels(),
        provider: fedProvider(),
        showSourceDetails: true
      }))
      await Promise.resolve()
    })
    await flush()

    const row = container.querySelector('.source-provider-detail__main')
    expect(row).not.toBeNull()
    expect(row?.tagName).toBe('DIV')
    expect(row?.hasAttribute('onclick')).toBe(false)
    expect(container.querySelector('.source-provider-detail__chevron')).toBeNull()
  })

  it('formats the last good sync day in the reader\'s time zone instead of slicing the instant', async () => {
    // 缺陷：`lastSuccessfulSyncAt.slice(0, 10)` 手拼日期，读者时区不同会显示成前一天。
    // 02:00Z 在纽约是前一天的 22:00：正确显示是 2026-10-21，切字符串永远是 2026-10-22。
    const invoke = vi.fn(async () => undefined)
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }

    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ShellTimeZoneProvider, {
        timeZone: 'America/New_York',
        children: createElement(ProviderDetail, {
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
                lastSuccessfulSyncAt: '2026-10-22T02:00:00.000Z',
                decidedAt: '2026-11-08'
              }
            })]
          },
          showSourceDetails: true
        })
      }))
      await Promise.resolve()
    })
    await flush()

    expect(container.textContent).toContain('2026-10-21')
    expect(container.textContent).not.toContain('2026-10-22')
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
        showSourceDetails: true
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
