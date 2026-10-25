import { describe, expect, it, vi } from 'vitest'

import type { ModelDefinition, ModelProvider } from '../../ai/providers/modelProviderTypes'
import { createModelProviderDetectionService } from './modelProviderDetectionService'

/**
 * PLAT-82 runId 生命周期（设计 §6/§8.20）：
 *  - 重复 runId ⇒ `{ accepted: false }`，不打断已在跑的 run；
 *  - done 之后从 Map 删除（同一 runId 可复用）；
 *  - cancel 未知 runId 幂等成功；
 *  - 结果只经回调外发，不写任何存储。
 */
function provider(): ModelProvider {
  return {
    id: 'acme',
    name: 'Acme',
    endpoints: [
      { protocol: 'chat-completions', baseUrl: 'https://api.example.test' }
    ],
    enabled: true,
    baseUrl: 'https://api.example.test',
    apiKey: 'sk-test',
    models: []
  }
}

function chatModel(id: string): ModelDefinition {
  return { id, name: id, capabilities: { chat: true }, chatProtocol: 'chat-completions' }
}

function deferredFetch() {
  const pending: Array<() => void> = []
  const fetchImpl = vi.fn(async () => {
    await new Promise<void>((resolve) => pending.push(resolve))
    return new Response('{}', { status: 200 })
  }) as unknown as typeof fetch
  return { fetchImpl, releaseAll: () => { for (const resolve of pending.splice(0)) resolve() } }
}

