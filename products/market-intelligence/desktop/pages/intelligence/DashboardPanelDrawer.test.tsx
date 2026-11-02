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

import { panelView } from '../../../service/intelligence/application/sourceProjection'
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
