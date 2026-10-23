// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { platformText } from '../../../i18n/platformText'
import { TaskAutomationResourceJobsSection } from './TaskAutomationResourceJobsSection'

const platform = vi.hoisted(() => ({
  listSchedules: vi.fn(),
  getProductSummaries: vi.fn()
}))

import { useResourceJobSchedules } from './useResourceJobSchedules'

const labels = platformText['zh-CN'].taskAutomation

type Captured = { current: ReturnType<typeof useResourceJobSchedules> | null }

describe('useResourceJobSchedules', () => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

  afterEach(() => {
    platform.listSchedules.mockReset()
    platform.getProductSummaries.mockReset()
    vi.restoreAllMocks()
    delete (window as unknown as { platform?: unknown }).platform
    document.body.replaceChildren()
  })

  it('loads the read-only schedule projection and resolves product display names', async () => {
    platform.listSchedules.mockResolvedValue([job({ id: 'job-1', productId: 'market-intelligence' })])
    platform.getProductSummaries.mockResolvedValue([
      { id: 'market-intelligence', name: { 'zh-CN': '情报模块', 'en-US': 'Market Intelligence' } }
    ])
    installPlatform()

    const capture = await mountHook()

    await vi.waitFor(() => expect(capture.current?.loading).toBe(false))
    expect(platform.listSchedules).toHaveBeenCalledTimes(1)
    expect(capture.current?.items).toHaveLength(1)
    expect(capture.current?.productNames).toEqual({ 'market-intelligence': '情报模块' })
    expect(capture.current?.error).toBe(false)
    expect(capture.current?.errorReason).toBeNull()
  })

  it('still lists the schedules when product display names are unavailable', async () => {
    platform.listSchedules.mockResolvedValue([job({ id: 'job-1', productId: 'market-intelligence' })])
    platform.getProductSummaries.mockRejectedValue(new Error('product-summaries-unavailable'))
    installPlatform()

    const capture = await mountHook()

    await vi.waitFor(() => expect(capture.current?.loading).toBe(false))
    expect(capture.current?.items).toHaveLength(1)
    expect(capture.current?.productNames).toEqual({})
    expect(capture.current?.error).toBe(false)
  })

  it('surfaces a failed projection read and retries it', async () => {
    platform.listSchedules.mockRejectedValueOnce(new Error('ipc-failed /private/secret'))
    platform.getProductSummaries.mockResolvedValue([])
    installPlatform()

    const capture = await mountHook()
    await vi.waitFor(() => expect(capture.current?.loading).toBe(false))
    expect(capture.current?.error).toBe(true)
    expect(capture.current?.errorReason).toBe('read-failed')
    expect(capture.current?.items).toEqual([])

    platform.listSchedules.mockResolvedValueOnce([job({ id: 'job-2' })])
    await act(async () => {
      await capture.current!.reload()
    })
    expect(capture.current?.error).toBe(false)
    expect(capture.current?.items.map((item) => item.id)).toEqual(['job-2'])
  })

  it('renders a visible, retryable error when the preload has no jobs bridge', async () => {
    platform.getProductSummaries.mockResolvedValue([])
    ;(window as unknown as { platform: unknown }).platform = {
      app: { getProductSummaries: platform.getProductSummaries }
    }

    const { capture, container } = await mountSection()

    await vi.waitFor(() => expect(capture.current?.loading).toBe(false), { timeout: 2_000 })
    expect(capture.current?.error).toBe(true)
    expect(capture.current?.errorReason).toBe('bridge-missing')
    expect(capture.current?.items).toEqual([])
    expect(container.textContent).toContain(labels.resourceBridgeMissing)
    expect(container.textContent).not.toContain(labels.resourceLoading)
    expect(container.textContent).not.toContain('正在加载资源任务')
    expect(retryButton(container)).toBeDefined()
    expect(platform.listSchedules).not.toHaveBeenCalled()

    // 重试按钮必须真的可用：桥恢复后点一次就回到正常列表，而不是只换一行文案。
    platform.listSchedules.mockResolvedValue([job({ id: 'job-1', title: 'Recovered job' })])
    installPlatform()
    await act(async () => {
      ;(retryButton(container) as HTMLButtonElement).click()
    })
    await vi.waitFor(() => expect(container.textContent).toContain('Recovered job'))
    expect(capture.current?.loading).toBe(false)
    expect(capture.current?.error).toBe(false)
    expect(capture.current?.errorReason).toBeNull()
  })

  it('renders the same error instead of loading forever when listSchedules throws synchronously', async () => {
    platform.listSchedules.mockImplementation(() => {
      throw new Error('ipc bridge detached /private/secret')
    })
    platform.getProductSummaries.mockResolvedValue([])
    installPlatform()

    const { capture, container } = await mountSection()

    await vi.waitFor(() => expect(capture.current?.loading).toBe(false), { timeout: 2_000 })
    expect(capture.current?.error).toBe(true)
    expect(capture.current?.errorReason).toBe('read-failed')
    expect(capture.current?.items).toEqual([])
    expect(container.textContent).toContain(labels.resourceLoadFailed)
    expect(container.textContent).not.toContain(labels.resourceBridgeMissing)
    expect(container.textContent).not.toContain('正在加载资源任务')
    expect(container.textContent).not.toContain('/private/secret')
    expect(retryButton(container)).toBeDefined()
  })

  it('leaves loading after the bounded timeout when the bridge never resolves', async () => {
    platform.listSchedules.mockReturnValue(new Promise(() => {}))
    platform.getProductSummaries.mockResolvedValue([])
    installPlatform()

    const { capture, container } = await mountSection({ timeoutMs: 25 })

    await vi.waitFor(() => expect(capture.current?.loading).toBe(false), { timeout: 2_000 })
    expect(capture.current?.error).toBe(true)
    expect(capture.current?.errorReason).toBe('timeout')
    expect(capture.current?.items).toEqual([])
    expect(container.textContent).toContain(labels.resourceLoadTimeout)
    expect(container.textContent).not.toContain('正在加载资源任务')
    expect(retryButton(container)).toBeDefined()
  })

  it('clears the bounded timeout when the read settles', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    platform.listSchedules.mockResolvedValue([job({ id: 'job-1' })])
    platform.getProductSummaries.mockResolvedValue([])
    installPlatform()

    const { capture } = await mountSection({ timeoutMs: 60_000 })

    await vi.waitFor(() => expect(capture.current?.loading).toBe(false))
    expect(clearSpy).toHaveBeenCalled()
  })

  it('clears the pending bounded timeout when the component unmounts', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    platform.listSchedules.mockReturnValue(new Promise(() => {}))
    platform.getProductSummaries.mockResolvedValue([])
    installPlatform()

    const { root } = await mountSection({ timeoutMs: 60_000 })
    clearSpy.mockClear()
    await act(async () => {
      root.unmount()
    })

    expect(clearSpy).toHaveBeenCalled()
  })
})

