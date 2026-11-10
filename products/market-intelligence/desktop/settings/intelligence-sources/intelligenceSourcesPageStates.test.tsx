// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { productText } from '../../shared/i18n/productText'
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

const reload = vi.fn()

function sourcesState(overrides: Record<string, unknown>) {
  return {
    settingsView: undefined,
    selectedSourceId: undefined,
    detail: undefined,
    draftProfile: undefined,
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
    savingFocusMarkets: false,
    profiles: [],
    definitions: [],
    updateSourceProfile: vi.fn(),
    ...overrides
  }
}

const zhText = productText['zh-CN'].settings.intelligenceSources

/** 一个能画出来的最小来源页：一个 provider、一个源。 */
function settingsViewOneProvider(): never {
  return {
    groups: [{
      category: 'macro',
      providers: [{
        providerId: 'p1',
        displayName: 'P1',
        category: 'macro',
        credential: 'none',
        sources: [{
          providerId: 'p1',
          sourceId: 's1',
          displayName: 'S1',
          agents: ['crypto'],
          panels: ['dashboard'],
          visibility: 'visible',
          collection: 'provider',
          kind: 'feed',
          capabilities: { runNow: 'none', testConnection: false },
          readiness: 'live',
          enabled: true
        }]
      }]
    }]
  } as never
}

function button(dom: HTMLElement, label: string): HTMLButtonElement {
  const found = [...dom.querySelectorAll<HTMLButtonElement>('button')].find((each) => each.textContent === label)
  if (!found) throw new Error(`button not found: ${label}`)
  return found
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
  Reflect.deleteProperty(window, 'platform')
  vi.restoreAllMocks()
})

const render = async () => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(IntelligenceSourcesSettingsSection)))
  await act(async () => { await Promise.resolve() })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
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

  it('lets the reader change collection frequency, scope and sentiment for a source', async () => {
    // 缺陷（0.4.2）：`CollectionPolicySection` 早就写好了（三个控件 + 用例），但全仓没有一处渲染它，
    // 所以这三项读者一个都改不了。这里钉住：三行出现在页面上，且改动走该源的 profile 保存。
    const updateSourceProfile = vi.fn()
    vi.mocked(useIntelligenceSourcesSettings).mockReturnValue(
      sourcesState({
        definitions: [{ sourceId: 's1', supportsSentiment: true }],
        loading: false,
        profiles: [{
          autoReplayAfterParserUpgrade: false,
          collectionPreset: 'balanced',
          enabled: true,
          includeInSentiment: true,
          profileId: 'profile-s1',
          rawArchiveEnabled: false,
          retentionMode: 'balanced',
          scopePolicy: 'watchlist-priority',
          sourceId: 's1',
          updatedAt: '2026-11-09T00:00:00.000Z'
        }],
        settingsView: settingsViewOneProvider(),
        updateSourceProfile
      }) as never
    )
    const dom = await render()

    // 默认收起：头行只有「采集策略」，四行控件不显示；展开后才出现（界面设计 2026-11-09）。
    // 注意：平台壳为了 `aria-controls` 永远指向**存在**的节点，内容从首帧就挂载、收起时是
    // `display: none`——所以这里判「不显示」，不判「不在 DOM 里」（判 DOM 存在与否会被真正的显隐问题骗过）。
    expect(dom.textContent).toContain(zhText.collectionPolicy.title)
    const collapsedGrid = dom.querySelector<HTMLElement>('.intelligence-setting-grid')
    expect(collapsedGrid?.closest<HTMLElement>('.ant-collapse-content')?.style.display).toBe('none')
    // 壳 `CollapsibleGroup` 到了自定义内容形态：头行由壳负责（档位、箭头、`aria-controls`）。
    const header = [...dom.querySelectorAll<HTMLElement>('.collapsible-group .ant-collapse-header')]
      .find((element) => element.textContent?.includes(zhText.collectionPolicy.title))!
    await act(async () => { header.click() })
    await act(async () => { await Promise.resolve() })

    const section = dom.querySelector('.intelligence-section:has(.intelligence-setting-grid)')
    expect(dom.textContent).toContain(zhText.collectionPolicy.collectionPreset)
    expect(dom.textContent).toContain(zhText.collectionPolicy.includeInSentiment)
    expect(section).not.toBeNull()
    // 范围策略已从界面撤掉：读者改它什么也不会发生（架构师核对：只写不读）。控件不能以禁用态
    // 留着——禁用等于承诺「以后能开」。这里判两个方向：标签不在屏上，且只剩一个下拉（预设）。
    expect(section!.textContent).not.toContain('范围策略')
    expect(section!.querySelectorAll('.ant-select')).toHaveLength(1)

    const sentimentRow = [...section!.querySelectorAll<HTMLElement>('.intelligence-setting-row')]
      .find((row) => row.textContent?.includes(zhText.collectionPolicy.includeInSentiment))!
    const toggle = sentimentRow.querySelector<HTMLElement>('[role="switch"]')!
    await act(async () => { toggle.click() })

    expect(updateSourceProfile).toHaveBeenCalledWith('s1', { includeInSentiment: false })
  })

  it('marks which provider row is selected for assistive tech', async () => {
    // 例外登记（ui-spec R1）：provider 行是「两行内容 + 选中态的行容器」，保留原生按钮；
    // 那它就必须自己把语义补齐——选中态用 `aria-current`，名字取行内文本、键盘用原生可达。
    vi.mocked(useIntelligenceSourcesSettings).mockReturnValue(
      sourcesState({ loading: false, settingsView: settingsViewOneProvider() }) as never
    )
    const dom = await render()

    const rows = [...dom.querySelectorAll<HTMLButtonElement>('.intelligence-provider-row')]
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.filter((row) => row.getAttribute('aria-current') === 'true')).toHaveLength(1)
    expect(rows[0]?.getAttribute('aria-current')).toBe('true')
    // 名字来自行内文本（provider 名 + 能力摘要），不是空按钮。
    expect(rows[0]?.textContent).toContain('P1')
  })

  it('draws the page once the read is done', async () => {
    // 详情是另一条读（每源一次）：读成了才画健康四格。这里给一条最小详情，
    // 否则页面会如实落「详情读不到」的错误态——那是另一条用例的事。
    ;(window as unknown as { platform: unknown }).platform = {
      products: {
        invoke: vi.fn(async (_productId: string, method: string) => method === 'intelligenceSources.getPageState'
          ? { detail: { health: { sourceId: 's1', runtimeStatus: 'healthy', connectivityStatus: 'connected', consecutiveFailures: 0 } } }
          : undefined)
      }
    }
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
