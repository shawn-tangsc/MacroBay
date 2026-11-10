// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { productText } from '../../shared/i18n/productText'
import { ProviderDetail, type ProviderDetailLabels } from './ProviderDetail'
import { useDrawerSourcesView } from '../config-drawer/useDrawerSourcesView'
import type { ProviderView, SourceView } from '../../../service/intelligence/application/sourceProjection'

/**
 * 同一个码 + 同一个 kind，**抽屉的数据路径与设置页详情说同一句话**。
 *
 * 两边都走 `sourceUnavailableSentence`：这里一侧用抽屉真实的 `useDrawerSourcesView`（它读
 * `getSettingsView` 并自己拼行状态），另一侧渲染 `ProviderDetail` 的原因格，逐字对比。
 * 任何一侧自己留一张表、或忘了传 kind，这条会红。
 */
const settingsText = productText['zh-CN'].settings.intelligenceSources
const drawerCopy = productText['zh-CN'].pages.intelligence.portal.dashboard.configDrawer

let roots: Root[] = []

afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount())
  roots = []
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

const SOURCE_ID = 'macro-calendar-bls'

function source(kind: 'official-calendar' | 'market-calendar'): SourceView {
  return {
    sourceId: SOURCE_ID, providerId: 'bls', displayName: 'BLS official schedule',
    agents: ['crypto'], panels: ['economic-calendar'], visibility: 'visible', collection: 'provider',
    kind, capabilities: { runNow: 'provider', testConnection: true }, readiness: 'live',
    enabled: true, healthState: 'off', healthMarker: 'ring',
    unavailable: {
      reasonCode: 'official-endpoint-returned-403',
      automaticSync: 'stopped',
      lastSuccessfulSyncAt: '2026-10-22T07:29:41.000Z',
      decidedAt: '2026-11-08'
    }
  }
}

function provider(kind: 'official-calendar' | 'market-calendar'): ProviderView {
  return {
    providerId: 'bls', displayName: 'Bureau of Labor Statistics (BLS)', category: 'macro',
    credential: 'none', healthMarker: 'ring', sources: [source(kind)]
  }
}

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
    collectionPolicyStopped: settingsText.collectionPolicyStopped,
    automaticSyncStopped: settingsText.automaticSyncStopped, lastSuccessfulSync: settingsText.lastSuccessfulSync,
    health: settingsText.health
  }
}

async function drawerStatusLabel(kind: 'official-calendar' | 'market-calendar'): Promise<string> {
  const invoke = vi.fn(async (_productId: string, method: string) => {
    if (method === 'intelligenceSources.getSettingsView') {
      return {
        groups: [{
          category: 'macro',
          providers: [{ ...provider(kind), sources: [source(kind)] }]
        }],
        counts: { total: 1, enabled: 1, pending: 0, failed: 0 }
      }
    }
    return undefined
  })
  ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }

  let label = ''
  function Probe(): null {
    const view = useDrawerSourcesView(true, drawerCopy.sourceUnavailable)
    if (view?.state === 'ready') label = view.rows[0]?.statusLabel ?? ''
    return null
  }
  const root = createRoot(document.createElement('div'))
  roots.push(root)
  await act(async () => { root.render(createElement(Probe)); await Promise.resolve() })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return label
}

async function detailReason(kind: 'official-calendar' | 'market-calendar'): Promise<string> {
  const invoke = vi.fn(async (_productId: string, method: string) => {
    if (method === 'intelligenceSources.getPageState') return { detail: { health: {} } }
    return undefined
  })
  ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }

  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(createElement(ShellTimeZoneProvider, { timeZone: 'Asia/Shanghai', children: createElement(ProviderDetail, {
      labels: labels(), provider: provider(kind), showSourceDetails: true
    }) }))
    await Promise.resolve()
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return container.querySelector('[data-health-cell="idle-reason"]')?.textContent ?? ''
}

describe('the drawer and the detail say the same thing for the same code and kind', () => {
  it('official calendar: both surfaces name the official source', async () => {
    const drawer = await drawerStatusLabel('official-calendar')
    const detail = await detailReason('official-calendar')
    expect(drawer).toBe('官方源暂时不可用（403）')
    expect(detail).toContain(drawer)
  })

  it('market calendar: both surfaces stop calling it an official source', async () => {
    const drawer = await drawerStatusLabel('market-calendar')
    const detail = await detailReason('market-calendar')
    expect(drawer).toBe('市场日历源暂时不可用（403）')
    expect(detail).toContain(drawer)
    expect(detail).not.toContain('官方源暂时')
  })
})