function installPlatform(): void {
  ;(window as unknown as { platform: unknown }).platform = {
    jobs: { listSchedules: platform.listSchedules },
    app: { getProductSummaries: platform.getProductSummaries }
  }
}

function retryButton(container: HTMLElement): Element | undefined {
  return Array.from(container.querySelectorAll('button'))
    .find((button) => button.textContent?.trim() === labels.retry)
}

async function mountHook(): Promise<Captured> {
  const capture: Captured = { current: null }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(Harness, { capture }))
  })
  return capture
}

async function mountSection(options: { timeoutMs?: number } = {}): Promise<{
  capture: Captured
  container: HTMLElement
  root: Root
}> {
  const capture: Captured = { current: null }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(SectionHarness, { capture, timeoutMs: options.timeoutMs }))
  })
  return { capture, container, root }
}

function Harness({ capture }: { capture: Captured }): null {
  capture.current = useResourceJobSchedules({ language: 'zh-CN' })
  return null
}

/** 用真实 hook 驱动真实区块，断言用户实际看到的 DOM 文案与按钮。 */
function SectionHarness({ capture, timeoutMs }: { capture: Captured; timeoutMs?: number }): React.ReactElement {
  const controller = useResourceJobSchedules({ language: 'zh-CN', timeoutMs })
  capture.current = controller
  return createElement(TaskAutomationResourceJobsSection, {
    labels,
    language: 'zh-CN',
    controller
  })
}

function job(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'job-1',
    title: 'Job',
    owner: 'platform',
    productId: null,
    trigger: { kind: 'manual' },
    registered: true,
    nextRunAt: null,
    lastRunAt: null,
    lastOutcome: 'never',
    lastRunStatus: null,
    lastDurationMs: null,
    lastErrorSummary: null,
    ...overrides
  }
}
