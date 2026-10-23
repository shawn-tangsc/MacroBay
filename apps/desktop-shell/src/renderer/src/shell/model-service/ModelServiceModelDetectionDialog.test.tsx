// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ModelDetectionMode } from '@platform/ai/providers/modelDetection/types'
import type { ModelDefinition } from '@platform/ai/providers/modelProviderTypes'

import { platformText } from '../../i18n/platformText'

import { ModelServiceModelDetectionDialog } from './ModelServiceModelDetectionDialog'

const labels = platformText['en-US'].models
const zh = platformText['zh-CN'].models

const models: ModelDefinition[] = [
  { id: 'chat-1', name: 'Chat 1', capabilities: { chat: true } },
  { id: 'chat-2', name: 'Chat 2', capabilities: { chat: true } }
]

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

async function renderDialog(overrides: {
  models?: readonly ModelDefinition[]
  progress?: { done: number; total: number }
  running?: boolean
  stoppable?: boolean
  stopped?: boolean
  protocolSummary?: { models: number; failed: number }
  configuredProtocolCount?: number
  onStart?: (modes: readonly ModelDetectionMode[]) => void
  onStop?: () => void
  onClose?: () => void
} = {}): Promise<{
  container: HTMLElement
  onStart: ReturnType<typeof vi.fn>
  onStop: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
}> {
  const onStart = vi.fn<(modes: readonly ModelDetectionMode[]) => void>(overrides.onStart)
  const onStop = vi.fn<() => void>(overrides.onStop)
  const onClose = vi.fn<() => void>(overrides.onClose)
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(ModelServiceModelDetectionDialog, {
      open: true,
      labels,
      models: overrides.models ?? models,
      progress: overrides.progress ?? { done: 0, total: 0 },
      running: overrides.running ?? false,
      stoppable: overrides.stoppable ?? false,
      stopped: overrides.stopped ?? false,
      ...(overrides.protocolSummary === undefined ? {} : { protocolSummary: overrides.protocolSummary }),
      ...(overrides.configuredProtocolCount === undefined
        ? {}
        : { configuredProtocolCount: overrides.configuredProtocolCount }),
      onStart,
      onStop,
      onClose
    }))
  })
  return { container: document.body, onStart, onStop, onClose }
}

async function click(container: HTMLElement, selector: string): Promise<void> {
  await act(async () => {
    container.querySelector<HTMLButtonElement>(selector)?.click()
    await Promise.resolve()
  })
}

async function toggleMode(container: HTMLElement, mode: string): Promise<void> {
  await act(async () => {
    container.querySelector<HTMLInputElement>(`[data-detect-mode="${mode}"]`)?.click()
    await Promise.resolve()
  })
}

/** 底部按钮的自描述顺序（`close` / `stop` / `start`）。 */
function footerOrder(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLButtonElement>('[data-detect-footer] button')].map((button) => {
    if (button.hasAttribute('data-detect-close')) return 'close'
    if (button.hasAttribute('data-detect-stop')) return 'stop'
    if (button.hasAttribute('data-detect-start')) return 'start'
    return 'unknown'
  })
}

