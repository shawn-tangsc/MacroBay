import { beforeEach, describe, expect, it, vi } from 'vitest'

import { IpcChannels } from '../ipc/channels'

const invoke = vi.fn()
const exposeInMainWorld = vi.fn()
const on = vi.fn()
const removeListener = vi.fn()

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld
  },
  ipcRenderer: {
    invoke,
    on,
    removeListener
  }
}))

describe('desktop preload platform api', () => {
  it('exposes narrow channel management methods without credential read APIs', async () => {
    await import('./index')
    const api = exposeInMainWorld.mock.calls[0]?.[1] as { channels: Record<string, unknown> }

    expect(typeof api.channels.beginCredential).toBe('function')
    expect(typeof api.channels.submitCredential).toBe('function')
    expect(typeof api.channels.runtimeStatus).toBe('function')
    expect(Object.keys(api.channels)).not.toEqual(expect.arrayContaining(['getCredential', 'readVault', 'listVault']))
  })

  beforeEach(() => {
    vi.resetModules()
    invoke.mockReset()
    exposeInMainWorld.mockReset()
    on.mockReset()
    removeListener.mockReset()
  })

  it('exposes read-only jobs query methods', async () => {
    invoke
      .mockResolvedValueOnce({ id: 'run-1' })
      .mockResolvedValueOnce({ runs: [], nextCursor: null })
      .mockResolvedValueOnce([{ id: 'job-1', registered: true }])

    await import('./index')
    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      jobs: {
        getRun: (runId: string) => Promise<unknown>
        listRunPage: (query?: unknown) => Promise<unknown>
        listSchedules: () => Promise<unknown>
      }
    }

    await expect(api.jobs.getRun('run-1')).resolves.toEqual({ id: 'run-1' })
    await expect(api.jobs.listRunPage({ owner: 'platform', limit: 10 })).resolves.toEqual({
      runs: [],
      nextCursor: null
    })
    await expect(api.jobs.listSchedules()).resolves.toEqual([{ id: 'job-1', registered: true }])
    expect(invoke).toHaveBeenNthCalledWith(1, IpcChannels.jobsGetRun, 'run-1')
    expect(invoke).toHaveBeenNthCalledWith(2, IpcChannels.jobsListRunPage, { owner: 'platform', limit: 10 })
    expect(invoke).toHaveBeenNthCalledWith(3, IpcChannels.jobsListSchedules)
  })

  it('exposes exactly the three read-only job query methods and no write entry', async () => {
    await import('./index')
    const api = exposeInMainWorld.mock.calls[0]?.[1] as { jobs: Record<string, unknown> }

    expect(typeof api.jobs.listSchedules).toBe('function')
    expect(Object.keys(api.jobs).sort()).toEqual(['getRun', 'listRunPage', 'listSchedules'])
  })

  it('exposes web search methods without raw credential APIs', async () => {
    invoke.mockResolvedValueOnce([{ id: 'fetch' }])

    await import('./index')
    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      webSearch: {
        listProviders: () => Promise<unknown>
        getSettings: () => Promise<unknown>
        updateSettings: (patch: unknown) => Promise<unknown>
        updateProvider: (input: unknown) => Promise<unknown>
        revealApiKey: (providerId: unknown) => Promise<unknown>
        checkProvider: (input: unknown) => Promise<unknown>
        searchKeywords: (input: unknown) => Promise<unknown>
        fetchUrls: (input: unknown) => Promise<unknown>
        getProviderSecrets?: unknown
      }
    }

    await expect(api.webSearch.listProviders()).resolves.toEqual([{ id: 'fetch' }])
    expect(api.webSearch.getProviderSecrets).toBeUndefined()
    expect(Object.keys(api.webSearch)).not.toContain('getProviderSecrets')
    // 精确面：+1 revealApiKey，其余 web search 方法一个不少。
    expect(Object.keys(api.webSearch).sort()).toEqual([
      'checkProvider',
      'fetchUrls',
      'getSettings',
      'listProviders',
      'revealApiKey',
      'searchKeywords',
      'updateProvider',
      'updateSettings'
    ])
    invoke.mockResolvedValueOnce({ apiKey: 'tvly-secret' })
    await expect(api.webSearch.revealApiKey('tavily')).resolves.toEqual({ apiKey: 'tvly-secret' })
    expect(invoke).toHaveBeenCalledWith(IpcChannels.webSearchRevealProviderApiKey, 'tavily')
    expect(invoke).toHaveBeenCalledWith(IpcChannels.webSearchListProviders)
  })

  it('exposes storage and cache methods through the preload bridge', async () => {
    invoke
      .mockResolvedValueOnce([{ cacheId: 'platform.agent-runtime-compatibility' }])
      .mockResolvedValueOnce({ cacheId: 'platform.agent-runtime-compatibility', status: 'ready' })
      .mockResolvedValueOnce({ status: 'succeeded' })
      .mockResolvedValueOnce({ status: 'succeeded' })
      .mockResolvedValueOnce({ records: [], nextCursor: null })

    await import('./index')
    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      storage: {
        listCaches: () => Promise<unknown>
        inspectCache: (cacheId: string) => Promise<unknown>
        clearCache: (input: unknown) => Promise<unknown>
        compactCache: (input: unknown) => Promise<unknown>
        listCacheOperations: (query?: unknown) => Promise<unknown>
      }
    }

    await expect(api.storage.listCaches()).resolves.toEqual([{ cacheId: 'platform.agent-runtime-compatibility' }])
    await expect(api.storage.inspectCache('platform.agent-runtime-compatibility')).resolves.toEqual({
      cacheId: 'platform.agent-runtime-compatibility',
      status: 'ready'
    })
    await expect(api.storage.clearCache({ cacheId: 'platform.agent-runtime-compatibility', dryRun: true })).resolves.toEqual({
      status: 'succeeded'
    })
    await expect(api.storage.compactCache({ cacheId: 'market-intelligence.translation-records' })).resolves.toEqual({
      status: 'succeeded'
    })
    await expect(api.storage.listCacheOperations({ limit: 20 })).resolves.toEqual({
      records: [],
      nextCursor: null
    })

    expect(invoke).toHaveBeenNthCalledWith(1, IpcChannels.storageListCaches)
    expect(invoke).toHaveBeenNthCalledWith(2, IpcChannels.storageInspectCache, 'platform.agent-runtime-compatibility')
    expect(invoke).toHaveBeenNthCalledWith(3, IpcChannels.storageClearCache, {
      cacheId: 'platform.agent-runtime-compatibility',
      dryRun: true
    })
    expect(invoke).toHaveBeenNthCalledWith(4, IpcChannels.storageCompactCache, {
      cacheId: 'market-intelligence.translation-records'
    })
    expect(invoke).toHaveBeenNthCalledWith(5, IpcChannels.storageListCacheOperations, { limit: 20 })
  })

  it('exposes the generic open-file-with-app shell method', async () => {
    invoke.mockResolvedValueOnce({ ok: true })

    await import('./index')
    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      app: {
        openFileWithApp: (request: unknown) => Promise<unknown>
      }
    }

    const request = { targetId: 'cursor', filePath: '/Users/demo/project/hello.py' }
    await expect(api.app.openFileWithApp(request)).resolves.toEqual({ ok: true })
    expect(invoke).toHaveBeenCalledWith(IpcChannels.shellOpenFileWithApp, request)
  })

  it('exposes agent channel runtime query methods', async () => {
    invoke.mockResolvedValueOnce({ channels: [{ channelId: 'channel-1' }] })

    await import('./index')
    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      agents: {
        getChannelRuntimeSnapshot: (query?: unknown) => Promise<unknown>
      }
    }

    await expect(api.agents.getChannelRuntimeSnapshot({ includeDiagnostics: true })).resolves.toEqual({
      channels: [{ channelId: 'channel-1' }]
    })
    expect(invoke).toHaveBeenCalledWith(IpcChannels.agentsGetChannelRuntimeSnapshot, {
      includeDiagnostics: true
    })
  })

  it('exposes agent runtime compatibility and gateway status methods', async () => {
    invoke
      .mockResolvedValueOnce({ selectable: false, status: 'auth-failed' })
      .mockResolvedValueOnce({ selectable: true, status: 'ready' })
      .mockResolvedValueOnce({ enabled: false, state: 'disabled' })
      .mockResolvedValueOnce({ ok: true, snapshot: { enabled: true, state: 'running' } })
      .mockResolvedValueOnce({ ok: true, snapshot: { enabled: true, state: 'stopped' } })
      .mockResolvedValueOnce({ enabled: true, state: 'stopped' })

    await import('./index')
    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      agents: {
        getRuntimeCompatibility: (providerId: string, modelId: string, runtimeId: string) => Promise<unknown>
        probeRuntimeCompatibility: (providerId: string, modelId: string, runtimeId: string) => Promise<unknown>
        getModelGatewayStatus: () => Promise<unknown>
        startModelGateway: (providerId?: string, modelId?: string) => Promise<unknown>
        stopModelGateway: () => Promise<unknown>
        setModelGatewayEnabled: (enabled: boolean) => Promise<unknown>
      }
    }

    await expect(api.agents.getRuntimeCompatibility('deepseek', 'deepseek-chat', 'claude-code')).resolves.toEqual({
      selectable: false,
      status: 'auth-failed'
    })
    await expect(api.agents.probeRuntimeCompatibility('deepseek', 'deepseek-chat', 'claude-code')).resolves.toEqual({
      selectable: true,
      status: 'ready'
    })
    await expect(api.agents.getModelGatewayStatus()).resolves.toEqual({ enabled: false, state: 'disabled' })
    await expect(api.agents.startModelGateway('deepseek', 'deepseek-chat')).resolves.toEqual({
      ok: true,
      snapshot: { enabled: true, state: 'running' }
    })
    await expect(api.agents.stopModelGateway()).resolves.toEqual({
      ok: true,
      snapshot: { enabled: true, state: 'stopped' }
    })
    await expect(api.agents.setModelGatewayEnabled(true)).resolves.toEqual({ enabled: true, state: 'stopped' })

    expect(invoke).toHaveBeenNthCalledWith(
      1,
      IpcChannels.agentsGetRuntimeCompatibility,
      'deepseek',
      'deepseek-chat',
      'claude-code'
    )
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      IpcChannels.agentsProbeRuntimeCompatibility,
      'deepseek',
      'deepseek-chat',
      'claude-code'
    )
    expect(invoke).toHaveBeenNthCalledWith(3, IpcChannels.agentsGetModelGatewayStatus)
    expect(invoke).toHaveBeenNthCalledWith(4, IpcChannels.agentsStartModelGateway, 'deepseek', 'deepseek-chat')
    expect(invoke).toHaveBeenNthCalledWith(5, IpcChannels.agentsStopModelGateway)
    expect(invoke).toHaveBeenNthCalledWith(6, IpcChannels.agentsSetModelGatewayEnabled, true)
  })

  it('exposes channel runtime restart method', async () => {
    invoke.mockResolvedValueOnce({ channels: [{ channelId: 'channel-1', runtimeState: 'connecting' }] })

    await import('./index')
    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      agents: {
        restartChannelRuntime: (channelId: string) => Promise<unknown>
      }
    }

    await expect(api.agents.restartChannelRuntime('channel-1')).resolves.toEqual({
      channels: [{ channelId: 'channel-1', runtimeState: 'connecting' }]
    })
    expect(invoke).toHaveBeenCalledWith(IpcChannels.agentsRestartChannelRuntime, 'channel-1')
  })

  it('exposes read-only agent task query methods', async () => {
    invoke.mockResolvedValueOnce({ ok: true, data: { tasks: [{ id: 'task-1' }], total: 1 } }).mockResolvedValueOnce({
      ok: true, data: { logs: [{ id: 'task-run-1' }], total: 1 }
    })

    await import('./index')
    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      agents: {
        listTasks: (agentId: string, query?: unknown) => Promise<unknown>
        getTaskLogs: (agentId: string, taskId: string, query?: unknown) => Promise<unknown>
      }
    }

    await expect(api.agents.listTasks('agent-1', { limit: 10 })).resolves.toEqual({
      tasks: [{ id: 'task-1' }],
      total: 1
    })
    await expect(api.agents.getTaskLogs('agent-1', 'task-1', { limit: 5 })).resolves.toEqual({
      logs: [{ id: 'task-run-1' }],
      total: 1
    })
    expect(invoke).toHaveBeenNthCalledWith(1, IpcChannels.agentsListTasks, 'agent-1', { limit: 10 })
    expect(invoke).toHaveBeenNthCalledWith(2, IpcChannels.agentsGetTaskLogs, 'agent-1', 'task-1', { limit: 5 })
  })

  it('exposes bounded task automation page, audit, delivery, and policy methods', async () => {
    invoke
      .mockResolvedValueOnce({ ok: true, data: { ok: true, nextRunAt: '2026-07-16T01:00:00.000Z' } })
      .mockResolvedValueOnce({ ok: true, data: { tasks: [], total: 0 } })
      .mockResolvedValueOnce({ ok: true, data: { attempts: [], total: 0 } })
      .mockResolvedValueOnce({ ok: true, data: { audits: [], total: 0 } })
      .mockResolvedValueOnce({ ok: true, data: { preset: 'balanced' } })
      .mockResolvedValueOnce({ ok: true, data: { preset: 'conservative' } })
      .mockResolvedValueOnce({ ok: true, data: [{ channelId: 'channel-1', status: 'ready' }] })
      .mockResolvedValueOnce({ ok: true, data: { delivered: 1, failed: 0, skipped: 0, unknown: 0 } })

    await import('./index')
    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      agents: {
        previewTaskSchedule: (input: unknown) => Promise<unknown>
        listTaskPage: (query?: unknown) => Promise<unknown>
        getTaskDeliveryAttempts: (agentId: string, runLogId: string, query?: unknown) => Promise<unknown>
        listTaskMutationAudits: (query: unknown) => Promise<unknown>
        getTaskAutomationPolicy: () => Promise<unknown>
        updateTaskAutomationPolicy: (input: unknown) => Promise<unknown>
        getTaskDeliveryReadiness: (agentId: string, taskId: string) => Promise<unknown>
        retryTaskDelivery: (agentId: string, runLogId: string, attemptId: string) => Promise<unknown>
      }
    }

    await api.agents.previewTaskSchedule({ trigger: { kind: 'cron', expr: '0 9 * * *' } })
    await api.agents.listTaskPage({ limit: 10 })
    await api.agents.getTaskDeliveryAttempts('agent-1', 'run-1', { limit: 10, offset: 0 })
    await api.agents.listTaskMutationAudits({ agentId: 'agent-1', limit: 10, offset: 0 })
    await api.agents.getTaskAutomationPolicy()
    await api.agents.updateTaskAutomationPolicy({ policyPreset: 'conservative' })
    await api.agents.getTaskDeliveryReadiness('agent-1', 'task-1')
    await expect(api.agents.retryTaskDelivery('agent-1', 'run-1', 'attempt-1')).resolves.toEqual({
      delivered: 1,
      failed: 0,
      skipped: 0,
      unknown: 0
    })

    expect(invoke).toHaveBeenNthCalledWith(1, IpcChannels.agentsPreviewTaskSchedule, { trigger: { kind: 'cron', expr: '0 9 * * *' } })
    expect(invoke).toHaveBeenNthCalledWith(2, IpcChannels.agentsListTaskPage, { limit: 10 })
    expect(invoke).toHaveBeenNthCalledWith(3, IpcChannels.agentsGetTaskDeliveryAttempts, 'agent-1', 'run-1', { limit: 10, offset: 0 })
    expect(invoke).toHaveBeenNthCalledWith(4, IpcChannels.agentsListTaskMutationAudits, { agentId: 'agent-1', limit: 10, offset: 0 })
    expect(invoke).toHaveBeenNthCalledWith(5, IpcChannels.agentsGetTaskAutomationPolicy)
    expect(invoke).toHaveBeenNthCalledWith(6, IpcChannels.agentsUpdateTaskAutomationPolicy, { policyPreset: 'conservative' })
    expect(invoke).toHaveBeenNthCalledWith(7, IpcChannels.agentsGetTaskDeliveryReadiness, 'agent-1', 'task-1')
    expect(invoke).toHaveBeenNthCalledWith(8, IpcChannels.agentsRetryTaskDelivery, 'agent-1', 'run-1', 'attempt-1')
  })

  it('exposes agent skill runtime query methods', async () => {
    invoke.mockResolvedValueOnce({
      agentId: 'agent-1',
      skills: [{ skillId: 'skill-1', runtimeTools: [{ toolName: 'Read Docs', toolId: 'skill__code-reader__read-docs' }] }]
    })

    await import('./index')
    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      agents: {
        skills: {
          getRuntime: (agentId: string) => Promise<unknown>
        }
      }
    }

    await expect(api.agents.skills.getRuntime('agent-1')).resolves.toEqual({
      agentId: 'agent-1',
      skills: [{ skillId: 'skill-1', runtimeTools: [{ toolName: 'Read Docs', toolId: 'skill__code-reader__read-docs' }] }]
    })
    expect(invoke).toHaveBeenCalledWith(IpcChannels.agentsSkillsGetRuntime, 'agent-1')
  })

  it('exposes agent task write methods', async () => {
    invoke
      .mockResolvedValueOnce({ ok: true, data: { id: 'task-1', name: 'Created' } })
      .mockResolvedValueOnce({ ok: true, data: { id: 'task-1', name: 'Updated' } })
      .mockResolvedValueOnce({ ok: true, data: true })

    await import('./index')
    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      agents: {
        createTask: (agentId: string, input: unknown) => Promise<unknown>
        updateTask: (agentId: string, taskId: string, request: unknown) => Promise<unknown>
        deleteTask: (agentId: string, taskId: string, request: unknown) => Promise<unknown>
      }
    }

    await expect(api.agents.createTask('agent-1', { name: 'Created' })).resolves.toEqual({
      id: 'task-1',
      name: 'Created'
    })
    await expect(api.agents.updateTask('agent-1', 'task-1', { expectedRevision: 2, patch: { name: 'Updated' } })).resolves.toEqual({
      id: 'task-1',
      name: 'Updated'
    })
    await expect(api.agents.deleteTask('agent-1', 'task-1', { expectedRevision: 3 })).resolves.toBe(true)
    expect(invoke).toHaveBeenNthCalledWith(1, IpcChannels.agentsCreateTask, 'agent-1', { name: 'Created' })
    expect(invoke).toHaveBeenNthCalledWith(2, IpcChannels.agentsUpdateTask, 'agent-1', 'task-1', {
      expectedRevision: 2,
      patch: { name: 'Updated' }
    })
    expect(invoke).toHaveBeenNthCalledWith(3, IpcChannels.agentsDeleteTask, 'agent-1', 'task-1', { expectedRevision: 3 })
  })

  it('exposes manual agent task run method', async () => {
    invoke.mockResolvedValueOnce({ ok: true, data: { taskId: 'task-1', runLogId: 'task-run-1' } })

    await import('./index')
    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      agents: {
        runTask: (agentId: string, taskId: string, request: unknown) => Promise<unknown>
      }
    }

    await expect(api.agents.runTask('agent-1', 'task-1', { expectedRevision: 4 })).resolves.toEqual({
      taskId: 'task-1',
      runLogId: 'task-run-1'
    })
    expect(invoke).toHaveBeenCalledWith(IpcChannels.agentsRunTask, 'agent-1', 'task-1', { expectedRevision: 4 })
  })

  it('exposes manual agent task cancel method', async () => {
    invoke.mockResolvedValueOnce({ ok: true, data: { runLogId: 'task-run-1', jobRunId: 'run-1', cancelled: true } })

    await import('./index')
    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      agents: {
        cancelTaskRun: (runLogId: string) => Promise<unknown>
      }
    }

    await expect(api.agents.cancelTaskRun('task-run-1')).resolves.toEqual({
      runLogId: 'task-run-1',
      jobRunId: 'run-1',
      cancelled: true
    })
    expect(invoke).toHaveBeenCalledWith(IpcChannels.agentsCancelTaskRun, 'task-run-1')
  })

  it('unwraps allowlisted task IPC failures into stable renderer error codes', async () => {
    invoke
      .mockResolvedValueOnce({ ok: false, error: { code: 'task-revision-conflict' } })
      .mockResolvedValueOnce({ ok: false, error: { code: 'task-request-invalid' } })
      .mockResolvedValueOnce({ ok: false, error: { code: 'task-not-runnable' } })
    await import('./index')
    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      agents: { updateTask: Function; listTaskPage: Function; runTask: Function }
    }
    await expect(api.agents.updateTask('agent-1', 'task-1', { expectedRevision: 1, patch: {} })).rejects.toMatchObject({
      code: 'task-revision-conflict'
    })
    await expect(api.agents.listTaskPage({ cursor: 'bad' })).rejects.toMatchObject({ code: 'task-request-invalid' })
    await expect(api.agents.runTask('agent-1', 'task-1', { expectedRevision: 1 })).rejects.toMatchObject({
      code: 'task-not-runnable'
    })
  })

  it('recovers policy updates after an internal-error envelope without exposing persistence details', async () => {
    invoke.mockResolvedValueOnce({ ok: false, error: { code: 'task-internal-error' } }).mockResolvedValueOnce({ ok: true, data: { preset: 'conservative' } })
    await import('./index')
    const api = exposeInMainWorld.mock.calls[0]?.[1] as { agents: { updateTaskAutomationPolicy: (input: unknown) => Promise<unknown> } }
    await expect(api.agents.updateTaskAutomationPolicy({ policyPreset: 'conservative' })).rejects.toMatchObject({ code: 'task-internal-error' })
    await expect(api.agents.updateTaskAutomationPolicy({ policyPreset: 'conservative' })).resolves.toEqual({ preset: 'conservative' })
  })

  it('exposes provider runtime check methods', async () => {
    invoke
      .mockResolvedValueOnce({
        providerId: 'anthropic',
        modelId: 'claude-sonnet',
        finalCompatibility: { selectable: false, status: 'auth-failed' }
      })
      .mockResolvedValueOnce({
        providerId: 'anthropic',
        modelId: 'claude-sonnet',
        finalCompatibility: { selectable: true, status: 'ready' }
      })

    await import('./index')
    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      modelProviders: {
        runRuntimeChecks: (
          providerId: string,
          options?: { modelId?: string; apiKey?: string; runtimeId?: string; checkGateway?: boolean }
        ) => Promise<unknown>
        getRuntimeCheckReport: (providerId: string, modelId: string, runtimeId?: string) => Promise<unknown>
      }
    }

    await expect(
      api.modelProviders.runRuntimeChecks('anthropic', {
        modelId: 'claude-sonnet',
        checkGateway: true
      })
    ).resolves.toMatchObject({
      providerId: 'anthropic',
      finalCompatibility: { selectable: false }
    })
    await expect(
      api.modelProviders.getRuntimeCheckReport('anthropic', 'claude-sonnet', 'claude-code')
    ).resolves.toMatchObject({
      providerId: 'anthropic',
      finalCompatibility: { selectable: true }
    })
    expect(invoke).toHaveBeenNthCalledWith(1, IpcChannels.modelProvidersRunRuntimeChecks, 'anthropic', {
      modelId: 'claude-sonnet',
      checkGateway: true
    })
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      IpcChannels.modelProvidersGetRuntimeCheckReport,
      'anthropic',
      'claude-sonnet',
      'claude-code'
    )
  })

  it('exposes exactly one read-only model provider reveal method and keeps the rest of the namespace', async () => {
    invoke.mockResolvedValueOnce({ apiKey: 'sk-fixture-value' })

    await import('./index')
    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      modelProviders: Record<string, unknown> & {
        revealApiKey: (providerId: string) => Promise<unknown>
      }
    }

    expect(Object.keys(api.modelProviders).sort()).toEqual([
      'addOrUpdateModel',
      'applyModelSync',
      'cancelModelDetection',
      'detectModels',
      'generateImage',
      'getRuntimeCheckReport',
      'list',
      'onModelDetectionDone',
      'onModelDetectionProgress',
      'previewModelSync',
      'remove',
      'removeModel',
      'revealApiKey',
      'revealCustomHeaders',
      'runRuntimeChecks',
      'setCustomHeaders',
      'setDefaultChatModel',
      'setEnabled',
      'testConnection',
      'upsert'
    ])
    await expect(api.modelProviders.revealApiKey('openai')).resolves.toEqual({ apiKey: 'sk-fixture-value' })
    expect(invoke).toHaveBeenCalledWith(IpcChannels.modelProvidersRevealApiKey, 'openai')
  })

  it('exposes image generation and editing on the same invoke with reference payloads', async () => {
    const settled = {
      ok: true,
      messageId: 'message-1',
      imageCount: 1,
      images: [{ kind: 'image', mime: 'image/png', fileName: '0123456789abcdef.png', byteLength: 128 }]
    }
    invoke.mockResolvedValueOnce(settled).mockResolvedValueOnce(settled)

    await import('./index')
    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      modelProviders: {
        generateImage: (input: {
          providerId: string
          modelId: string
          prompt: string
          topicId: string
          size?: string
          count?: number
          operation?: 'generate' | 'edit'
          sourceImage?: { fileName: string } | { mime: string; bytes: Uint8Array }
        }) => Promise<unknown>
      }
    }

    const request = {
      providerId: 'acme',
      modelId: 'acme-image',
      prompt: 'a red fox',
      size: '512x512',
      count: 2,
      topicId: 'topic-1'
    }
    await expect(api.modelProviders.generateImage(request)).resolves.toEqual(settled)
    expect(invoke).toHaveBeenCalledWith(IpcChannels.modelProvidersGenerateImage, 'acme', {
      modelId: 'acme-image',
      prompt: 'a red fox',
      topicId: 'topic-1',
      size: '512x512',
      count: 2
    })

    // 编辑复用同一通道：只多一个 operation + 原图引用（文件名或字节），不新增 IPC 通道。
    await api.modelProviders.generateImage({
      ...request,
      operation: 'edit',
      sourceImage: { fileName: '0123456789abcdef.png' }
    })
    expect(invoke).toHaveBeenLastCalledWith(IpcChannels.modelProvidersGenerateImage, 'acme', {
      modelId: 'acme-image',
      prompt: 'a red fox',
      topicId: 'topic-1',
      size: '512x512',
      count: 2,
      operation: 'edit',
      sourceImage: { fileName: '0123456789abcdef.png' }
    })
  })

  it('exposes the PLAT-82 detection methods and their subscriptions', async () => {
    invoke.mockResolvedValueOnce({ accepted: true, total: 3 }).mockResolvedValueOnce(undefined)

    await import('./index')
    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      modelProviders: {
        detectModels: (
          providerId: string,
          options: { modes: Array<'connectivity' | 'protocol'>; runId: string }
        ) => Promise<unknown>
        cancelModelDetection: (runId: string) => Promise<unknown>
        onModelDetectionProgress: (callback: (result: unknown) => void) => () => void
        onModelDetectionDone: (callback: (runId: string, payload: { stopped: boolean }) => void) => () => void
      }
    }

    await expect(
      api.modelProviders.detectModels('lanyun', { modes: ['connectivity', 'protocol'], runId: 'run-1' })
    ).resolves.toEqual({ accepted: true, total: 3 })
    await expect(api.modelProviders.cancelModelDetection('run-1')).resolves.toBeUndefined()
    expect(invoke).toHaveBeenNthCalledWith(
      1,
      IpcChannels.modelProvidersDetectModels,
      'lanyun',
      { modes: ['connectivity', 'protocol'], runId: 'run-1' }
    )
    expect(invoke).toHaveBeenNthCalledWith(2, IpcChannels.modelProvidersCancelModelDetection, 'run-1')

    // 订阅注册在对应事件通道上，并且返回可用的取消订阅函数。
    const progress = vi.fn()
    const done = vi.fn()
    const offProgress = api.modelProviders.onModelDetectionProgress(progress)
    const offDone = api.modelProviders.onModelDetectionDone(done)
    expect(on).toHaveBeenCalledWith(IpcChannels.modelProvidersDetectionProgress, expect.any(Function))
    expect(on).toHaveBeenCalledWith(IpcChannels.modelProvidersDetectionDone, expect.any(Function))
    expect(removeListener).toHaveBeenCalledTimes(0)
    offProgress()
    offDone()
    expect(removeListener).toHaveBeenCalledWith(
      IpcChannels.modelProvidersDetectionProgress,
      expect.any(Function)
    )
    expect(removeListener).toHaveBeenCalledWith(IpcChannels.modelProvidersDetectionDone, expect.any(Function))
  })

  it('exposes the controlled workspace namespace without arbitrary channel or URL inputs', async () => {
    invoke
      .mockResolvedValueOnce({ status: 'ok', context: { windowInstanceId: 'window-1' } })
      .mockResolvedValueOnce({ status: 'ok', snapshot: { layoutRevision: 3 } })
      .mockResolvedValueOnce({ status: 'applied', snapshot: { layoutRevision: 4 } })
      .mockResolvedValueOnce({ accepted: true })
      // P2-03：`.tabs.*` 三个受控入口（同一命名空间，不新增通道类别）
      .mockResolvedValueOnce({ status: 'ok', snapshot: { layoutRevision: 1, activeWorkspaceInstanceKey: null, tabs: [] } })
      .mockResolvedValueOnce({ status: 'applied', snapshot: { layoutRevision: 2, activeWorkspaceInstanceKey: null, tabs: [] } })
      .mockResolvedValueOnce({ accepted: true })

    await import('./index')
    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      workspace: {
        getHostContext: () => Promise<unknown>
        getSnapshot: () => Promise<unknown>
        command: (request: unknown) => Promise<unknown>
        hostLifecycle: (request: unknown) => Promise<unknown>
        tabsGetSnapshot: () => Promise<unknown>
        tabsCommand: (request: unknown) => Promise<unknown>
        tabsHostLifecycle: (request: unknown) => Promise<unknown>
        onEvent: (callback: (event: unknown) => void) => () => void
      }
    }

    await expect(api.workspace.getHostContext()).resolves.toMatchObject({ status: 'ok' })
    await expect(api.workspace.getSnapshot()).resolves.toMatchObject({ status: 'ok' })
    await expect(api.workspace.command({ method: 'closePanel', requestId: 'r', expectedRevision: 1, panelInstanceKey: 'panel-1' }))
      .resolves.toMatchObject({ status: 'applied' })
    await expect(api.workspace.hostLifecycle({ operationId: 'op-1', phase: 'target-ready' })).resolves.toEqual({ accepted: true })
    await expect(api.workspace.tabsGetSnapshot()).resolves.toMatchObject({ status: 'ok' })
    await expect(api.workspace.tabsCommand({ method: 'openTab', requestId: 'r1', expectedRevision: 0, pageId: 'agents' }))
      .resolves.toMatchObject({ status: 'applied' })
    await expect(api.workspace.tabsHostLifecycle({ operationId: 'op-2', phase: 'target-ready' })).resolves.toEqual({ accepted: true })

    expect(invoke).toHaveBeenNthCalledWith(1, IpcChannels.workspaceGetHostContext)
    expect(invoke).toHaveBeenNthCalledWith(2, IpcChannels.workspaceGetSnapshot)
    expect(invoke).toHaveBeenNthCalledWith(3, IpcChannels.workspaceCommand, {
      method: 'closePanel', requestId: 'r', expectedRevision: 1, panelInstanceKey: 'panel-1'
    })
    expect(invoke).toHaveBeenNthCalledWith(4, IpcChannels.workspaceHostLifecycle, { operationId: 'op-1', phase: 'target-ready' })
    expect(invoke).toHaveBeenNthCalledWith(5, IpcChannels.workspaceTabsGetSnapshot)
    expect(invoke).toHaveBeenNthCalledWith(6, IpcChannels.workspaceTabsCommand, {
      method: 'openTab', requestId: 'r1', expectedRevision: 0, pageId: 'agents'
    })
    expect(invoke).toHaveBeenNthCalledWith(7, IpcChannels.workspaceTabsHostLifecycle, { operationId: 'op-2', phase: 'target-ready' })
    // 命名空间是具名白名单：没有任意 channel / URL / 路径型入口
    expect(Object.keys(api.workspace)).toEqual([
      'getHostContext', 'getSnapshot', 'command', 'hostLifecycle',
      'tabsGetSnapshot', 'tabsCommand', 'tabsHostLifecycle', 'onEvent'
    ])
    expect(api.workspace).not.toHaveProperty('invoke')
    expect(api.workspace).not.toHaveProperty('openExternal')
    expect(api.workspace).not.toHaveProperty('openPath')
  })

  it('subscribes and releases a single workspace event listener', async () => {
    await import('./index')
    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      workspace: { onEvent: (callback: (event: unknown) => void) => () => void }
    }

    const callback = vi.fn()
    const unsubscribe = api.workspace.onEvent(callback)
    expect(on).toHaveBeenCalledTimes(1)
    expect(on).toHaveBeenCalledWith(IpcChannels.workspaceEvent, expect.any(Function))

    const listener = on.mock.calls[0]?.[1] as ((event: unknown, payload: unknown) => void) | undefined
    listener?.(null, { type: 'snapshot', layoutRevision: 5 })
    expect(callback).toHaveBeenCalledWith({ type: 'snapshot', layoutRevision: 5 })

    unsubscribe()
    expect(removeListener).toHaveBeenCalledWith(IpcChannels.workspaceEvent, listener)
  })

  it('fans out product event subscriptions through a single ipcRenderer listener', async () => {
    await import('./index')
    const api = exposeInMainWorld.mock.calls[0]?.[1] as {
      products: {
        onEvent: (productId: string, event: string, callback: (data: unknown) => void) => () => void
      }
    }

    const first = vi.fn()
    const second = vi.fn()
    const unsubscribeFirst = api.products.onEvent('sample-product', 'marketData.stream.candleStream', first)
    const unsubscribeSecond = api.products.onEvent('sample-product', 'marketData.stream.streamHealth', second)

    expect(on).toHaveBeenCalledTimes(1)
    expect(on).toHaveBeenCalledWith(IpcChannels.productIpcEvent, expect.any(Function))

    const listener = on.mock.calls[0]?.[1] as
      | ((event: unknown, payload: { productId?: string; event?: string; data?: unknown }) => void)
      | undefined
    expect(listener).toBeTypeOf('function')

    listener?.(null, {
      productId: 'sample-product',
      event: 'marketData.stream.candleStream',
      data: { close: 101 }
    })
    listener?.(null, {
      productId: 'sample-product',
      event: 'marketData.stream.streamHealth',
      data: { status: 'connected' }
    })
    listener?.(null, {
      productId: 'market-intelligence',
      event: 'marketData.stream.candleStream',
      data: { close: 999 }
    })

    expect(first).toHaveBeenCalledWith({ close: 101 })
    expect(second).toHaveBeenCalledWith({ status: 'connected' })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)

    unsubscribeFirst()
    expect(removeListener).not.toHaveBeenCalled()
    unsubscribeSecond()
    expect(removeListener).toHaveBeenCalledTimes(1)
    expect(removeListener).toHaveBeenCalledWith(IpcChannels.productIpcEvent, listener)
  })
})
