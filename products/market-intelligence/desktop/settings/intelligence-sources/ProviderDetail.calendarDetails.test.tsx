// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { ProviderDetail } from './ProviderDetail'
import type { ProviderDetailLabels } from './ProviderDetail'
import { sourceHealthMarker, sourceHealthState, type ProviderView, type SourceView } from '../../../service/intelligence/application/sourceProjection'

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
    lastSuccessfulSync: settingsText.lastSuccessfulSync,
    health: settingsText.health
  }
}

/**
 * 夹具照**处境**挑健康档，且用服务端那两个函数算——不在这里另判一遍。
 *
 * 两档不是一一对应：`ring` 只给「已启用但取不到」，`none` 给未启用/没有读数。所以不可用的源
 * （BLS 403 那种）落到 `off` / `ring`，关掉的源落到 `off` / `none`，能正常采集的才是 `healthy` / `none`。
 * 一律写 `healthy` 会让夹具说一件不成立的事：读者看到的那一行明明写着「不可用」。
 */
function source(input: Partial<SourceView> & Pick<SourceView, 'sourceId' | 'displayName'>): SourceView {
  const enabled = input.enabled ?? true
  const unavailable = input.unavailable !== undefined
  const healthState = sourceHealthState({ enabled, unavailable })
  return {
    providerId: 'fed',
    agents: ['crypto'],
    panels: [],
    visibility: 'visible',
    collection: 'provider',
    kind: 'feed',
    capabilities: { runNow: 'provider', testConnection: true },
    readiness: 'live',
    enabled,
    healthState,
    healthMarker: sourceHealthMarker({ enabled, unavailable, state: healthState }),
    ...input
  }
}

function fedProvider(): ProviderView {
  return {
    providerId: 'fed',
    displayName: 'Federal Reserve Board (Fed)',
    category: 'macro',
    credential: 'none',
    healthMarker: 'none',
    sources: [
      source({ sourceId: 'macro-calendar-fed', displayName: 'Fed official schedule', kind: 'official-calendar', panels: ['dashboard', 'economic-calendar'] }),
      source({ sourceId: 'federal-reserve-rss', displayName: 'Fed RSS', collection: 'adapter', kind: 'feed' })
    ]
  }
}

async function flush(): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

type PolicyProp = NonNullable<Parameters<typeof ProviderDetail>[0]['policy']>