describe('PLAT-82 检测模型对话框（可多选 + 进度 + 停止）', () => {
  it('offers connectivity and protocol support as two selected cards', async () => {
    const { container } = await renderDialog()

    expect(container.querySelector('[data-model-detect-dialog]')).not.toBeNull()
    expect(container.querySelector('[data-detect-mode="connectivity"]')?.getAttribute('aria-label'))
      .toBe(labels.detectModeConnectivity)
    expect(container.querySelector('[data-detect-mode="protocol"]')?.getAttribute('aria-label'))
      .toBe(labels.detectModeProtocol)
    expect(container.querySelector<HTMLInputElement>('[data-detect-mode="connectivity"]')?.checked).toBe(true)
    expect(container.querySelector<HTMLInputElement>('[data-detect-mode="protocol"]')?.checked).toBe(true)
    // 两个都是勾选态卡片（主题强调色描边），各自带一行说明 + 一行覆盖范围。
    for (const mode of ['connectivity', 'protocol']) {
      expect(container.querySelector(`[data-detect-row="mode-${mode}"]`)?.getAttribute('data-detect-row-checked'))
        .toBe('true')
    }
    expect(container.querySelector('[data-detect-row="mode-connectivity"] [data-detect-hint]')?.textContent)
      .toBe(labels.detectModeConnectivityHint)
    expect(container.querySelector('[data-detect-row="mode-connectivity"] [data-detect-scope]')?.textContent)
      .toBe(labels.detectModeConnectivityScope)
    expect(container.querySelector('[data-detect-row="mode-protocol"] [data-detect-hint]')?.textContent)
      .toBe(labels.detectModeProtocolHint)
    expect(container.querySelector('[data-detect-row="mode-protocol"] [data-detect-scope]')?.textContent)
      .toBe(labels.detectModeProtocolScope)
    expect(container.querySelector('[data-detect-start]')?.textContent).toBe(labels.detectStart)
    expect(footerOrder(container)).toEqual(['close', 'start'])
  })

  it('shows how many models will be checked under the title', async () => {
    const { container } = await renderDialog()
    expect(container.querySelector('[data-detect-count]')?.textContent).toBe(labels.detectModelsCount(2))
    expect(container.textContent).toContain(labels.detectModelsWarning)
    expect(container.querySelector('[data-detect-warning]')?.textContent).toContain(labels.detectSessionOnly)
  })

  it('keeps the "select at least one" hint out of every reachable state', async () => {
    const { container } = await renderDialog()

    // 两项都选中时绝不能出现「至少选择一个检测项」（旧版在这里就误报了）。
    expect(container.querySelector('[data-detect-mode-required]')).toBeNull()

    await toggleMode(container, 'protocol')
    // 取消一个之后只剩一项：提示仍不出现，最后一项被禁用。
    expect(container.querySelector('[data-detect-mode-required]')).toBeNull()
    expect(container.querySelector<HTMLInputElement>('[data-detect-mode="connectivity"]')?.disabled).toBe(true)
  })

  it('toggles a mode from the whole row label and never allows deselecting the last one', async () => {
    const { container, onStart } = await renderDialog()

    const protocolRow = container.querySelector('[data-detect-row="mode-protocol"]')
    expect(protocolRow?.tagName).toBe('LABEL')
    // 整行可点：input 被 label 包着（键盘同理走原生 checkbox）。
    expect(protocolRow?.querySelector<HTMLInputElement>('[data-detect-mode="protocol"]')?.closest('label'))
      .toBe(protocolRow)

    await act(async () => {
      protocolRow?.querySelector<HTMLElement>('[data-detect-label]')?.click()
      await Promise.resolve()
    })
    expect(container.querySelector<HTMLInputElement>('[data-detect-mode="protocol"]')?.checked).toBe(false)
    expect(container.querySelector('[data-detect-row="mode-protocol"]')?.getAttribute('data-detect-row-checked'))
      .toBe('false')
    // 只剩联通性 ⇒ 它的 checkbox 被禁用（至少选一个）。
    expect(container.querySelector<HTMLInputElement>('[data-detect-mode="connectivity"]')?.disabled).toBe(true)

    await click(container, '[data-detect-start]')
    expect(onStart).toHaveBeenCalledTimes(1)
    expect(onStart.mock.calls[0]?.[0]).toEqual(['connectivity'])
  })

  it('can start with only the protocol mode selected', async () => {
    const { container, onStart } = await renderDialog()

    await toggleMode(container, 'connectivity')
    await click(container, '[data-detect-start]')

    expect(onStart.mock.calls[0]?.[0]).toEqual(['protocol'])
  })

  it('hides the progress block until a run exists', async () => {
    const { container } = await renderDialog()

    expect(container.querySelector('[data-detect-progress]')).toBeNull()
    expect(container.querySelector('[data-detect-progress-track]')).toBeNull()
    expect(container.querySelector('[data-detect-percent]')).toBeNull()
  })

  it('renders done/total progress, a thin bar and the running primary action', async () => {
    const { container } = await renderDialog({ progress: { done: 2, total: 5 }, running: true })

    expect(container.querySelector('[data-detect-progress]')?.textContent).toContain(labels.detectProgress(2, 5))
    expect(container.querySelector('[data-detect-percent]')?.textContent).toBe('40%')
    expect(container.querySelector<HTMLElement>('[data-detect-progress-track]')?.style.height).toBe('4px')
    expect(container.querySelector<HTMLElement>('[data-detect-progress-fill]')?.style.width).toBe('40%')
    // 运行中：开始禁用并显示「检测中 x/y」，停止是开始左侧的次要按钮。
    expect(container.querySelector<HTMLButtonElement>('[data-detect-start]')?.disabled).toBe(true)
    expect(container.querySelector('[data-detect-start]')?.textContent).toBe(labels.detectStartRunning(2, 5))
    expect(container.querySelector<HTMLButtonElement>('[data-detect-stop]')?.disabled).toBe(false)
    expect(footerOrder(container)).toEqual(['close', 'stop', 'start'])
  })

  it('stops the running detection and shows the stopped note afterwards', async () => {
    const first = await renderDialog({ progress: { done: 3, total: 8 }, running: true })
    await click(first.container, '[data-detect-stop]')
    expect(first.onStop).toHaveBeenCalledTimes(1)

    await act(async () => root?.unmount())
    document.body.replaceChildren()
    const second = await renderDialog({ progress: { done: 3, total: 8 }, stopped: true })
    // 结束后保留最后一帧 + 「· 已停止」；没有可停的 run ⇒ 不再显示停止按钮。
    expect(second.container.querySelector('[data-detect-progress]')?.textContent).toContain(labels.detectProgress(3, 8))
    expect(second.container.querySelector('[data-detect-progress]')?.textContent).toContain(labels.detectStopped)
    expect(second.container.querySelector('[data-detect-stop]')).toBeNull()
    expect(second.container.querySelector<HTMLButtonElement>('[data-detect-start]')?.disabled).toBe(false)
    expect(footerOrder(second.container)).toEqual(['close', 'start'])
  })

  it('keeps a foreign run stoppable while this provider is idle', async () => {
    const { container, onStop } = await renderDialog({ stoppable: true })
    const stop = container.querySelector<HTMLButtonElement>('[data-detect-stop]')
    expect(stop?.disabled).toBe(false)
    await click(container, '[data-detect-stop]')
    expect(onStop).toHaveBeenCalledTimes(1)
  })

  it('keeps close separate from stop', async () => {
    const { container, onClose, onStop } = await renderDialog({ progress: { done: 1, total: 4 }, running: true })

    await click(container, '[data-detect-close]')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onStop).not.toHaveBeenCalled()
  })

  it('shows an all-passed protocol summary once protocol mode has results', async () => {
    const { container } = await renderDialog({ protocolSummary: { models: 3, failed: 0 } })
    const line = container.querySelector('[data-model-detect-protocol-summary]')
    expect(line?.textContent).toBe(labels.detectProtocolSummaryPassed(3))
    expect(line?.getAttribute('data-model-detect-protocol-summary-state')).toBe('passed')
  })

  it('counts the failed protocol checks in the run summary', async () => {
    const { container } = await renderDialog({ protocolSummary: { models: 3, failed: 2 } })
    const line = container.querySelector('[data-model-detect-protocol-summary]') as HTMLElement | null
    expect(line?.textContent).toBe(labels.detectProtocolSummaryFailed(3, 2))
    expect(line?.getAttribute('data-model-detect-protocol-summary-state')).toBe('failed')
    // 颜色走主题变量（深色主题下也可读）。
    expect(line?.style.color).toContain('var(--danger)')
  })

  it('hides the protocol summary when protocol mode is not selected', async () => {
    const { container } = await renderDialog({ protocolSummary: { models: 3, failed: 1 } })
    expect(container.querySelector('[data-model-detect-protocol-summary]')).not.toBeNull()

    await toggleMode(container, 'protocol')
    expect(container.querySelector<HTMLInputElement>('[data-detect-mode="protocol"]')?.checked).toBe(false)
    expect(container.querySelector('[data-model-detect-protocol-summary]')).toBeNull()
  })

  it('never shows a protocol summary before protocol results exist', async () => {
    const { container } = await renderDialog()
    expect(container.querySelector('[data-model-detect-protocol-summary]')).toBeNull()
  })

  it('spells out that a single-endpoint provider has only one protocol to test', async () => {
    const { container } = await renderDialog({ configuredProtocolCount: 1 })
    expect(container.querySelector('[data-detect-protocol-single-channel]')?.textContent)
      .toBe(labels.detectProtocolSingleChannel)
  })

  it('keeps the single-protocol hint away from multi-endpoint providers', async () => {
    const { container } = await renderDialog({ configuredProtocolCount: 4 })
    expect(container.querySelector('[data-detect-protocol-single-channel]')).toBeNull()
  })

  it('drops the single-protocol hint when protocol mode is unchecked', async () => {
    const { container } = await renderDialog({ configuredProtocolCount: 1 })
    await toggleMode(container, 'protocol')
    expect(container.querySelector('[data-detect-protocol-single-channel]')).toBeNull()
  })

  it('disables start when the provider has no models', async () => {
    const { container } = await renderDialog({ models: [] })
    expect(container.querySelector<HTMLButtonElement>('[data-detect-start]')?.disabled).toBe(true)
    expect(container.querySelector('[data-detect-count]')?.textContent).toBe(labels.detectModelsCount(0))
  })

  it('keeps Chinese wording for the modes, the scope lines and the run labels', () => {
    expect(zh.detectModeConnectivity).toBe('联通性')
    expect(zh.detectModeProtocol).toBe('协议支持')
    expect(zh.detectModeConnectivityScope).toBe('覆盖全部文本模型')
    expect(zh.detectModeProtocolScope).toBe('仅聊天模型')
    expect(zh.detectModeRequired).toBe('至少选择一个检测项')
    expect(zh.detectModelsCount(12)).toBe('将检测 12 个模型')
    expect(zh.detectProgress(3, 8)).toBe('已完成 3/8')
    expect(zh.detectStartRunning(3, 8)).toBe('检测中 3/8')
    expect(zh.detectStop).toBe('停止')
    expect(zh.detectionFailedWithReason('超时')).toBe('失败：超时')
    expect(zh.detectionSkippedWithReason('非聊天模型')).toBe('跳过：非聊天模型')
    expect(zh.detectionProtocolCount(2, 2)).toBe('协议 2/2')
    expect(zh.detectProtocolSingleChannel).toBe('该供应商只有 1 条协议可测')
    expect(zh.detectProtocolSummaryPassed(3)).toBe('协议支持：已测 3 个模型，全部通过')
    expect(zh.detectProtocolSummaryFailed(3, 1)).toBe('协议支持：已测 3 个模型，1 项不通')
  })
})
