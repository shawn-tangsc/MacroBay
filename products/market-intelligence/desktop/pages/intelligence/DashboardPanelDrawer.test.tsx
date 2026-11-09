// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetPanelView, mockGetPageState } = vi.hoisted(() => ({
  mockGetPanelView: vi.fn(),
  mockGetPageState: vi.fn()
}))

vi.mock('../../shared/ipc/intelligenceSourcesClient', () => ({
  intelligenceSourcesClient: {
    getPanelView: mockGetPanelView,
    getPageState: mockGetPageState,
    revealCredential: vi.fn(async () => ({ apiKey: null })),
    runNow: vi.fn(async () => ({})),
    setEnabled: vi.fn(async () => ({})),
    testConnection: vi.fn(async () => ({}))
  }
}))

import { panelView, type PanelView, type SourceView } from '../../../service/intelligence/application/sourceProjection'
import { productText } from '../../shared/i18n/productText'
import { DashboardPanelDrawer } from './DashboardPanelDrawer'

const text = productText['zh-CN'].pages.intelligence.portal
const dashboardView = panelView('dashboard')!
let root: Root | undefined


beforeEach(() => {
  mockGetPanelView.mockReset()
  mockGetPageState.mockReset()
  mockGetPageState.mockResolvedValue({ detail: undefined })
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

describe('DashboardPanelDrawer read failure', () => {
  it('states the failure instead of rendering the registry projection, and offers a retry', async () => {
    mockGetPanelView.mockRejectedValue(new Error('request failed'))
    await openDrawer(false)

    // 句子归平台：这里只断言统一状态面出现且带一个可点的动作，不再断言产品自己那句话。
    const failure = document.body.querySelector('.state-view--error')
    expect(failure, 'a failed read renders the shared state surface').not.toBeNull()
    expect(failure?.querySelector('.state-view__action'), 'error always offers an action').not.toBeNull()
    expect(document.body.querySelector('[data-drawer-state="unavailable"]')).not.toBeNull()
    // Guard: the static list is not on screen on an ordinary failure. The same rejection with
    // sample mode on does render it (next case), so the branch is gated by the flag, not dead.
    expect(document.body.querySelector('.intelligence-catalog-list')).toBeNull()
    expect(document.body.querySelector('.intelligence-provider-row')).toBeNull()
    expect(document.body.querySelector('[data-sample-marker]')).toBeNull()
  })

  it('lets the registry projection stand in only in sample mode, and marks it as sample data', async () => {
    mockGetPanelView.mockRejectedValue(new Error('request failed'))
    await openDrawer(true)

    expect(document.body.querySelector('[data-sample-marker]')).not.toBeNull()
    expect(document.body.textContent).toContain(text.sampleMode.watermark)
    expect(document.body.querySelector('.intelligence-provider-row')).not.toBeNull()
    expect(document.body.querySelector('.state-view--error')).toBeNull()
  })

  it('retries by asking again: the second answer replaces the error', async () => {
    mockGetPanelView.mockRejectedValueOnce(new Error('request failed')).mockResolvedValueOnce(dashboardView)
    await openDrawer(false)
    expect(document.body.querySelector('[data-drawer-state="unavailable"]')).not.toBeNull()

    await act(async () => {
      (document.querySelector('.state-view__action') as HTMLButtonElement).click()
    })
    await flush()

    expect(mockGetPanelView).toHaveBeenCalledTimes(2)
    expect(document.body.querySelector('[data-drawer-state="unavailable"]')).toBeNull()
    expect(document.body.querySelector('.intelligence-catalog-list')).not.toBeNull()
  })
})

/**
 * 左栏目录点只许表达**健康**：绿 = 已启用且每个启用源都健康。
 *
 * 之前它只看「已启用数 > 0」，于是 BLS 403（启用但不可用）和 Fed（正常）看起来一模一样——
 * 读者在目录里分不出谁坏了。判据不许另写：色调一律来自 `sourceHealthTone`。
 */
describe('DashboardPanelDrawer catalog health dot', () => {
  it('lights only when every enabled source is connected and fresh', async () => {
    mockGetPanelView.mockResolvedValue(viewWithSource({ enabled: true, health: 'healthy' }))
    await openDrawer(false)

    expect(dot(0).classList.contains('is-on')).toBe(true)
  })

  it('does not light for an enabled source that is unavailable', async () => {
    mockGetPanelView.mockResolvedValue(
      viewWithSource({
        enabled: true,
        health: 'healthy',
        unavailable: {
          reasonCode: 'official-endpoint-returned-403',
          automaticSync: 'stopped',
          decidedAt: '2026-11-09'
        }
      })
    )
    await openDrawer(false)

    // 不可用不是「健康」，也不是「失败」：中性点（不亮、不红）。
    expect(dot(0).classList.contains('is-on')).toBe(false)
    expect(dot(0).classList.contains('is-bad')).toBe(false)
  })

  it('stays neutral when nothing is enabled', async () => {
    mockGetPanelView.mockResolvedValue(viewWithSource({ enabled: false, health: 'healthy' }))
    await openDrawer(false)

    expect(dot(0).classList.contains('is-on')).toBe(false)
  })

  it('turns red for a failed enabled source, and the expanded detail names that source', async () => {
    const source = firstSource()
    mockGetPanelView.mockResolvedValue(viewWithSource({ enabled: true, health: 'failed' }))
    await openDrawer(false)

    expect(dot(0).classList.contains('is-bad')).toBe(true)
    // 红了必须能定位：展开项里点名那个源（而不是只让读者知道「这组坏了」）。
    const sourceNames = productText['zh-CN'].settings.intelligenceSources.sourceNames as Readonly<Record<string, string>>
    const named = sourceNames[source.sourceId] ?? source.displayName
    expect(document.body.textContent).toContain(named)
  })
})

function firstProvider(): PanelView['providers'][number] {
  return dashboardView.providers[0]!
}

function firstSource(): SourceView {
  return firstProvider().sources[0]!
}

/** 用一个受控源替换首个 provider 的源列表：其余字段取真实投影，避免手写整份视图。 */
function viewWithSource(patch: Partial<SourceView>): PanelView {
  const provider = firstProvider()
  const source = { ...firstSource(), ...patch }
  return { ...dashboardView, providers: [{ ...provider, sources: [source] }] }
}

function dot(index: number): HTMLElement {
  const dots = [...document.body.querySelectorAll<HTMLElement>('.intelligence-provider-state i')]
  const found = dots[index]
  if (!found) throw new Error(`Expected a catalog dot at ${index}`)
  return found
}

async function openDrawer(sampleActive: boolean): Promise<void> {
  const container = document.createElement('div')
  document.body.append(container)
  const localRoot = createRoot(container)
  root = localRoot
  await act(async () => localRoot.render(createElement(DashboardPanelDrawer, {
    open: true,
    onClose: () => undefined,
    sampleActive
  })))
  await flush()
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}
