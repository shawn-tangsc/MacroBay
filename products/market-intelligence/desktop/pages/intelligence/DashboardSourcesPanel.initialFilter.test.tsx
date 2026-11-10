// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../shared/i18n/productText'
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

describe('业务设置：只有卡片，没有源详情头', () => {
  const text = productText['zh-CN'].settings.intelligenceSources

  it('shows module cards and no source-level detail at all', async () => {
    const container = await renderPanel('dashboard')
    expect(container.querySelector('.business-settings__content')).not.toBeNull()
    // 卡片在：跨资产、行情卡、AI 分析用（末卡带 ⓘ）。
    // 跨资产并进「市场状态」（原来两张卡的纳指/美元/黄金各列一遍）：不再有单独的跨资产卡。
    expect(container.querySelector('[data-business-card="cross-asset"]')).toBeNull()
    expect(container.querySelector('[data-business-card="quotes"]')).not.toBeNull()
    expect(container.querySelector('[data-business-card="ai-analysis"]')).not.toBeNull()
    // **不出现任何源级详情**：没有源名 <h2>、没有那几颗按钮与那两行标签。
    const body = container.textContent ?? ''
    expect(container.querySelector('h2')).toBeNull()
    expect(body).not.toContain(text.testConnection)
    expect(body).not.toContain(text.signup)
    expect(body).not.toContain(text.apiKey.label)
    expect(container.querySelector('.source-provider-detail__row')).toBeNull()
    // 也没有状态词与「高级」。
    expect(body).not.toContain(text.advancedToggle)
    expect(body).not.toContain(text.status.disabled)
  })

})

describe('筛选页签在业务设置下常显', () => {
  it('keeps all five filter tabs above the three business rows', async () => {
    // 用户 2026-11-11：左列换成三项之后，那条页签不许不见——页签在上、三项在下，各自占位。
    const container = await renderPanel('dashboard')
    const tabs = [...container.querySelectorAll('.intelligence-catalog-filters [role="group"] button')]
    expect(tabs).toHaveLength(5)
    expect(tabs.map((tab) => tab.textContent)).toEqual(['情报源', '业务设置', '日历', '舆情', '其他'])
    // 三项列表在看板卡上方、与页签是两层。
    expect(container.querySelectorAll('.business-settings__nav .intelligence-provider-row')).toHaveLength(3)
  })
})

describe('业务设置 › 看板：每行都有格级开关', () => {
  it('renders one switch per card row (not zero)', async () => {
    const container = await renderPanel('dashboard')
    const rows = container.querySelectorAll('[data-cell-id]')
    const switches = container.querySelectorAll('[data-cell-id] [role="switch"]')
    expect(rows.length).toBeGreaterThan(0)
    expect(switches.length).toBe(rows.length)
  })
})
