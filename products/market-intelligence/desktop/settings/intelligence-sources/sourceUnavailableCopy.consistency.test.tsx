// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellTimeZoneProvider } from '@platform/ui/shell/ShellTimeZoneContext'
import { productText } from '../../shared/i18n/productText'
import { sourceUnavailableSentence } from '../../shared/i18n/sourceUnavailableCopy'
import { ProviderDetail, type ProviderDetailLabels } from './ProviderDetail'
import type { ProviderView, SourceView } from '../../../service/intelligence/application/sourceProjection'

/**
 * 「原因码 → 人话」全仓一张表（`shared/i18n/sourceUnavailableCopy.ts`）。
 *
 * 判据：同一个码，**抽屉与详情给出同一句话**。抽屉那边同样调用这个函数；这里渲染详情，
 * 把它的句子与「用同一份表 + 同一个兜底句」算出来的句子逐字对比——
 * 详情若自己留一张表、或换了兜底句，未知码这一档当场红。
 *
 * **接手记录**：`sourceUnavailableCopy.crossSurface.test.tsx`（`94ce806` 新增，拿抽屉那条
 * 独立的数据链去比详情）随「抽屉与设置页改成同一块组件」在 `e6d406b` 删除——它的前提
 * （抽屉自己拼行状态）已经不存在。同一判据由本文件的
 * `the same code says different things to different kinds`（官方日历 vs 市场日历两句不同、
 * 且详情各说各的那句）接管。按哈希翻 `crossSurface` 那一刻的人，请从这里往下看。
 */
const settingsText = productText['zh-CN'].settings.intelligenceSources
const drawerCopy = productText['zh-CN'].pages.intelligence.portal.dashboard.configDrawer

let root: Root | null = null

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

function labels(): ProviderDetailLabels {
  return {
    sourceNames: {}, providerNames: {}, panelNames: settingsText.panelNames, badges: settingsText.sourceBadges,
    status: settingsText.status, toggleSource: settingsText.toggleSource,
    credentials: settingsText.credentialsRequired, website: settingsText.website, signup: settingsText.signup,
    testConnection: settingsText.testConnection, jobRegistered: settingsText.jobRegistered,
    jobNotRegistered: settingsText.jobNotRegistered, connectionSucceeded: settingsText.connectionSucceeded,
    connectionFailed: settingsText.connectionFailed, connectionUnsupported: settingsText.connectionUnsupported,
    apiKey: settingsText.apiKey, unavailableReasonCode: settingsText.unavailableReasonCode,
    unavailableReasonCodeAria: settingsText.unavailableReasonCodeAria,
    automaticSyncStopped: settingsText.automaticSyncStopped, lastSuccessfulSync: settingsText.lastSuccessfulSync,
    health: settingsText.health
  }
}

function source(reasonCode: string, kind: 'official-calendar' | 'market-calendar' = 'official-calendar'): SourceView {
  return {
    sourceId: 'macro-calendar-bls', providerId: 'bls', displayName: 'BLS official schedule',
    agents: ['crypto'], panels: ['economic-calendar'], visibility: 'visible', collection: 'provider',
    kind, capabilities: { runNow: 'provider', testConnection: true }, readiness: 'live',
    enabled: true, healthState: 'off', healthMarker: 'ring',
    unavailable: {
      reasonCode: reasonCode as never,
      automaticSync: 'stopped',
      lastSuccessfulSyncAt: '2026-10-22T07:29:41.000Z',
      decidedAt: '2026-11-08'
    }
  }
}

async function detailText(reasonCode: string, kind: 'official-calendar' | 'market-calendar' = 'official-calendar'): Promise<string> {
  const invoke = vi.fn(async () => undefined)
  ;(window as unknown as { platform: unknown }).platform = { products: { invoke } }
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(ShellTimeZoneProvider, { timeZone: 'Asia/Shanghai', children: createElement(ProviderDetail, {
      labels: labels(),
      provider: {
        providerId: 'bls', displayName: 'Bureau of Labor Statistics (BLS)', category: 'macro',
        credential: 'none', healthMarker: 'ring', sources: [source(reasonCode, kind)]
      } as ProviderView,
      showSourceDetails: true
    }) }))
    await Promise.resolve()
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return container.querySelector('[data-health-cell="idle-reason"]')?.textContent ?? ''
}

describe('one reason-code table for both surfaces', () => {
  it('gives the same sentence for a known code in the drawer and in the detail', async () => {
    const sentence = sourceUnavailableSentence('official-endpoint-returned-403', drawerCopy.sourceUnavailable, 'official-calendar')
    const cell = await detailText('official-endpoint-returned-403')
    expect(cell).toContain(sentence)
    // 码本身不进正文（只在 ⓘ 里）。
    expect(cell).not.toContain('official-endpoint-returned-403')
  })

  it('falls back to the same sentence for an unknown code, in both places', async () => {
    const sentence = sourceUnavailableSentence('endpoint-vanished-somewhere', drawerCopy.sourceUnavailable, 'official-calendar')
    expect(sentence).toBe(drawerCopy.sourceUnavailable)
    const cell = await detailText('endpoint-vanished-somewhere')
    expect(cell).toContain(sentence)
    expect(cell).not.toContain('endpoint-vanished-somewhere')
  })
})

describe('the same code says different things to different kinds', () => {
  it('never calls an aggregate a 官方源: official and market calendars get different sentences', async () => {
    const code = 'official-endpoint-returned-403'
    const official = sourceUnavailableSentence(code, drawerCopy.sourceUnavailable, 'official-calendar')
    const market = sourceUnavailableSentence(code, drawerCopy.sourceUnavailable, 'market-calendar')
    expect(official).toContain('官方源')
    expect(market).not.toContain('官方源')
    expect(market).toContain('市场日历源')

    const officialCell = await detailText(code, 'official-calendar')
    const marketCell = await detailText(code, 'market-calendar')
    expect(officialCell).toContain(official)
    expect(marketCell).toContain(market)
    expect(officialCell).not.toBe(marketCell)
  })
})