describe('PLAT-82 model provider detection service', () => {
  it('rejects a duplicate runId, then accepts it again once the run finished', async () => {
    const { fetchImpl, releaseAll } = deferredFetch()
    const progress = vi.fn()
    const done = vi.fn()
    const service = createModelProviderDetectionService({
      resolveProvider: async () => ({ ...provider(), models: [chatModel('a'), chatModel('b')] }),
      fetch: () => fetchImpl,
      onProgress: progress,
      onDone: done
    })

    await expect(service.detectModels('acme', { modes: ['connectivity'], runId: 'run-1' }))
      .resolves.toEqual({ accepted: true, total: 2 })
    await expect(service.detectModels('acme', { modes: ['connectivity'], runId: 'run-1' }))
      .resolves.toEqual({ accepted: false, total: 0 })
    expect(service.runningRunIds()).toEqual(['run-1'])

    releaseAll()
    await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(1))
    expect(done).toHaveBeenCalledWith('run-1', { stopped: false })
    expect(progress).toHaveBeenCalledTimes(2)
    // done 之后 runId 从 Map 删除 ⇒ 可以复用。
    expect(service.runningRunIds()).toEqual([])
    await expect(service.detectModels('acme', { modes: ['connectivity'], runId: 'run-1' }))
      .resolves.toMatchObject({ accepted: true })
    releaseAll()
  })

  it('cancels a known run and treats an unknown runId as a no-op', async () => {
    const { fetchImpl, releaseAll } = deferredFetch()
    const done = vi.fn()
    const service = createModelProviderDetectionService({
      resolveProvider: async () => ({ ...provider(), models: [chatModel('a')] }),
      fetch: () => fetchImpl,
      onProgress: vi.fn(),
      onDone: done
    })

    // 未知 runId：幂等成功（不抛错）。
    expect(() => service.cancelModelDetection('nope')).not.toThrow()

    await service.detectModels('acme', { modes: ['connectivity'], runId: 'run-2' })
    service.cancelModelDetection('run-2')
    releaseAll()
    await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(1))
    expect(done).toHaveBeenCalledWith('run-2', { stopped: true })
    expect(service.runningRunIds()).toEqual([])
  })

  it('persists the protocols that passed, in a single write, before done', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith('/messages')
        ? new Response('{"error":"messages not supported"}', { status: 404 })
        : new Response('{}', { status: 200 })) as unknown as typeof fetch
    const done = vi.fn()
    const recordProbedProtocols = vi.fn(async () => undefined)
    const service = createModelProviderDetectionService({
      resolveProvider: async () => ({
        ...provider(),
        endpoints: [
          { protocol: 'chat-completions', baseUrl: 'https://api.example.test' },
          { protocol: 'messages', baseUrl: 'https://api.example.test/anthropic' }
        ],
        models: [chatModel('a')]
      }),
      fetch: () => fetchImpl,
      onProgress: vi.fn(),
      onDone: done,
      recordProbedProtocols
    })

    await service.detectModels('acme', { modes: ['connectivity', 'protocol'], runId: 'run-write' })
    await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(1))

    // 只有实测通过的协议进写库素材（chat/completions）；失败的 messages 不写负结论。
    expect(recordProbedProtocols).toHaveBeenCalledTimes(1)
    expect(recordProbedProtocols).toHaveBeenCalledWith('acme', [
      { modelId: 'a', protocols: ['chat-completions'] }
    ])
    // 写库在 done 之前完成 ⇒ 渲染层收到 done 后刷新列表就能看到新证据。
    expect(recordProbedProtocols.mock.invocationCallOrder[0])
      .toBeLessThan(done.mock.invocationCallOrder[0] as number)
  })

  it('still reports done when persisting the probe evidence fails', async () => {
    const done = vi.fn()
    const service = createModelProviderDetectionService({
      resolveProvider: async () => ({ ...provider(), models: [chatModel('a')] }),
      fetch: () => (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
      onProgress: vi.fn(),
      onDone: done,
      recordProbedProtocols: async () => { throw new Error('provider-secret-metadata-write-failed') }
    })

    await service.detectModels('acme', { modes: ['protocol'], runId: 'run-write-fail' })
    await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(1))
    expect(done).toHaveBeenCalledWith('run-write-fail', { stopped: false })
    // 失败不影响排队：runId 照常释放。
    expect(service.runningRunIds()).toEqual([])
  })

  it('skips the write when nothing passed', async () => {
    const recordProbedProtocols = vi.fn(async () => undefined)
    const service = createModelProviderDetectionService({
      resolveProvider: async () => ({
        ...provider(),
        endpoints: [{ protocol: 'messages', baseUrl: 'https://api.example.test/anthropic' }],
        models: [chatModel('a')]
      }),
      fetch: () => (async () => new Response('{"error":"messages not supported"}', { status: 404 })) as unknown as typeof fetch,
      onProgress: vi.fn(),
      onDone: vi.fn(),
      recordProbedProtocols
    })

    await service.detectModels('acme', { modes: ['protocol'], runId: 'run-nothing' })
    await vi.waitFor(() => expect(service.runningRunIds()).toEqual([]))
    expect(recordProbedProtocols).not.toHaveBeenCalled()
  })

  it('probes only the requested model ids and records availability before done', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string }
      return body.model === 'b'
        ? new Response('{"error":"invalid key"}', { status: 401 })
        : new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    const done = vi.fn()
    const recordModelAvailability = vi.fn(async () => undefined)
    const service = createModelProviderDetectionService({
      resolveProvider: async () => ({ ...provider(), models: [chatModel('a'), chatModel('b'), chatModel('c')] }),
      fetch: () => fetchImpl,
      onProgress: vi.fn(),
      onDone: done,
      recordModelAvailability
    })

    await expect(service.detectModels('acme', {
      modes: ['connectivity'],
      runId: 'run-ids',
      modelIds: ['c', 'b']
    })).resolves.toEqual({ accepted: true, total: 2 })
    await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(1))

    // 只发两次请求（a 不在名单里），且顺序仍按供应商模型顺序。
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(recordModelAvailability).toHaveBeenCalledTimes(1)
    const [providerId, updates, checkedAt] = recordModelAvailability.mock.calls[0] as unknown as [
      string,
      Array<{ modelId: string; status: string; reasonCode?: string }>,
      string
    ]
    expect(providerId).toBe('acme')
    // 结果按完成顺序上报（并发 5），这里只断言集合与条数。
    expect(updates).toHaveLength(2)
    expect(updates).toEqual(expect.arrayContaining([
      { modelId: 'b', status: 'failed', reasonCode: 'http_401' },
      { modelId: 'c', status: 'ok' }
    ]))
    expect(new Date(checkedAt).toString()).not.toBe('Invalid Date')
    expect(recordModelAvailability.mock.invocationCallOrder[0])
      .toBeLessThan(done.mock.invocationCallOrder[0] as number)
  })

  it('treats an empty model id list as "nothing to probe"', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch
    const done = vi.fn()
    const recordModelAvailability = vi.fn(async () => undefined)
    const service = createModelProviderDetectionService({
      resolveProvider: async () => ({ ...provider(), models: [chatModel('a')] }),
      fetch: () => fetchImpl,
      onProgress: vi.fn(),
      onDone: done,
      recordModelAvailability
    })

    await expect(service.detectModels('acme', {
      modes: ['connectivity'],
      runId: 'run-empty',
      modelIds: []
    })).resolves.toEqual({ accepted: true, total: 0 })
    await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(1))
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(recordModelAvailability).not.toHaveBeenCalled()
  })

  it('does not record skipped results (disabled provider)', async () => {
    const recordModelAvailability = vi.fn(async () => undefined)
    const service = createModelProviderDetectionService({
      resolveProvider: async () => ({ ...provider(), enabled: false, models: [chatModel('a')] }),
      fetch: () => (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
      onProgress: vi.fn(),
      onDone: vi.fn(),
      recordModelAvailability
    })

    await service.detectModels('acme', { modes: ['connectivity'], runId: 'run-disabled' })
    await vi.waitFor(() => expect(service.runningRunIds()).toEqual([]))
    expect(recordModelAvailability).not.toHaveBeenCalled()
  })

  it('requires at least one mode and a runId', async () => {
    const service = createModelProviderDetectionService({
      resolveProvider: async (providerId: string) => (providerId === 'acme' ? provider() : undefined),
      fetch: () => (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
      onProgress: vi.fn(),
      onDone: vi.fn()
    })

    await expect(service.detectModels('acme', { modes: [], runId: 'run-3' }))
      .rejects.toThrow('At least one detection mode is required.')
    await expect(service.detectModels('acme', { modes: ['connectivity'], runId: '  ' }))
      .rejects.toThrow('runId is required.')
    await expect(service.detectModels('missing', { modes: ['connectivity'], runId: 'run-4' }))
      .rejects.toThrow('Provider "missing" was not found.')
  })
})
