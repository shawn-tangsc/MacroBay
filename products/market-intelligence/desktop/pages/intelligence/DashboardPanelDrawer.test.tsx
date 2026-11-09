// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { providerHealthMarker } from '../../../service/intelligence/application/sourceProjection'

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
  const settings = () => productText['zh-CN'].settings.intelligenceSources
  const providerName = () => (settings().providerNames as Readonly<Record<string, string>>)[firstProvider().providerId] ?? firstProvider().displayName

  it('draws nothing for a healthy provider, and leaves the row without a health name', async () => {
    mockGetPanelView.mockResolvedValue(viewWithSource({ enabled: true, healthState: 'healthy', healthMarker: 'none' }))
    await openDrawer(false)

    expect(dot()).toBeNull()
    // 健康是默认状态：不画标记，也不在可访问名里加健康词（不为快速扫读的一列加噪）。
    expect(document.querySelector<HTMLElement>('.intelligence-provider-row')?.getAttribute('aria-label')).toBeNull()
  })

  it('rings an enabled but unavailable source instead of colouring it (shape, not hue)', async () => {
    mockGetPanelView.mockResolvedValue(viewWithSource({
      enabled: true,
      healthState: 'off',
      healthMarker: 'ring',
      unavailable: { reasonCode: 'official-endpoint-returned-403', automaticSync: 'stopped', decidedAt: '2026-11-09' }
    }))
    await openDrawer(false)

    // 「根本拿不到数据」必须看得见，但不用红吓人：空心环 + 第二行的原因句。
    expect(dot()?.classList.contains('is-muted')).toBe(true)
    expect(dot()?.classList.contains('is-warn')).toBe(false)
    expect(dot()?.classList.contains('is-bad')).toBe(false)
    // 名字恰为「供应商名 + 档位词」：不带配置摘要、不重复「来源健康」。
    expect(rowName()).toBe(`${providerName()} ${settings().unavailableShort}`)
    expect(rowName()).not.toContain(settings().providerSummary.replace('{total}', '').replace('{enabled}', '').trim() || '\u0000')
  })

  it('draws nothing when nothing is enabled, even with an unavailable source present', async () => {
    mockGetPanelView.mockResolvedValue(viewWithSource({
      enabled: false,
      healthState: 'off',
      healthMarker: 'none',
      unavailable: { reasonCode: 'official-endpoint-returned-403', automaticSync: 'stopped', decidedAt: '2026-11-09' }
    }))
    await openDrawer(false)

    // muted 是个桶：未启用也在里面，所以不能按 tone 画环。
    expect(dot()).toBeNull()
    expect(document.querySelector<HTMLElement>('.intelligence-provider-row')?.getAttribute('aria-label')).toBeNull()
  })

  it('draws nothing for an enabled source whose health is simply unknown', async () => {
    mockGetPanelView.mockResolvedValue(viewWithSource({ enabled: true, healthState: 'off', healthMarker: 'none' }))
    await openDrawer(false)

    // 「没有健康读数」不等于「不可用」：没有 unavailable 就什么都不画。
    expect(dot()).toBeNull()
  })

  it('fills red for a failed source, with provider + tone word as the name', async () => {
    mockGetPanelView.mockResolvedValue(viewWithSource({ enabled: true, healthState: 'failed', healthMarker: 'bad' }))
    await openDrawer(false)

    expect(dot()?.classList.contains('is-bad')).toBe(true)
    expect(dot()?.classList.contains('is-muted')).toBe(false)
    expect(rowName()).toBe(`${providerName()} ${settings().health.statuses.failed}`)
  })

  it('fills red for repeated failures too (it is a failure the reader can still fix)', async () => {
    mockGetPanelView.mockResolvedValue(viewWithSource({ enabled: true, healthState: 'repeated-failures', healthMarker: 'bad' }))
    await openDrawer(false)

    expect(dot()?.classList.contains('is-bad')).toBe(true)
    expect(rowName()).toBe(`${providerName()} ${settings().health.statuses.failed}`)
  })

  it('fills yellow for stale data, with the same provider + tone word name', async () => {
    mockGetPanelView.mockResolvedValue(viewWithSource({ enabled: true, healthState: 'stale', healthMarker: 'warn' }))
    await openDrawer(false)

    expect(dot()?.classList.contains('is-warn')).toBe(true)
    expect(dot()?.classList.contains('is-muted')).toBe(false)
    expect(rowName()).toBe(`${providerName()} ${settings().health.statuses['data-stale']}`)
  })
})

/** 目录项（provider 行）的可访问名：读屏听到的那一句。 */
function rowName(): string {
  const row = document.querySelector<HTMLElement>('.intelligence-provider-row')
  if (!row) throw new Error('Expected a catalog row')
  return row.getAttribute('aria-label') ?? row.textContent ?? ''
}

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
  // provider 级标记由投影聚合（`providerHealthMarker`），夹具照投影的形状给出，组件不再自己算。
  return { ...dashboardView, providers: [{ ...provider, sources: [source], healthMarker: providerHealthMarker([source]) }] }
}

function dot(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('.intelligence-provider-state i')
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
