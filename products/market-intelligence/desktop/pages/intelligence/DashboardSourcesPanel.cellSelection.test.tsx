// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'

import { INTELLIGENCE_IPC_METHODS } from '../../../contracts/intelligenceIpcMethods'
import type { SettingsView } from '../../../service/intelligence/application/sourceProjection'
import { DashboardSourcesPanel } from './DashboardSourcesPanel'

/**
 * 「打开一格 = 选中该源」这条**宿主注入**：契约（`cellEnabled.ts`）、客户端
 * （`cellEnabledClient.writeSelection`）、存储（`cellEnabledStore`）都在，
 * 缺的只是宿主有没有把它接进来。没接 → 永远是默认主源，「换成备用源」存不下来。
 *
 * 这里从**抽屉宿主**进入（`DashboardSourcesPanel`）真点一下开关，断言两条 IPC 都发出去了：
 * `setCellEnabled`（写格）与 `setCellSelection`（写选源）。设置页那一处由同一条注入模式覆盖
 * （同一个客户端方法、同一个 pane 组件），另有一条文本守卫钉住它也在。
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
    providers: [{
      providerId: 'p', displayName: '看板源', category: 'macro', credential: 'none', healthMarker: 'none',
      sources: [{
        sourceId: 'binance-futures-positioning', providerId: 'p', displayName: '看板源', agents: [], panels: ['dashboard'],
        visibility: 'visible', collection: 'adapter', kind: 'feed', capabilities: {}, readiness: 'live',
        enabled: true, healthState: 'healthy', healthMarker: 'none'
      }]
    }]
  }],
  counts: { total: 1, enabled: 1, pending: 0, failed: 0 }
} as unknown as SettingsView

let root: Root | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

describe('抽屉宿主的格级开关能写选源', () => {
  it('sends both setCellEnabled and setCellSelection when a cell is switched on', async () => {
    const calls: Array<{ method: string; payload?: unknown }> = []
    ;(window as unknown as { platform: unknown }).platform = {
      products: {
        invoke: vi.fn(async (_product: string, method: string, payload?: unknown) => {
          calls.push({ method, payload })
          if (method === INTELLIGENCE_IPC_METHODS.readCellEnabled) return { 'quotes:btc': false }
          if (method === INTELLIGENCE_IPC_METHODS.readCellSelection) return {}
          return undefined
        })
      }
    }
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root!.render(<ShellLanguageProvider language="zh-CN"><DashboardSourcesPanel pane="business" /></ShellLanguageProvider>)
    })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    const control = host.querySelector<HTMLElement>('[data-cell-id="quotes:btc"] [role="switch"]')
    expect(control).not.toBeNull()
    await act(async () => { control!.click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

    const enabledCall = calls.find((call) => call.method === INTELLIGENCE_IPC_METHODS.setCellEnabled)
    expect(enabledCall?.payload).toEqual({ cellId: 'quotes:btc', enabled: true })
    // 缺注入时这条永远为空（「打开一格 = 选中该源」不成立）。
    const selectionCall = calls.find((call) => call.method === INTELLIGENCE_IPC_METHODS.setCellSelection)
    expect(selectionCall?.payload).toEqual({ cellId: 'quotes:btc', sourceId: 'binance-futures-positioning' })
  })
})