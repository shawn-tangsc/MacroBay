import { describe, expect, it, vi } from 'vitest'

import { AgentTaskAutomationQueryService } from './AgentTaskAutomationQueryService'

describe('AgentTaskAutomationQueryService', () => {
  it('previews cron schedules with the configured default timezone', async () => {
    const service = new AgentTaskAutomationQueryService({
      queries: {},
      getPolicyPreset: async () => 'balanced',
      setPolicyPreset: async () => undefined,
      defaultTimezone: 'Asia/Shanghai',
      now: () => new Date('2026-07-16T00:00:00.000Z')
    })

    await expect(service.previewTaskSchedule({ kind: 'cron', expr: '0 9 * * *' })).resolves.toEqual({
      ok: true,
      nextRunAt: '2026-07-16T01:00:00.000Z'
    })
  })

  it('clones bounded repository pages and exposes only safe delivery readiness', async () => {
    const task = {
      id: 'task-1',
      agentId: 'agent-1',
      name: 'Daily brief',
      prompt: 'Brief',
      trigger: { kind: 'interval' as const, ms: 300_000 },
      timeoutMinutes: 2,
      workspace: { type: 'system' as const },
      channelIds: ['channel-ready', 'channel-idle'],
      enabled: true,
      status: 'active' as const,
      createdAt: '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z'
    }
    const source = { tasks: [task], total: 1, nextCursor: 'cursor-1' }
    const listPage = vi.fn(() => source)
    const service = new AgentTaskAutomationQueryService({
      queries: {
        tasks: { listPage, get: (taskId: string) => (taskId === task.id ? task : null) },
        channels: {
          list: () => [
            {
              id: 'channel-ready',
              type: 'telegram',
              name: 'Secret token is not exposed',
              agentId: 'agent-1',
              workspace: { type: 'system' as const },
              config: { bot_token: 'secret' },
              activeChatIds: ['chat-1'],
              isActive: true,
              createdAt: '2026-07-16T00:00:00.000Z',
              updatedAt: '2026-07-16T00:00:00.000Z'
            },
            {
              id: 'channel-idle',
              type: 'telegram',
              name: 'Idle',
              agentId: 'agent-1',
              workspace: { type: 'system' as const },
              config: { bot_token: 'other-secret' },
              activeChatIds: [],
              isActive: true,
              createdAt: '2026-07-16T00:00:00.000Z',
              updatedAt: '2026-07-16T00:00:00.000Z'
            }
          ]
        },
        channelDeliveryTargets: { hasEnabledTarget: (channelId: string) => channelId === 'channel-ready' }
      } as any,
      getPolicyPreset: async () => 'balanced',
      setPolicyPreset: async () => undefined
    })

    const page = await service.listTaskPage({ agentId: 'agent-1', limit: 999 })
    const readiness = await service.getTaskDeliveryReadiness('agent-1', 'task-1')
    page.tasks[0]!.name = 'Mutated by renderer'

    expect(listPage).toHaveBeenCalledWith({ agentId: 'agent-1', limit: 100 })
    expect(source.tasks[0]!.name).toBe('Daily brief')
    expect(readiness).toEqual([
      { channelId: 'channel-ready', status: 'ready' },
      { channelId: 'channel-idle', status: 'no-active-chat' }
    ])
    expect(JSON.stringify(readiness)).not.toContain('secret')
    expect(JSON.stringify(readiness)).not.toContain('chat-1')
  })

  it('uses exactly one audit scope and persists only supported policy presets', async () => {
    const getPolicyPreset = vi.fn(async () => 'balanced' as const)
    const setPolicyPreset = vi.fn(async () => undefined)
    const service = new AgentTaskAutomationQueryService({
      queries: {
        taskMutationAudits: {
          listByTask: () => ({ audits: [], total: 0 }),
          listByAgent: () => ({ audits: [], total: 0 })
        }
      },
      getPolicyPreset,
      setPolicyPreset
    })

    await expect(service.listTaskMutationAudits({})).rejects.toMatchObject({ code: 'task-request-invalid' })
    await expect(service.listTaskMutationAudits({ taskId: 'task-1', agentId: 'agent-1' })).rejects.toMatchObject({
      code: 'task-request-invalid'
    })
    await expect(service.getTaskAutomationPolicy()).resolves.toMatchObject({ preset: 'balanced' })
    await expect(service.updateTaskAutomationPolicy({ policyPreset: 'conservative' })).resolves.toMatchObject({
      preset: 'conservative'
    })
    expect(setPolicyPreset).toHaveBeenCalledWith('conservative')
  })

  it('keeps the readable policy unchanged when persistence fails and recovers on a later write', async () => {
    let preset: 'balanced' | 'conservative' = 'balanced'
    let fail = true
    const service = new AgentTaskAutomationQueryService({
      queries: {}, getPolicyPreset: async () => preset,
      setPolicyPreset: async (next) => { if (fail) { fail = false; throw new Error('disk-full /private/secret') }; preset = next }
    })
    await expect(service.updateTaskAutomationPolicy({ policyPreset: 'conservative' })).rejects.toThrow('disk-full')
    await expect(service.getTaskAutomationPolicy()).resolves.toMatchObject({ preset: 'balanced' })
    await service.updateTaskAutomationPolicy({ policyPreset: 'conservative' })
    await expect(service.getTaskAutomationPolicy()).resolves.toMatchObject({ preset: 'conservative' })
  })

  it('requires the requested Agent to own a run before exposing delivery attempts', async () => {
    const listTaskAttempts = vi.fn(() => ({ attempts: [{ id: 'attempt-1' }], total: 1 }))
    const service = new AgentTaskAutomationQueryService({
      queries: {
        taskRunLogs: { get: () => ({ id: 'run-1', scheduleId: 'task-1', agentId: 'agent-1' }) },
        channelDeliveryAttempts: { listTaskAttempts }
      } as any,
      getPolicyPreset: async () => 'balanced',
      setPolicyPreset: async () => undefined
    })

    await expect(service.getTaskDeliveryAttempts('agent-2', 'run-1')).rejects.toMatchObject({ code: 'task-not-found' })
    await expect(service.getTaskDeliveryAttempts('agent-1', 'run-1', { limit: 1, offset: 0 })).resolves.toMatchObject({
      attempts: [{ id: 'attempt-1' }],
      total: 1
    })
    expect(listTaskAttempts).toHaveBeenCalledWith({ agentId: 'agent-1', runLogId: 'run-1', limit: 1, offset: 0 })
  })
})
