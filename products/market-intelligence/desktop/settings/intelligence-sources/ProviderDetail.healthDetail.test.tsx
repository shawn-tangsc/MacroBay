// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { productText } from '../../shared/i18n/productText'
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

function source(input: Partial<SourceView> & Pick<SourceView, 'sourceId' | 'displayName'>): SourceView {
  const enabled = input.enabled ?? true
  const unavailable = input.unavailable !== undefined
  const healthState = sourceHealthState({ enabled, unavailable })
  return {
    providerId: 'fed',
    agents: ['crypto'],
    panels: ['dashboard'],
    visibility: 'visible',
    collection: 'adapter',
    kind: 'feed',
    capabilities: { runNow: 'adapter', testConnection: true },
    readiness: 'live',
    enabled,
    healthState,
    healthMarker: sourceHealthMarker({ enabled, unavailable, state: healthState }),
    ...input
  }
}

function provider(sources: SourceView[]): ProviderView {
  return {
    providerId: 'fed',
    displayName: 'Federal Reserve Board (Fed)',
    category: 'macro',
    credential: 'none',
    healthMarker: 'none',
    sources
  }
}

function detail(lastSuccessAt?: string) {
  return {
    definition: { sourceId: 's1', displayName: 'S1', authMode: 'none' },
    profile: {
      profileId: 'p1', sourceId: 's1', enabled: true, collectionPreset: 'balanced', includeInSentiment: false,
      scopePolicy: 'all', rawArchiveEnabled: false, retentionMode: 'balanced', autoReplayAfterParserUpgrade: false,
      updatedAt: '2026-11-01T00:00:00.000Z'
    },
    runtimeConfig: {},
    health: {
      sourceId: 's1', runtimeStatus: 'healthy', connectivityStatus: 'connected', consecutiveFailures: 0,
      ...(lastSuccessAt === undefined ? {} : { lastSuccessAt })
    }
  }
}

async function flush(): Promise<void> {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

async function render(element: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(ShellTimeZoneProvider, { timeZone: 'Asia/Shanghai', children: element }))
    await Promise.resolve()
  })
  await flush()
  return container
}

function pageStateRequests(invoke: ReturnType<typeof vi.fn>): string[] {
  return invoke.mock.calls
    .filter(([, method]) => method === 'intelligenceSources.getPageState')
    .map(([, , payload]) => (payload as { sourceId?: string } | undefined)?.sourceId ?? '')
}

