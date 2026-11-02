// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import IntelligenceSourcesSettingsSection from './index'
import { useIntelligenceSourcesSettings } from './useIntelligenceSourcesSettings'
import { useIntelligenceTranslationSettings } from './useIntelligenceTranslationSettings'

vi.mock('./useIntelligenceSourcesSettings', () => ({ useIntelligenceSourcesSettings: vi.fn() }))
vi.mock('./useIntelligenceTranslationSettings', () => ({ useIntelligenceTranslationSettings: vi.fn() }))

/**
 * 这一页在「还没读到」时不许画成别的样子。
 *
 * 用户报的现象是「先转圈 → 闪一下读取失败 → 才出数据」。这一页原来没有失败面（读失败时
 * 错误码被解构出来却从没渲染），所以它的问题方向相反但同源：**把「读不到」画成「没有来源」**。
 * 两条用例钉住顺序：读取中只有加载态；真的失败才出错误与重试，且重试走的是同一个读取。
 */
let root: Root | undefined
let host: HTMLDivElement | undefined
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const reload = vi.fn()

function sourcesState(overrides: Record<string, unknown>) {
  return {
    settingsView: undefined,
    selectedSourceId: undefined,
    detail: undefined,
    draftProfile: undefined,
    sourceEnabledById: {},
    needsManualRunPrompt: false,
    loading: true,
    saving: false,
    running: false,
    testingCredentials: false,
    replaying: false,
    errorCode: null,
    notice: null,
    reload,
    selectSource: vi.fn(),
    setEnabled: vi.fn(),
    updateProfile: vi.fn(),
    runNow: vi.fn(),
    testCredentials: vi.fn(),
    replayWindow: vi.fn(),
    refreshHealth: vi.fn(),
    saveFocusMarkets: vi.fn(),
    focusMarketSettings: { enabledFocusMarkets: [], updatedAt: '' },
    savingFocusMarkets: false,
    ...overrides
  }
}

beforeEach(() => {
  reload.mockReset()
  vi.mocked(useIntelligenceTranslationSettings).mockReturnValue({
    settings: undefined,
    loading: false,
    moduleStatus: undefined,
    modelProviders: [],
    saving: false,
    savedThisSession: false,
    queuing: false,
    notice: null,
    errorMessage: null,
    updateSettings: vi.fn(),
    queueMissing: vi.fn()
  } as never)
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
  vi.restoreAllMocks()
})

const render = async () => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(IntelligenceSourcesSettingsSection)))
  await act(async () => { await Promise.resolve() })
  return host
}

describe('sources settings page states', () => {
  it('draws only the loading state before the first read settles', async () => {
    vi.mocked(useIntelligenceSourcesSettings).mockReturnValue(sourcesState({ loading: true }) as never)
    const dom = await render()
    expect(dom.querySelector('[aria-busy="true"]')).not.toBeNull()
    // Nothing settled yet: no error surface and no "no sources" surface.
    expect(dom.querySelector('.state-view')).toBeNull()
  })

  it('says the sources could not be read instead of drawing an empty page, and retries the same read', async () => {
    vi.mocked(useIntelligenceSourcesSettings).mockReturnValue(
      sourcesState({ loading: false, errorCode: '加载失败，请重试。' }) as never
    )
    const dom = await render()
    const failure = dom.querySelector('[data-state="error"]')
    expect(failure).not.toBeNull()
    // The failure keeps an action: a dead end is not an error surface.
    await act(async () => (failure?.querySelector('.state-view__action') as HTMLButtonElement | null)?.click())
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('draws the page once the read is done', async () => {
    vi.mocked(useIntelligenceSourcesSettings).mockReturnValue(
      sourcesState({
        loading: false,
        settingsView: {
          groups: [{
            category: 'macro',
            providers: [{
              providerId: 'p1',
              displayName: 'P1',
              sources: [{ sourceId: 's1', displayName: 'S1', panels: ['dashboard'], visibility: 'live', kind: 'api', enabled: true }]
            }]
          }]
        }
      }) as never
    )
    const dom = await render()
    expect(dom.querySelector('.state-view')).toBeNull()
    expect(dom.querySelector('[role="group"]')).not.toBeNull()
  })
})
