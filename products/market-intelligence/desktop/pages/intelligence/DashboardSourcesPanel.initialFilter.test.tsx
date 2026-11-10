// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import type { SettingsView } from '../../../service/intelligence/application/sourceProjection'

/**
 * 抽屉「来源与采集」的初值过滤器：**只作挂载初值**，不传时仍是看板默认。
 *
 * 这一步（C9 第一步）不传任何值，所以读者看到的与今天一致；第二步才会由门户/看板指定。
 */
vi.mock('../../settings/intelligence-sources/useIntelligenceSourcesSettings', () => ({
  useIntelligenceSourcesSettings: () => ({
    settingsView: VIEW,
    definitions: [],
    profiles: [],
    updateSourceProfile: () => undefined,
    toggleSourceEnabled: async () => true,
    runSourceNow: async () => undefined,
    setDraftDirty: () => undefined
  })
}))
vi.mock('../../settings/intelligence-sources/useIntelligenceTranslationSettings', () => ({
  useIntelligenceTranslationSettings: () => ({
    settings: {}, loading: '', moduleStatus: '', modelProviders: [], saving: '', savedThisSession: '', queuing: '',
    notice: '', errorMessage: '', updateSettings: () => undefined, queueMissing: () => undefined
  })
}))

const VIEW: SettingsView = {
  groups: [{
    category: 'macro',
    providers: [
      {
        providerId: 'dashboard-provider', displayName: '看板源', category: 'macro', credential: 'none', healthMarker: 'none',
        sources: [{
          sourceId: 'd1', providerId: 'dashboard-provider', displayName: '看板源', agents: [], panels: ['dashboard'],
          visibility: 'visible', collection: 'adapter', kind: 'feed', capabilities: {}, readiness: 'live',
          enabled: true, healthState: 'healthy', healthMarker: 'none'
        }]
      },
      {
        providerId: 'calendar-provider', displayName: '日历源', category: 'macro', credential: 'none', healthMarker: 'none',
        sources: [{
          sourceId: 'c1', providerId: 'calendar-provider', displayName: '日历源', agents: [], panels: [],
          visibility: 'visible', collection: 'adapter', kind: 'official-calendar', capabilities: {}, readiness: 'live',
          enabled: true, healthState: 'healthy', healthMarker: 'none'
        }]
      }
    ]
  }],
  counts: { total: 2, enabled: 2, pending: 0, failed: 0 }
} as unknown as SettingsView

let root: Root | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function renderPanel(initialFilter?: 'dashboard' | 'calendar'): Promise<HTMLElement> {
  const { DashboardSourcesPanel } = await import('./DashboardSourcesPanel')
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<ShellLanguageProvider language="zh-CN">
      <DashboardSourcesPanel {...(initialFilter === undefined ? {} : { initialFilter })} />
    </ShellLanguageProvider>)
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  return container
}

describe('the drawer sources panel filter', () => {
  it('starts on 「情报源」 when no value is passed, showing every source', async () => {
    // 抽屉没有上下文时落在「全部」（用户 2026-11-10）；带上下文的入口仍预选对应分类。
    const container = await renderPanel()
    const text = container.querySelector('.intelligence-catalog-pane')?.textContent ?? ''
    expect(text).toContain('看板源')
    expect(text).toContain('日历源')
    // `Segmented` 的选中项是 `aria-pressed="true"`（一组互斥取值，不是页签）。
    const selected = container.querySelector('.intelligence-catalog-filters [aria-pressed="true"]')
    expect(selected?.textContent).toContain('情报源')
  })

  it('uses the passed value only as the mount value', async () => {
    const container = await renderPanel('calendar')
    const text = container.querySelector('.intelligence-catalog-pane')?.textContent ?? ''
    expect(text).toContain('日历源')
    expect(text).not.toContain('看板源')
  })
})
