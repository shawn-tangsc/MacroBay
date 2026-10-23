import { describe, expect, it, vi } from 'vitest'

import { createIdleLaneResult } from '../../../ai/agent-platform/runtime/compatibility/providerRuntimeCheckTypes'
import { createAgentRuntimeProbeSnapshotStore } from './AgentRuntimeProbeSnapshotStore'

describe('AgentRuntimeProbeSnapshotStore', () => {
  it('persists and reloads safe runtime reports without secrets', async () => {
    const files = new Map<string, string>()
    const store = createAgentRuntimeProbeSnapshotStore({
      userDataPath: '/tmp/user-data',
      mkdir: vi.fn(async () => undefined),
      readFile: async (path) => {
        const value = files.get(path)
        if (!value) throw new Error('missing')
        return value
      },
      writeFile: async (path, contents) => {
        files.set(path, contents)
      }
    })

    const report = {
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      runtimeId: 'claude-code' as const,
      ordinaryChat: {
        lane: 'ordinary-chat' as const,
        status: 'ready' as const,
        summary: 'Connection succeeded.',
        checkedAt: '2026-07-10T00:00:00.000Z'
      },
      direct: {
        lane: 'claude-code-direct' as const,
        status: 'auth-failed' as const,
        summary: 'Direct Claude Code authentication failed.',
        checkedAt: '2026-07-10T00:00:00.000Z',
        route: 'direct' as const
      },
      gateway: createIdleLaneResult('claude-code-gateway', 'Agent model gateway is disabled.'),
      finalCompatibility: {
        providerId: 'deepseek',
        modelId: 'deepseek-chat',
        runtimeId: 'claude-code' as const,
        selectable: false,
        route: 'none' as const,
        status: 'auth-failed' as const,
        summary: 'Direct Claude Code authentication failed.'
      },
      updatedAt: '2026-07-10T00:00:00.000Z',
      signature: 'sig-1'
    }

    await store.writeReport(report)
    expect(await store.getReport('deepseek', 'deepseek-chat', 'claude-code')).toEqual(report)

    const reloaded = createAgentRuntimeProbeSnapshotStore({
      userDataPath: '/tmp/user-data',
      mkdir: vi.fn(async () => undefined),
      readFile: async (path) => {
        const value = files.get(path)
        if (!value) throw new Error('missing')
        return value
      },
      writeFile: async (path, contents) => {
        files.set(path, contents)
      }
    })

    expect(await reloaded.getReport('deepseek', 'deepseek-chat', 'claude-code')).toEqual(report)
    expect([...files.values()][0]).not.toContain('sk-')
    expect([...files.values()][0]).not.toContain('authorization')
  })

  it('invalidates provider reports when provider settings change', async () => {
    const store = createAgentRuntimeProbeSnapshotStore({
      userDataPath: '/tmp/user-data',
      mkdir: vi.fn(async () => undefined),
      readFile: async () => {
        throw new Error('missing')
      },
      writeFile: vi.fn(async () => undefined)
    })

    await store.writeReport({
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      runtimeId: 'claude-code',
      ordinaryChat: createIdleLaneResult('ordinary-chat'),
      finalCompatibility: {
        providerId: 'deepseek',
        modelId: 'deepseek-chat',
        runtimeId: 'claude-code',
        selectable: false,
        route: 'none',
        status: 'unknown',
        summary: 'Unknown'
      },
      updatedAt: '2026-07-10T00:00:00.000Z',
      signature: 'sig-1'
    })

    await store.invalidateProvider('deepseek')
    expect(await store.getReport('deepseek', 'deepseek-chat', 'claude-code')).toBeNull()
  })

  it('invalidates gateway-dependent reports when gateway state changes', async () => {
    const store = createAgentRuntimeProbeSnapshotStore({
      userDataPath: '/tmp/user-data',
      mkdir: vi.fn(async () => undefined),
      readFile: async () => {
        throw new Error('missing')
      },
      writeFile: vi.fn(async () => undefined)
    })

    await store.writeReport({
      providerId: 'openai',
      modelId: 'gpt-5',
      runtimeId: 'claude-code',
      ordinaryChat: createIdleLaneResult('ordinary-chat'),
      gateway: {
        lane: 'claude-code-gateway',
        status: 'ready',
        summary: 'Gateway ready',
        route: 'gateway'
      },
      finalCompatibility: {
        providerId: 'openai',
        modelId: 'gpt-5',
        runtimeId: 'claude-code',
        selectable: true,
        route: 'gateway',
        status: 'ready',
        summary: 'Ready through Agent Gateway'
      },
      updatedAt: '2026-07-10T00:00:00.000Z',
      signature: 'sig-gateway'
    })
    await store.writeReport({
      providerId: 'anthropic',
      modelId: 'claude-sonnet',
      runtimeId: 'claude-code',
      ordinaryChat: createIdleLaneResult('ordinary-chat'),
      direct: {
        lane: 'claude-code-direct',
        status: 'ready',
        summary: 'Direct ready',
        route: 'direct'
      },
      finalCompatibility: {
        providerId: 'anthropic',
        modelId: 'claude-sonnet',
        runtimeId: 'claude-code',
        selectable: true,
        route: 'direct',
        status: 'ready',
        summary: 'Direct Claude Code'
      },
      updatedAt: '2026-07-10T00:00:00.000Z',
      signature: 'sig-direct'
    })

    await store.invalidateGatewayDependentReports()

    expect(await store.getReport('openai', 'gpt-5', 'claude-code')).toBeNull()
    expect(await store.getReport('anthropic', 'claude-sonnet', 'claude-code')).not.toBeNull()
  })

  it('drops reports written by an older compatibility policy', async () => {
    const files = new Map<string, string>()
    const legacyReport = {
      providerId: 'tokenrhythm',
      modelId: 'deepseek-v4.1-flash-1017',
      runtimeId: 'claude-code',
      ordinaryChat: createIdleLaneResult('ordinary-chat'),
      finalCompatibility: {
        providerId: 'tokenrhythm',
        modelId: 'deepseek-v4.1-flash-1017',
        runtimeId: 'claude-code',
        selectable: false,
        route: 'gateway',
        status: 'gateway-required',
        summary: 'Old rule: gateway required after a 429 probe.'
      },
      updatedAt: '2026-10-22T08:28:49.992Z',
      signature: 'old-signature'
    }
    files.set(
      '/tmp/user-data/platform/agent-runtime-compatibility.json',
      JSON.stringify({ reports: [legacyReport] })
    )

    const store = createAgentRuntimeProbeSnapshotStore({
      userDataPath: '/tmp/user-data',
      mkdir: vi.fn(async () => undefined),
      readFile: async (path) => {
        const value = files.get(path)
        if (!value) throw new Error('missing')
        return value
      },
      writeFile: async (path, contents) => {
        files.set(path, contents)
      }
    })

    expect(await store.getReport('tokenrhythm', 'deepseek-v4.1-flash-1017', 'claude-code')).toBeNull()
  })
})
