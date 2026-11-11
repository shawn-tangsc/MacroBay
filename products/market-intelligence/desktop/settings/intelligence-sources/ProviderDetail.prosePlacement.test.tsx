// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { ProviderDetail, type ProviderDetailLabels } from './ProviderDetail'
import type { ProviderView, SourceView } from '../../../service/intelligence/application/sourceProjection'

/**
 * 「搬家搬干净了」的证明（`be92217`）。
 *
 * `manualPresetNote` 已从正文搬进采集预设行的 ⓘ：**正文不含那句话**，展开 ⓘ 之后才有。
 * （`inviteNote` 那条旧证明随推广句一起删除——用户 2026-11-12「这个不显示」，句子本身不再存在。）
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
    sourceNames: {},
    providerNames: {},
    panelNames: settingsText.panelNames,
    badges: settingsText.sourceBadges,
    status: settingsText.status,
    toggleSource: settingsText.toggleSource,
    credentials: settingsText.credentialsRequired,
    website: settingsText.website,
    signup: settingsText.signup,
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

function source(overrides: Partial<SourceView> = {}): SourceView {
  return {
    sourceId: 'coindesk-rss',
    providerId: 'coindesk',
    displayName: 'CoinDesk',
    agents: ['crypto'],
    panels: [],
    visibility: 'visible',
    collection: 'adapter',
    kind: 'feed',
    capabilities: { runNow: 'adapter', testConnection: false },
    readiness: 'live',
    enabled: true,
    healthState: 'healthy',
    healthMarker: 'none',
    ...overrides
  }
}

function provider(overrides: Partial<ProviderView> = {}): ProviderView {
  return {
    providerId: 'coindesk',
    displayName: 'CoinDesk',
    category: 'crypto',
    credential: 'none',
    invite: true,
    healthMarker: 'none' as const,
    // 邀请那句要同时有 `invite` 与 `signupUrl` 才渲染（`inviteProvider && provider.signupUrl`）。
    signupUrl: 'https://example.test/signup',
    sources: [source()],
    ...overrides
  }
}

function policy(collectionPreset: 'manual' | 'balanced' = 'manual') {
  return {
    labels: settingsText.collectionPolicy,
    profiles: {
      'coindesk-rss': {
        profileId: 'p1',
        sourceId: 'coindesk-rss',
        enabled: true,
        collectionPreset,
        scopePolicy: 'all' as const,
        rawArchiveEnabled: false,
        retentionMode: 'balanced' as const,
        autoReplayAfterParserUpgrade: false,
        updatedAt: '2026-11-01T00:00:00.000Z'
      }
    },
    supportsSentimentById: {},
    onChange: () => undefined
  }
}

async function render(
  element: React.ReactElement
): Promise<HTMLElement> {
  const invoke = vi.fn(async () => undefined)
  ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => { root?.render(element); await Promise.resolve() })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return host
}

describe('the moved sentences live in exactly one place', () => {
  it('no longer renders the preset sentence in the source detail at all', async () => {
    // 采集预设整行已挪到「采集与数据」每源第二行（用户 2026-11-12），那句手动档说明也跟着过去；
    // 详情里既不出现正文，也没有那颗 ⓘ。接管判据见 `BusinessSettingsView.preset.test.tsx`。
    const host = await render(createElement(ProviderDetail, {
      labels: labels(),
      provider: provider(),
      policy: policy('manual')
    }))

    expect(host.textContent).not.toContain(settingsText.collectionPolicy.manualPresetNote)
    expect([...host.querySelectorAll<HTMLElement>(`[aria-label="${settingsText.collectionPolicy.manualPresetNoteAria}"]`)]).toHaveLength(0)
  })
})
