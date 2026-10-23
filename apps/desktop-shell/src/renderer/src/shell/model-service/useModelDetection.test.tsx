// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ModelDetectionResult } from '@platform/ai/providers/modelDetection/types'

import {
  getModelDetectionSnapshot,
  isDetectionRunning,
  resetModelDetectionControllerForTests,
  resultForModel,
  runningModelDetectionIds,
  startModelDetection,
  stopModelDetection,
  subscribeModelDetection
} from './modelDetectionController'
import { useModelDetection } from './useModelDetection'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

type Deferred = { runId: string; resolve: (acceptance: { accepted: boolean; total: number }) => void }

function installPlatform(): {
  detectModels: ReturnType<typeof vi.fn>
  cancelModelDetection: ReturnType<typeof vi.fn>
  emitProgress: (result: ModelDetectionResult) => void
  emitDone: (runId: string, stopped: boolean) => void
  deferred: Deferred[]
} {
  const progressListeners = new Set<(result: ModelDetectionResult) => void>()
  const doneListeners = new Set<(runId: string, payload: { stopped: boolean }) => void>()
  const deferred: Deferred[] = []
  const detectModels = vi.fn((_providerId: string, options: { runId: string }) =>
    new Promise<{ accepted: boolean; total: number }>((resolve) => {
      deferred.push({ runId: options.runId, resolve })
    }))
  const cancelModelDetection = vi.fn(async () => undefined)
  Object.defineProperty(window, 'platform', {
    configurable: true,
    value: {
      modelProviders: {
        detectModels,
        cancelModelDetection,
        onModelDetectionProgress: (listener: (result: ModelDetectionResult) => void) => {
          progressListeners.add(listener)
          return () => progressListeners.delete(listener)
        },
        onModelDetectionDone: (listener: (runId: string, payload: { stopped: boolean }) => void) => {
          doneListeners.add(listener)
          return () => doneListeners.delete(listener)
        }
      }
    }
  })
  return {
    detectModels,
    cancelModelDetection,
    deferred,
    emitProgress: (result) => progressListeners.forEach((listener) => listener(result)),
    emitDone: (runId, stopped) => doneListeners.forEach((listener) => listener(runId, { stopped }))
  }
}

function result(overrides: Partial<ModelDetectionResult> & { runId: string; modelId: string }): ModelDetectionResult {
  return { status: 'ok', ...overrides } as ModelDetectionResult
}

afterEach(() => {
  resetModelDetectionControllerForTests()
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
})