describe('ProviderDetail health detail (B4)', () => {
  it('draws the four cells from the projected facts, and answers "can it run now" from the declaration', async () => {
    const invoke = vi.fn(async (_productId: string, method: string) =>
      method === 'intelligenceSources.getPageState' ? { detail: detail('2026-11-09T04:00:00.000Z') } : undefined)
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }

    const container = await render(createElement(ProviderDetail, {
      labels: labels(),
      provider: provider([source({ sourceId: 's1', displayName: 'S1' })]),
      showSourceDetails: true,
      supportsRunNowById: { s1: true }
    }))

    const cells = [...container.querySelectorAll<HTMLElement>('[data-health-cell]')].map((cell) => cell.getAttribute('data-health-cell'))
    expect(cells).toEqual(['today', 'last-success', 'idle-reason', 'run-now'])
    expect(container.textContent).toContain(settingsText.health.todayReadingNo)
    expect(container.textContent).toContain('11-09 12:00 GMT+8')
    expect(container.textContent).toContain(settingsText.health.reasons.collecting)
    expect(container.textContent).toContain(settingsText.health.runNow.yes)
  })

  it('turns a failed detail read into an error with a retry that reads again', async () => {
    let fail = true
    const invoke = vi.fn(async (_productId: string, method: string) => {
      if (method !== 'intelligenceSources.getPageState') return undefined
      if (fail) throw new Error('unreadable')
      return { detail: detail('2026-11-10T04:00:00.000Z') }
    })
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }

    const container = await render(createElement(ProviderDetail, {
      labels: labels(),
      provider: provider([source({ sourceId: 's1', displayName: 'S1' })]),
      showSourceDetails: true
    }))

    // 读失败 = 错误态 + 重试，**不是**「今天还没有读数」。
    expect(container.querySelector('.state-view')).not.toBeNull()
    expect(container.querySelectorAll('[data-health-cell]')).toHaveLength(0)
    expect(container.textContent).not.toContain(settingsText.health.todayReadingNo)

    fail = false
    const retry = [...container.querySelectorAll('button')].find((button) => button.textContent === '重试')
    await act(async () => { retry?.click() })
    await flush()

    expect(container.querySelector('.state-view')).toBeNull()
    expect(container.querySelectorAll('[data-health-cell]')).toHaveLength(4)
    // 不判「今天的读数」：那格跟读者时区的「今天」走，跨零点就会变（本用例只证明重试又读了一次）。
    // 判「最近成功」——它是有名的绝对时刻，与钟点无关。
    expect(container.textContent).toContain('11-10 12:00 GMT+8')
    expect(pageStateRequests(invoke).filter((sourceId) => sourceId === 's1')).toHaveLength(2)
  })

  it('offers run now only where the platform declares it, and hands that source id to the runner', async () => {
    const invoke = vi.fn(async (_productId: string, method: string) =>
      method === 'intelligenceSources.getPageState' ? { detail: detail('2026-11-10T04:00:00.000Z') } : undefined)
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }
    const onRunNow = vi.fn(async () => ({ kind: 'succeeded' as const, notice: '采集成功。' }))

    const container = await render(createElement(ProviderDetail, {
      labels: labels(),
      onRunNow,
      provider: provider([source({ sourceId: 's1', displayName: 'S1' })]),
      showSourceDetails: true,
      supportsRunNowById: { s1: true }
    }))

    const runButton = [...container.querySelectorAll('button')].find((button) => button.textContent === settingsText.health.runAction.run)
    expect(runButton).toBeDefined()
    await act(async () => { runButton?.click() })
    await act(async () => { await Promise.resolve() })
    expect(onRunNow).toHaveBeenCalledWith('s1')
    expect(container.querySelector('[role="status"]')?.textContent).toContain('采集成功。')
  })

  it('does not paint a run button for a source the platform does not declare runnable', async () => {
    const invoke = vi.fn(async (_productId: string, method: string) =>
      method === 'intelligenceSources.getPageState' ? { detail: detail('2026-11-10T04:00:00.000Z') } : undefined)
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }
    const onRunNow = vi.fn(async () => ({ kind: 'succeeded' as const, notice: '' }))

    const container = await render(createElement(ProviderDetail, {
      labels: labels(),
      onRunNow,
      provider: provider([source({ sourceId: 's1', displayName: 'S1' })]),
      showSourceDetails: true
    }))

    expect([...container.querySelectorAll('button')].some((button) => button.textContent === settingsText.health.runAction.run)).toBe(false)
    expect(container.textContent).toContain(settingsText.health.runNow.unsupported)
  })

  it('refreshes the four cells after a run, without asking the reader to press retry', async () => {
    // 跑完健康读数会变：四格读的是页面自己的详情映射，不重读就停在旧时刻。
    let reads = 0
    const invoke = vi.fn(async (_productId: string, method: string) => {
      if (method !== 'intelligenceSources.getPageState') return undefined
      reads += 1
      return { detail: detail(reads === 1 ? '2026-11-09T04:00:00.000Z' : '2026-11-10T04:30:00.000Z') }
    })
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }

    const container = await render(createElement(ProviderDetail, {
      labels: labels(),
      onRunNow: async () => ({ kind: 'succeeded' as const, notice: '采集成功。' }),
      provider: provider([source({ sourceId: 's1', displayName: 'S1' })]),
      showSourceDetails: true,
      supportsRunNowById: { s1: true }
    }))

    expect(container.textContent).toContain('11-09 12:00 GMT+8')
    const runButton = [...container.querySelectorAll('button')].find((button) => button.textContent === settingsText.health.runAction.run)
    await act(async () => { runButton?.click() })
    await flush()

    expect(container.textContent).toContain('11-10 12:30 GMT+8')
    expect(container.textContent).not.toContain('11-09 12:00 GMT+8')
    expect(reads).toBe(2)
  })

  it('does not paint a calendar feed as "never collected": the record is unknown, with the reason only in the ⓘ', async () => {
    const invoke = vi.fn(async () => undefined)
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }

    const container = await render(createElement(ProviderDetail, {
      labels: labels(),
      provider: provider([source({
        sourceId: 'macro-calendar-fed',
        displayName: 'Fed official schedule',
        kind: 'official-calendar',
        panels: ['economic-calendar'],
        jobRegistered: true
      })]),
      showSourceDetails: true
    }))

    expect(container.querySelectorAll('[data-health-cell]')).toHaveLength(4)
    expect(container.textContent).toContain(settingsText.health.unknown)
    // 原因句不进正文（用户 2026-11-10）：它在那一格标签旁的 ⓘ 里，点开才读到。
    expect(container.textContent).not.toContain(settingsText.health.unknownReason)
    expect(document.body.textContent).not.toContain(settingsText.health.unknownReason)
    expect(container.textContent).not.toContain(settingsText.health.reasons['never-ran'])
    expect(container.querySelector('.state-view')).toBeNull()
    expect(pageStateRequests(invoke)).not.toContain('macro-calendar-fed')
    const info = container.querySelector<HTMLButtonElement>(
      `[data-health-cell="today"] button[aria-label="${settingsText.health.unknownReasonAria}"]`)
    expect(info).not.toBeNull()
    await act(async () => { info?.click() })
    await act(async () => { await Promise.resolve() })
    // 浮层走 portal，内容在 document.body 里。
    expect(document.body.textContent).toContain(settingsText.health.unknownReason)
  })

  it('keeps the old readings and says so when the background refresh fails', async () => {
    // 跑完刷新失败：四格保留旧值 + 一行状态；不许把旧读数当成刚采到的，也不许写成「没有数据」。
    let reads = 0
    const invoke = vi.fn(async (_productId: string, method: string) => {
      if (method !== 'intelligenceSources.getPageState') return undefined
      reads += 1
      if (reads === 1) return { detail: detail('2026-11-09T04:00:00.000Z') }
      throw new Error('refresh-failed')
    })
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }

    const container = await render(createElement(ProviderDetail, {
      labels: labels(),
      onRunNow: async () => ({ kind: 'succeeded' as const, notice: '采集成功。' }),
      provider: provider([source({ sourceId: 's1', displayName: 'S1' })]),
      showSourceDetails: true,
      supportsRunNowById: { s1: true }
    }))

    const runButton = [...container.querySelectorAll('button')].find((button) => button.textContent === settingsText.health.runAction.run)
    await act(async () => { runButton?.click() })
    await flush()

    // 旧值还在，状态句出现；不是「今天还没有」那种「没有数据」。
    expect(container.textContent).toContain('11-09 12:00 GMT+8')
    expect(container.textContent).toContain(settingsText.health.refreshStale)
    // 它与「原因说明」是**两行**：那句话说的是四格新鲜度，不是「为什么没在采」。
    const staleLine = [...container.querySelectorAll('[role="status"]')]
      .find((node) => node.textContent === settingsText.health.refreshStale)
    expect(staleLine).not.toBeUndefined()
    expect(staleLine?.textContent).toBe(settingsText.health.refreshStale)
    // 状态句与「没有数据」不是一句：不是 never-ran / noSuccess 那两档。
    expect(container.textContent).not.toContain(settingsText.health.reasons['never-ran'])
  })

  it('clears that status as soon as a later refresh succeeds', async () => {
    // 对偶面：先失败立起状态，再成功一次——新值替换旧值、状态话消失。
    let reads = 0
    const invoke = vi.fn(async (_productId: string, method: string) => {
      if (method !== 'intelligenceSources.getPageState') return undefined
      reads += 1
      if (reads === 2) throw new Error('refresh-failed')
      return { detail: detail(reads === 1 ? '2026-11-09T04:00:00.000Z' : '2026-11-10T04:30:00.000Z') }
    })
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }

    const container = await render(createElement(ProviderDetail, {
      labels: labels(),
      onRunNow: async () => ({ kind: 'succeeded' as const, notice: '采集成功。' }),
      provider: provider([source({ sourceId: 's1', displayName: 'S1' })]),
      showSourceDetails: true,
      supportsRunNowById: { s1: true }
    }))

    const runOnce = async (): Promise<void> => {
      const button = [...container.querySelectorAll('button')].find((node) => node.textContent === settingsText.health.runAction.run)
      await act(async () => { button?.click() })
      await flush()
    }
    await runOnce()
    expect(container.textContent).toContain('11-09 12:00 GMT+8')
    expect(container.textContent).toContain(settingsText.health.refreshStale)

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    await runOnce()
    expect(container.textContent).toContain('11-10 12:30 GMT+8')
    expect(container.textContent).not.toContain(settingsText.health.refreshStale)
  })

  it('drops the stale note when a new run starts, so it never speaks over 「正在运行」', async () => {
    let reads = 0
    let releaseRun: () => void = () => {}
    const invoke = vi.fn(async (_productId: string, method: string) => {
      if (method !== 'intelligenceSources.getPageState') return undefined
      reads += 1
      if (reads === 2) throw new Error('refresh-failed')
      return { detail: detail(reads === 1 ? '2026-11-09T04:00:00.000Z' : '2026-11-10T04:30:00.000Z') }
    })
    ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }

    let call = 0
    const container = await render(createElement(ProviderDetail, {
      labels: labels(),
      onRunNow: async () => {
        call += 1
        if (call === 1) return { kind: 'succeeded' as const, notice: '采集成功。' }
        await new Promise<void>((resolve) => { releaseRun = resolve })
        return { kind: 'succeeded' as const, notice: '采集成功。' }
      },
      provider: provider([source({ sourceId: 's1', displayName: 'S1' })]),
      showSourceDetails: true,
      supportsRunNowById: { s1: true }
    }))

    const runButton = (): HTMLButtonElement | undefined => [...container.querySelectorAll('button')]
      .find((button) => button.textContent === settingsText.health.runAction.run)
    await act(async () => { runButton()?.click() })
    await flush()
    expect(container.textContent).toContain(settingsText.health.refreshStale)

    // 第二轮开始：这句先撤掉，运行中的状态词占着 role=status。
    await act(async () => { runButton()?.click() })
    await act(async () => { await Promise.resolve() })
    expect(container.textContent).not.toContain(settingsText.health.refreshStale)
    expect(container.textContent).toContain(settingsText.health.runAction.running)

    releaseRun()
    await flush()
  })
})
