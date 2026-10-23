// @vitest-environment happy-dom

import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { platformText } from '../../i18n/platformText'

import { providerFixture, renderModelServiceSettings, type DetectionResultFixture } from './modelServicePageHarness'

const fiveModels = ['m-1', 'm-2', 'm-3', 'm-4', 'm-5'].map((id) => ({
  id,
  name: id,
  capabilities: { chat: true }
}))

const labels = platformText['en-US'].models

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(() => {
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

async function click(container: HTMLElement, selector: string): Promise<void> {
  await act(async () => {
    container.querySelector<HTMLButtonElement>(selector)?.click()
    await Promise.resolve()
  })
}

/** 让 run 停在「进行中」：不发任何 progress/done，由用例手动驱动。 */
function holdingDetect(total: number): (providerId: string, request: { modes: string[]; runId: string }) => Promise<{ accepted: boolean; total: number }> {
  return async () => ({ accepted: true, total })
}

/**
 * PLAT-82：检测 run 活在模块级内存 store 里。
 * 关弹窗、切供应商都不取消；只有「停止」才取消；结果不落库。
 */
describe('PLAT-82 后台检测', () => {
  it('keeps running after the dialog closes and stops on demand', async () => {
    const page = await renderModelServiceSettings({
      provider: { models: fiveModels },
      detectModels: holdingDetect(fiveModels.length)
    })

    await click(page.container, '[data-models-detect]')
    await click(document.body, '[data-detect-start]')
    expect(page.api.detectModels).toHaveBeenCalledTimes(1)
    const request = page.api.detectModels.mock.calls[0]?.[1] as { modes: string[]; runId: string }
    expect(request.modes).toEqual(['connectivity', 'protocol'])

    // 关弹窗 ≠ 取消：按钮进入运行态。
    await click(document.body, '[data-detect-close]')
    expect(page.api.cancelModelDetection).not.toHaveBeenCalled()
    expect(page.container.querySelector('[data-models-detect-running]')?.getAttribute('data-models-detect-running'))
      .toBe('true')

    // 结果继续到达（内存 store 里累积），工具栏进度跟着走。
    await act(async () => {
      for (const modelId of ['m-1', 'm-2']) {
        page.api.emitModelDetectionProgress({
          runId: request.runId,
          modelId,
          status: 'ok',
          connectivity: { status: 'ok' }
        })
      }
      await Promise.resolve()
    })
    expect(page.container.querySelector('[data-models-detect]')?.textContent).toContain('2/5')

    // 重新打开：进度保留，不回零。
    await click(page.container, '[data-models-detect]')
    expect(document.body.textContent).toContain('Completed 2/5')

    await click(document.body, '[data-detect-stop]')
    expect(page.api.cancelModelDetection).toHaveBeenCalledWith(request.runId)

    await act(async () => {
      page.api.emitModelDetectionDone(request.runId, { stopped: true })
      await Promise.resolve()
    })
    expect(page.container.querySelector('[data-models-detect-running]')?.getAttribute('data-models-detect-running'))
      .toBe('false')
    expect(page.container.querySelector('[data-models-detect]')?.textContent).toBe('Detect models')

    await act(async () => page.root.unmount())
  })

  it('stops a run started on another provider through the global entry', async () => {
    const page = await renderModelServiceSettings({
      providers: [
        { ...providerFixture, id: 'alpha', name: 'Alpha', models: fiveModels },
        { ...providerFixture, id: 'beta', name: 'Beta', models: [{ id: 'b-1', name: 'B-1', capabilities: { chat: true } }] }
      ],
      detectModels: holdingDetect(fiveModels.length)
    })

    await click(page.container, '[data-models-detect]')
    await click(document.body, '[data-detect-start]')
    const request = page.api.detectModels.mock.calls[0]?.[1] as { runId: string }
    await act(async () => {
      page.api.emitModelDetectionProgress({
        runId: request.runId,
        modelId: 'm-1',
        status: 'ok',
        connectivity: { status: 'ok' }
      })
      await Promise.resolve()
    })
    await click(document.body, '[data-detect-close]')

    // 切到 beta：alpha 的 run 仍在跑，全局入口仍可停它。
    await click(page.container, '[data-provider-row="beta"]')
    await click(page.container, '[data-models-detect]')
    const stop = document.body.querySelector<HTMLButtonElement>('[data-detect-stop]')
    expect(stop?.disabled).toBe(false)
    await click(document.body, '[data-detect-stop]')
    expect(page.api.cancelModelDetection).toHaveBeenCalledWith(request.runId)
    await click(document.body, '[data-detect-close]')

    // 切回 alpha：本次会话的结果仍在，run 已停止。
    await click(page.container, '[data-provider-row="alpha"]')
    expect(page.container.querySelector('[data-model-row="m-1"] [data-model-detection-status="ok"]')).not.toBeNull()
    expect(page.container.querySelector('[data-models-detect-running]')?.getAttribute('data-models-detect-running'))
      .toBe('false')

    await act(async () => page.root.unmount())
  })

  it('never persists detection results', async () => {
    const page = await renderModelServiceSettings({
      provider: { models: fiveModels },
      detectionResult: (): DetectionResultFixture => ({ status: 'failed', reasonCode: 'http_401' })
    })

    await click(page.container, '[data-models-detect]')
    await click(document.body, '[data-detect-start]')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(page.container.querySelector('[data-model-detection-status="failed"]')).not.toBeNull()
    expect(page.api.upsert).not.toHaveBeenCalled()
    expect(page.api.addOrUpdateModel).not.toHaveBeenCalled()
    expect(page.api.applyModelSync).not.toHaveBeenCalled()

    await act(async () => page.root.unmount())
  })

  it('shows the reason inline and red-marks only provider-declared protocols that failed', async () => {
    const page = await renderModelServiceSettings({
      provider: {
        models: [
          { id: 'declared', name: 'Declared', capabilities: { chat: true }, declaredProtocols: ['messages'] },
          { id: 'undeclared', name: 'Undeclared', capabilities: { chat: true }, declaredProtocols: ['responses'] }
        ]
      },
      detectionResult: (): DetectionResultFixture => ({
        status: 'failed',
        reasonCode: 'endpoint_unsupported',
        declaredProtocolFailures: ['messages']
      })
    })

    await click(page.container, '[data-models-detect]')
    await click(document.body, '[data-detect-start]')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const declared = page.container.querySelector('[data-model-row="declared"]')
    const undeclared = page.container.querySelector('[data-model-row="undeclared"]')
    expect(declared?.getAttribute('data-model-protocol-failed')).toBe('messages')
    expect(declared?.querySelector('[data-model-protocol-failed-chip="messages"]')).not.toBeNull()
    // 没声明 messages ⇒ 同一条失败结论也不标红 responses。
    expect(undeclared?.getAttribute('data-model-protocol-failed')).toBeNull()
    expect(declared?.querySelector('[data-model-detection-status="failed"]')?.textContent)
      .toContain('Failed:')

    await act(async () => page.root.unmount())
  })

  it('renders skipped and cancelled states from the result', async () => {
    const page = await renderModelServiceSettings({
      provider: { models: fiveModels },
      detectionResult: (_providerId, modelId): DetectionResultFixture => (modelId === 'm-1'
        ? { status: 'skipped', skipReason: 'not_chat_model' }
        : { status: 'cancelled', reasonCode: 'cancelled' })
    })

    await click(page.container, '[data-models-detect]')
    await click(document.body, '[data-detect-start]')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(page.container.querySelector('[data-model-row="m-1"] [data-model-detection-status="skipped"]')?.textContent)
      .toBe('Skipped: not a chat model')
    expect(page.container.querySelector('[data-model-row="m-2"] [data-model-detection-status="cancelled"]')?.textContent)
      .toBe('Stopped')

    await act(async () => page.root.unmount())
  })
})

describe('PLAT-82 协议结果看得见', () => {
  it('shows the per-model protocol count and the run summary after a run', async () => {
    const page = await renderModelServiceSettings({
      provider: { models: fiveModels.slice(0, 2) },
      detectionResult: (_providerId, modelId): DetectionResultFixture => (modelId === 'm-1'
        ? {
          protocols: [
            { protocol: 'chat-completions', ok: true },
            { protocol: 'messages', ok: false, reasonCode: 'endpoint_unsupported' }
          ]
        }
        : {
          protocols: [
            { protocol: 'chat-completions', ok: true, reused: true },
            { protocol: 'messages', ok: true }
          ]
        })
    })

    await click(page.container, '[data-models-detect]')
    await click(document.body, '[data-detect-start]')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    // 行内：一个状态位 + 协议摘要（通/总数）。
    const failedRow = page.container.querySelector('[data-model-row="m-1"] [data-model-detection-status]')
    expect(failedRow?.textContent).toBe('OK · Protocols 1/2')
    expect(failedRow?.getAttribute('data-model-protocol-summary')).toBe('1/2')
    expect(page.container.querySelector('[data-model-row="m-2"] [data-model-detection-status]')?.textContent)
      .toBe('OK · Protocols 2/2')

    // 弹窗：一行汇总（M=1 项不通）。
    expect(document.body.querySelector('[data-model-detect-protocol-summary]')?.textContent)
      .toBe(labels.detectProtocolSummaryFailed(2, 1))

    await act(async () => page.root.unmount())
  })

  it('shows the protocol chip that detection proved (persisted evidence)', async () => {
    // 用户实测场景：siliconflow 的模型记录原本只有 chat/completions，实测 messages 通过后
    // 主进程把证据写回模型（supportedProtocols + probedProtocols），刷新列表即可见。
    const page = await renderModelServiceSettings({
      provider: {
        models: [{
          id: 'm-1',
          name: 'DeepSeek V3.2',
          capabilities: { chat: true },
          supportedProtocols: ['chat-completions', 'messages'],
          probedProtocols: ['messages']
        }],
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://api.siliconflow.cn' },
          { protocol: 'messages', baseUrl: 'https://api.siliconflow.cn' }
        ]
      },
      detectionResult: (): DetectionResultFixture => ({
        protocols: [
          { protocol: 'chat-completions', ok: true, reused: true },
          { protocol: 'messages', ok: true }
        ]
      })
    })

    await click(page.container, '[data-models-detect]')
    await click(document.body, '[data-detect-start]')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    const row = page.container.querySelector('[data-model-row="m-1"]')
    expect(row?.querySelector('[data-model-detection-status]')?.textContent).toBe('OK · Protocols 2/2')
    const messagesChip = row?.querySelector('[data-model-protocol-chip="messages"]')
    expect(messagesChip?.getAttribute('data-model-protocol-source')).toBe('probe')
    expect(messagesChip?.getAttribute('title')).toBe('Anthropic Messages · Passed by detection')

    await act(async () => page.root.unmount())
  })

  it('tells the user when a provider only has one protocol to test', async () => {
    const page = await renderModelServiceSettings({
      provider: {
        models: fiveModels.slice(0, 1),
        endpoints: [{ protocol: 'chat-completions', baseUrl: 'https://api.siliconflow.cn' }]
      }
    })

    await click(page.container, '[data-models-detect]')
    expect(document.body.querySelector('[data-detect-protocol-single-channel]')?.textContent)
      .toBe(labels.detectProtocolSingleChannel)

    await act(async () => page.root.unmount())
  })
})