describe('PLAT-82 model detection controller (memory only)', () => {
  it('collects per-model results from progress events and marks the run finished', async () => {
    const api = installPlatform()
    const starting = startModelDetection('lanyun', ['connectivity'])
    const runId = api.deferred[0]!.runId
    api.deferred[0]!.resolve({ accepted: true, total: 2 })
    await expect(starting).resolves.toBe(runId)

    expect(isDetectionRunning(getModelDetectionSnapshot(), 'lanyun')).toBe(true)
    api.emitProgress(result({ runId, modelId: 'm-1' }))
    api.emitProgress(result({ runId, modelId: 'm-2', status: 'failed', reasonCode: 'timeout' }))
    api.emitDone(runId, false)

    const snapshot = getModelDetectionSnapshot()
    expect(isDetectionRunning(snapshot, 'lanyun')).toBe(false)
    expect(resultForModel(snapshot, 'lanyun', 'm-1')).toMatchObject({ status: 'ok' })
    expect(resultForModel(snapshot, 'lanyun', 'm-2')).toMatchObject({ status: 'failed', reasonCode: 'timeout' })
    expect(snapshot.runs[runId]?.total).toBe(2)
    expect(runningModelDetectionIds(snapshot)).toEqual([])
  })

  it('keeps running when the provider view is left and only cancels on stop()', async () => {
    const api = installPlatform()
    const starting = startModelDetection('lanyun', ['connectivity', 'protocol'])
    const runId = api.deferred[0]!.runId
    api.deferred[0]!.resolve({ accepted: true, total: 3 })
    await starting

    // 切页 / 切供应商 / 关弹窗都只是不再渲染 —— controller 不受影响。
    const snapshot = getModelDetectionSnapshot()
    expect(runningModelDetectionIds(snapshot)).toEqual([runId])
    expect(api.cancelModelDetection).not.toHaveBeenCalled()

    stopModelDetection()
    expect(api.cancelModelDetection).toHaveBeenCalledTimes(1)
    expect(api.cancelModelDetection).toHaveBeenCalledWith(runId)
    // 幂等：第二次不再重复取消。
    stopModelDetection(runId)
    expect(api.cancelModelDetection).toHaveBeenCalledTimes(1)
  })

  it('ignores results from unknown runs and resets cleanly', async () => {
    const api = installPlatform()
    api.emitProgress(result({ runId: 'unknown-run', modelId: 'm-1' }))
    expect(getModelDetectionSnapshot().runs).toEqual({})

    const starting = startModelDetection('deepseek', ['connectivity'])
    const runId = api.deferred[0]!.runId
    api.deferred[0]!.resolve({ accepted: false, total: 0 })
    await expect(starting).resolves.toBeNull()
    expect(getModelDetectionSnapshot().runs).toEqual({})

    const accepted = startModelDetection('deepseek', ['connectivity'])
    api.deferred[1]!.resolve({ accepted: true, total: 1 })
    await accepted
    expect(Object.keys(getModelDetectionSnapshot().runs)).toHaveLength(1)
    resetModelDetectionControllerForTests()
    expect(getModelDetectionSnapshot().runs).toEqual({})
    expect(getModelDetectionSnapshot().version).toBe(1)
    void runId
  })

  it('reads the newest run so a re-detection replaces the previous conclusion', async () => {
    const api = installPlatform()
    const first = startModelDetection('lanyun', ['connectivity'])
    const firstRun = api.deferred[0]!.runId
    api.deferred[0]!.resolve({ accepted: true, total: 1 })
    await first
    api.emitProgress(result({ runId: firstRun, modelId: 'm-1', status: 'failed', reasonCode: 'timeout' }))
    api.emitDone(firstRun, false)
    expect(resultForModel(getModelDetectionSnapshot(), 'lanyun', 'm-1')).toMatchObject({ status: 'failed' })

    // 第二轮还在跑、该模型还没有结论 ⇒ 「测试中」，不返回上一轮的 failed 明细。
    const second = startModelDetection('lanyun', ['connectivity'])
    const secondRun = api.deferred[1]!.runId
    api.deferred[1]!.resolve({ accepted: true, total: 1 })
    await second
    expect(resultForModel(getModelDetectionSnapshot(), 'lanyun', 'm-1')).toBeUndefined()

    api.emitProgress(result({ runId: secondRun, modelId: 'm-1' }))
    api.emitDone(secondRun, false)
    expect(resultForModel(getModelDetectionSnapshot(), 'lanyun', 'm-1')).toMatchObject({ status: 'ok' })
  })

  it('exposes a stable read-only view through the hook', async () => {
    const api = installPlatform()
    const seen: Array<{ status: string | undefined; running: boolean }> = []
    function Probe(): null {
      const detection = useModelDetection('lanyun')
      seen.push({ status: detection.statusFor('m-1'), running: detection.running })
      return null
    }

    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(<Probe />)
    })

    const starting = startModelDetection('lanyun', ['connectivity'])
    const runId = api.deferred[0]!.runId
    await act(async () => {
      api.deferred[0]!.resolve({ accepted: true, total: 1 })
      await starting
    })
    const beforeResult = seen.at(-1)
    expect(beforeResult?.running).toBe(true)
    // 没有结果但 run 在跑 ⇒ 测试中。
    expect(beforeResult?.status).toBe('testing')

    await act(async () => {
      api.emitProgress(result({ runId, modelId: 'm-1' }))
    })
    expect(seen.at(-1)?.status).toBe('ok')
    await act(async () => {
      root.unmount()
    })
  })
})
