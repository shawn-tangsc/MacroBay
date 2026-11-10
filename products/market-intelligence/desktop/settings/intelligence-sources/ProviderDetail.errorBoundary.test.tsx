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
    collectionPolicyStopped: settingsText.collectionPolicyStopped,
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

describe('ProviderDetail error boundary', () => {
it('turns a crash inside the detail into an error state with a retry, instead of a blank pane', async () => {
  // 复现 2026-11-10 的白屏：读者实例里跑的是旧文案，`labels.health` 是空的，
  // 四格第一次读文案就抛。边界只包详情区：这里断言它画错误态而不是整块白。
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const invoke = vi.fn(async (_productId: string, method: string) =>
    method === 'intelligenceSources.getPageState' ? { detail: detail('2026-11-10T04:00:00.000Z') } : undefined)
  ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }

  const container = await render(createElement(ProviderDetail, {
    labels: { ...labels(), health: undefined as never },
    provider: provider([source({ sourceId: 's1', displayName: 'S1' })]),
    showSourceDetails: true
  }))

  expect(container.querySelector('.state-view')).not.toBeNull()
  const retry = [...container.querySelectorAll('button')].find((button) => button.textContent === '重试')
  expect(retry).toBeDefined()
  // 重试只重置这一块，不把异常藏起来：再渲染仍抛，就仍显示错误态。
  await act(async () => { retry?.click() })
  await flush()
  expect(container.querySelector('.state-view')).not.toBeNull()
  errors.mockRestore()
})
})