/** 采集策略组必须先渲染出来，才测得到「原因挂在组上」这件事：给每个源一份最小 profile。 */
function policyFor(sourceIds: readonly string[]): PolicyProp {
  const profiles: Record<string, PolicyProp['profiles'][string]> = {}
  for (const sourceId of sourceIds) {
    profiles[sourceId] = {
      profileId: `profile-${sourceId}`,
      sourceId,
      enabled: true,
      collectionPreset: 'balanced',
      includeInSentiment: false,
      scopePolicy: 'all',
      rawArchiveEnabled: false,
      retentionMode: 'balanced',
      autoReplayAfterParserUpgrade: false,
      updatedAt: '2026-11-01T00:00:00.000Z'
    }
  }
  return { profiles, labels: settingsText.collectionPolicy, supportsSentimentById: {}, onChange: () => {} }
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
          healthMarker: 'none',
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
      root?.render(createElement(ShellTimeZoneProvider, { timeZone: 'Asia/Shanghai', children: createElement(ProviderDetail, {
        labels: labels(),
        provider: {
          providerId: 'bls',
          displayName: 'Bureau of Labor Statistics (BLS)',
          category: 'macro',
          credential: 'none',
          healthMarker: 'none',
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
        showSourceDetails: true
      }) }))
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
    // 「自动同步已停止」是说明句，不进正文：它在「为什么没在采」那格标签旁的 ⓘ 里（用户 2026-11-10）。
    expect(container.textContent).not.toContain('自动同步已停止')
    const stoppedTrigger = container.querySelector<HTMLButtonElement>('[aria-label="自动同步已停止的说明"]')
    expect(stoppedTrigger).not.toBeNull()
    await act(async () => { stoppedTrigger?.click() })
    await act(async () => { await Promise.resolve() })
    // 浮层走 portal，内容在 document.body 里。
    expect(document.body.textContent).toContain('自动同步已停止')
    // 四格里的「上次成功」走统一格式化：07:29Z 在东八区是 10-22 15:29。
    expect(container.textContent).toContain('10-22 15:29 GMT+8')
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
          healthMarker: 'none',
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
            healthMarker: 'none',
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

    // 紧凑时刻仍是同一个格式化入口：02:00Z 在纽约是前一天 22:00（EDT），不是 10-22。
    expect(container.textContent).toContain('10-21 22:00 GMT-4')
    expect(container.textContent).not.toContain('10-22')
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
          healthMarker: 'none',
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

    // 状态串与标签行现在是两行（页头的「1 项能力 · 已启用 1」是另一件事）。
    const rowStatus = container.querySelector('.source-provider-detail__status')?.textContent ?? ''
    const rowHealth = container.querySelector('.source-provider-detail__health')?.textContent ?? ''
    const rowTags = container.querySelector('.source-provider-detail__tags-line')?.textContent ?? ''
    // 药丸只说状态；原因、上次成功在四格里，同一件事只出现一次。
    expect(rowStatus).toContain('不可用')
    expect(rowHealth).toContain('官方源暂时不可用')
    expect(rowTags).toContain(settingsText.jobNotRegistered)
    expect(`${rowStatus}${rowTags}`).not.toContain(settingsText.status.enabled)
    expect(`${rowStatus}${rowTags}`).not.toContain(settingsText.status.disabled)
  })

  it('keeps the frozen-policy reason out of the body and in the preset row ⓘ', async () => {
    // 用户 2026-11-10：声明性文字不要直接显示在界面上。那句原因以前是一个 <p>（整行说明），
    // 现在只住「采集预设」字段名旁的 ⓘ；正文里既没有那句话，也没有指向它的悬空描述符。
    const invoke = vi.fn(async () => undefined)
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ProviderDetail, {
        labels: labels(),
        policy: policyFor(['macro-calendar-bls']),
        provider: {
          providerId: 'bls',
          displayName: 'Bureau of Labor Statistics (BLS)',
          category: 'macro',
          credential: 'none',
          healthMarker: 'none',
          sources: [source({
            providerId: 'bls',
            sourceId: 'macro-calendar-bls',
            displayName: 'BLS official schedule',
            kind: 'official-calendar',
            panels: ['economic-calendar'],
            jobRegistered: false,
            unavailable: {
              reasonCode: 'official-endpoint-returned-403',
              automaticSync: 'stopped',
              lastSuccessfulSyncAt: '2026-10-22T07:29:41.000Z',
              decidedAt: '2026-11-08'
            }
          })]
        }
      }))
      await Promise.resolve()
    })
    await flush()

    // 正文不含那句原因，也不再留指向它的常驻节点（`.policy-stopped` 整行说明已经没有了）。
    expect(container.textContent).not.toContain(settingsText.collectionPolicyStopped)
    expect(container.querySelector('.source-provider-detail__policy-stopped')).toBeNull()
    // 原先包住控件的那层组语义一起撤掉：句子搬进浮层后没有常驻节点可当描述符，
    // 留着 `role="group"` 只剩一个说不清自己的分组。触发器自己的 `aria-describedby`
    // 由平台 `Popover` 挂、指向它自己的浮层内容，不属于这一条。
    expect(container.querySelector('.source-provider-detail__policy [role="group"]')).toBeNull()
    // 它住在「采集预设」字段名旁那颗 ⓘ 里：点开才读到。
    const info = container.querySelector<HTMLButtonElement>(
      `.source-provider-detail__policy [aria-label="${settingsText.collectionPolicy.notConfigurableAria}"]`)
    expect(info).not.toBeNull()
    await act(async () => { info?.click() })
    await act(async () => { await Promise.resolve() })
    expect(document.body.textContent).toContain(settingsText.collectionPolicyStopped)
  })

  it('gives every unavailable source its own reason ⓘ', async () => {
    // 同一屏两个不可用源：每颗 ⓘ 属于它自己那一组，不能只画一颗、也不能两颗挤在同一个块里。
    // （以前这里钉的是「每组的描述符 id 不同」；句子搬进浮层后没有常驻描述符，判据换成每组的 ⓘ。）
    const invoke = vi.fn(async () => undefined)
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const unavailable = {
      reasonCode: 'official-endpoint-returned-403' as const,
      automaticSync: 'stopped' as const,
      lastSuccessfulSyncAt: '2026-10-22T07:29:41.000Z',
      decidedAt: '2026-11-08'
    }
    await act(async () => {
      root?.render(createElement(ProviderDetail, {
        labels: labels(),
        policy: policyFor(['macro-calendar-bls', 'macro-calendar-bls-backup']),
        provider: {
          providerId: 'bls',
          displayName: 'Bureau of Labor Statistics (BLS)',
          category: 'macro',
          credential: 'none',
          healthMarker: 'none',
          sources: [
            source({ providerId: 'bls', sourceId: 'macro-calendar-bls', displayName: 'BLS official schedule', kind: 'official-calendar', panels: ['economic-calendar'], unavailable }),
            source({ providerId: 'bls', sourceId: 'macro-calendar-bls-backup', displayName: 'BLS mirror', kind: 'official-calendar', panels: ['economic-calendar'], unavailable })
          ]
        }
      }))
      await Promise.resolve()
    })
    await flush()

    const policies = [...container.querySelectorAll<HTMLElement>('.source-provider-detail__policy')]
    expect(policies).toHaveLength(2)
    for (const policy of policies) {
      expect(policy.querySelectorAll<HTMLElement>(`[aria-label="${settingsText.collectionPolicy.notConfigurableAria}"]`)).toHaveLength(1)
    }
    expect(container.textContent).not.toContain(settingsText.collectionPolicyStopped)
    const first = policies[0]?.querySelector<HTMLButtonElement>(`[aria-label="${settingsText.collectionPolicy.notConfigurableAria}"]`)
    await act(async () => { first?.click() })
    await act(async () => { await Promise.resolve() })
    expect(document.body.textContent).toContain(settingsText.collectionPolicyStopped)
  })

  it('leaves no group semantics, no dangling description and no frozen note on a usable source', async () => {
    const invoke = vi.fn(async () => undefined)
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ProviderDetail, {
        labels: labels(),
        policy: policyFor(['macro-calendar-fed']),
        provider: fedProvider()
      }))
      await Promise.resolve()
    })
    await flush()

    expect(container.querySelector('.source-provider-detail__policy [role="group"]')).toBeNull()
    expect(container.querySelector('.source-provider-detail__policy [aria-describedby]')).toBeNull()
    expect(container.querySelector('.source-provider-detail__policy-stopped')).toBeNull()
    // 可用的源不该说自己「不能改」：那颗 ⓘ 只属于取不到 / 还没接入的组。
    expect(container.querySelector(`.source-provider-detail__policy [aria-label="${settingsText.collectionPolicy.notConfigurableAria}"]`)).toBeNull()
  })

  it('words the row pill from the projected health state, not from a second read of the runtime status', async () => {
    // C16：五态在服务端算好（`sourceProjection.sourceHealthState`），行内药丸只做「状态 → 词与色」的映射。
    // 用一个「投影说滞后」的源：旧实现在没有健康读数时什么都不画，读者就看不到这一行需要关注。
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
          healthMarker: 'bad',
          sources: [
            source({ providerId: 'bls', sourceId: 'bls-stale', displayName: 'Stale feed', healthState: 'stale' }),
            source({ providerId: 'bls', sourceId: 'bls-failed', displayName: 'Failed feed', healthState: 'failed' })
          ]
        },
        showSourceDetails: true
      }))
      await Promise.resolve()
    })
    await flush()

    const statuses = settingsText.health.statuses
    expect(container.textContent).toContain(statuses['data-stale'])
    expect(container.textContent).toContain(statuses.failed)
    expect(container.querySelector('.status-pill--warn')).not.toBeNull()
    expect(container.querySelector('.status-pill--bad')).not.toBeNull()
  })

  it('offers the enable switch only at the end of the row, never inside the policy group', async () => {
    // 缺陷（用户实测 2026-11-10）：「采集策略」里还有一颗「启用」，动它，上面整行就被关掉。
    // 两颗开关是同一个事实（profile.enabled）的两份副本：组内读页面 profiles、行尾读 source.enabled，
    // 各写各的，所以一动就互相打架。改法是启用只留行尾那一颗，组内不再有第二颗。
    const invoke = vi.fn(async () => undefined)
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ProviderDetail, {
        labels: labels(),
        policy: policyFor(['macro-calendar-fed', 'federal-reserve-rss']),
        provider: fedProvider(),
        showSourceDetails: true
      }))
      await Promise.resolve()
    })
    await flush()

    expect(container.querySelectorAll('.collapsible-group__body [role="switch"]')).toHaveLength(0)
    // 每个源恰一颗，就在它自己那一行末尾，而且它说的是「启用/停用这个源」。
    const rowSwitches = [...container.querySelectorAll<HTMLElement>('.source-provider-detail__row > [role="switch"]')]
    expect(rowSwitches).toHaveLength(2)
    for (const control of rowSwitches) {
      const label = control.getAttribute('aria-label') ?? ''
      expect(label.length).toBeGreaterThan(0)
    }
  })

  it('disables the row switch for a pending source instead of offering a second one inside the policy group', async () => {
    // 旧用例在组内那颗禁用开关上钉「尚未实现不可启用」。那颗没了，这条判据不能跟着消失：
    // 它现在落在行尾那颗上——待接入的源，行尾开关是禁用的，组内没有第二颗。
    const invoke = vi.fn(async () => undefined)
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ProviderDetail, {
        labels: labels(),
        policy: policyFor(['closed-source']),
        provider: {
          providerId: 'closed',
          displayName: 'Closed provider',
          category: 'macro',
          credential: 'none',
          healthMarker: 'none',
          sources: [source({ providerId: 'closed', sourceId: 'closed-source', displayName: 'Closed source', visibility: 'pending', readiness: 'planned' })]
        }
      }))
      await Promise.resolve()
    })
    await flush()

    const rowSwitch = container.querySelector<HTMLButtonElement>('.source-provider-detail__row > [role="switch"]')
    expect(rowSwitch?.disabled).toBe(true)
    expect(container.querySelectorAll('.collapsible-group__body [role="switch"]')).toHaveLength(0)
  })

  it('marks a frozen policy group on its collapsed header, without moving the reason up there', async () => {
    // 界面设计 2026-11-10：不可用源的策略组整组置灰，但收起态的头行看起来完全正常——读者点开才发现
    // 里面全灰，会以为自己刚才点坏了。头行给一枚**短标**（这组现在不能改），整句原因仍只住展开区。
    const invoke = vi.fn(async () => undefined)
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ProviderDetail, {
        labels: labels(),
        policy: policyFor(['macro-calendar-bls']),
        provider: {
          providerId: 'bls',
          displayName: 'Bureau of Labor Statistics (BLS)',
          category: 'macro',
          credential: 'none',
          healthMarker: 'none',
          sources: [source({
            providerId: 'bls',
            sourceId: 'macro-calendar-bls',
            displayName: 'BLS official schedule',
            kind: 'official-calendar',
            panels: ['economic-calendar'],
            jobRegistered: false,
            unavailable: {
              reasonCode: 'official-endpoint-returned-403',
              automaticSync: 'stopped',
              lastSuccessfulSyncAt: '2026-10-22T07:29:41.000Z',
              decidedAt: '2026-11-08'
            }
          })]
        }
      }))
      await Promise.resolve()
    })
    await flush()

    const header = container.querySelector('.source-provider-detail__policy .ant-collapse-header')
    // 折叠头由壳画：这一块里**只有一个标题元素**，内层 `CollectionPolicySection` 不再画标题。
    // 用结构断言而不是数文本：`textContent` 会把控件可访问名之类的文案也算进去，数不干净。
    expect(container.querySelectorAll('.source-provider-detail__policy .collapsible-group__title')).toHaveLength(1)
    expect(container.querySelectorAll('.source-provider-detail__policy .intelligence-section-title')).toHaveLength(0)
    // 这一块里带框的容器只有外层一个（内层不再包一层带 border/radius 的 section）。
    expect(container.querySelectorAll('.source-provider-detail__policy .intelligence-section')).toHaveLength(0)
    // 短标进壳的 meta 槽（头行右侧那格），**默认展开**——不能用「先点开才看得见」当默认。
    expect(header?.textContent).toContain(settingsText.collectionPolicy.stoppedBadge)
    expect(header?.getAttribute('aria-expanded')).toBe('true')
    // 「短标」不是「把整句搬上来」：头行里没有那句长原因，正文里也没有（它只在 ⓘ 里）。
    expect(header?.textContent).not.toContain(settingsText.collectionPolicyStopped)
    expect(container.textContent).not.toContain(settingsText.collectionPolicyStopped)
    // 折叠交互回来了：壳在，头行可聚焦整行都是按钮。
    expect(container.querySelector('.collapsible-group')).not.toBeNull()
    expect(header).not.toBeNull()
    // 默认展开 = 展开区活着：读者一进来就要看采集预设，不该先点一下。
    expect(container.querySelector('.source-provider-detail__policy .ant-collapse-content-active')).not.toBeNull()
  })

  it('collapses the policy block when the reader closes it, and opens it back', async () => {
    // 默认展开不等于不能收：头行点一下收起来，再点一下回来（用户 2026-11-10 要的是这个，不是常显）。
    const invoke = vi.fn(async () => undefined)
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ProviderDetail, {
        labels: labels(),
        policy: policyFor(['macro-calendar-fed']),
        provider: fedProvider()
      }))
      await Promise.resolve()
    })
    await flush()

    const headerFor = (): HTMLElement | null => container.querySelector<HTMLElement>('.source-provider-detail__policy .ant-collapse-header')
    expect(headerFor()?.getAttribute('aria-expanded')).toBe('true')
    await act(async () => { headerFor()?.click() })
    await flush()
    expect(headerFor()?.getAttribute('aria-expanded')).toBe('false')
    await act(async () => { headerFor()?.click() })
    await flush()
    expect(headerFor()?.getAttribute('aria-expanded')).toBe('true')
  })

  it('leaves a usable policy group unmarked', async () => {
    const invoke = vi.fn(async () => undefined)
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ProviderDetail, {
        labels: labels(),
        policy: policyFor(['macro-calendar-fed']),
        provider: fedProvider()
      }))
      await Promise.resolve()
    })
    await flush()

    // 可用源的策略块同样默认展开，但没有「暂不可改」这枚短标。
    expect(container.textContent).not.toContain(settingsText.collectionPolicy.stoppedBadge)
    expect(container.querySelector('.source-provider-detail__policy .ant-collapse-header')?.getAttribute('aria-expanded')).toBe('true')
  })
})
