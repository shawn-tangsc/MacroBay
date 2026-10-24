import { describe, expect, it, vi } from 'vitest'

import { ChannelRuntimeSupervisor } from './ChannelRuntimeSupervisor'

const activeRow: {
  channelId: string
  type: 'telegram'
  agentId: string
  requestedEnabled: boolean
  migrationState: string
  generation: number
  lifecycleState: 'active' | 'inactive'
  sessionId: string
} = {
  channelId: 'channel-a',
  type: 'telegram' as const,
  agentId: 'agent-a',
  requestedEnabled: true,
  migrationState: 'runtime-ready',
  generation: 1,
  lifecycleState: 'active' as const,
  sessionId: 'session-a'
}

describe('ChannelRuntimeSupervisor', () => {
  it('projects durable runtime rows into the renderer snapshot without legacy state', () => {
    const supervisor = new ChannelRuntimeSupervisor({
      query: { runtimeRows: () => [activeRow] },
      restart: async () => undefined,
      now: () => 1_000
    })
    expect(supervisor.snapshot()).toEqual({
      channels: [expect.objectContaining({
        channelId: 'channel-a',
        type: 'telegram',
        sessionId: 'session-a',
        isActive: true,
        runtimeState: 'connecting',
        activeChatCount: 1,
        updatedAt: 1_000
      })]
    })

    supervisor.setStatus('channel-a', { state: 'connected' })
    expect(supervisor.snapshot().channels[0]).toMatchObject({ runtimeState: 'connected', runtimeLifecycleState: 'ready' })
  })

  it('keeps disabled or inactive generations inert even if a session is still bound', () => {
    const supervisor = new ChannelRuntimeSupervisor({
      query: {
        runtimeRows: () => [
          { ...activeRow, requestedEnabled: false },
          { ...activeRow, channelId: 'channel-b', lifecycleState: 'inactive' }
        ]
      },
      restart: async () => undefined
    })
    expect(supervisor.snapshot().channels).toEqual([
      expect.objectContaining({ channelId: 'channel-a', isActive: false, runtimeState: 'inactive' }),
      expect.objectContaining({ channelId: 'channel-b', isActive: false, runtimeState: 'inactive' })
    ])
  })

  it('restarts through the management seam and returns a fresh snapshot', async () => {
    const restart = vi.fn(async () => ({ ok: true }))
    let rows = [activeRow]
    const supervisor = new ChannelRuntimeSupervisor({
      query: { runtimeRows: () => rows },
      restart
    })
    await supervisor.restart('channel-a')
    expect(restart).toHaveBeenCalledWith('channel-a')
    rows = [{ ...activeRow, lifecycleState: 'inactive' }]
    expect(supervisor.snapshot().channels[0]).toMatchObject({ isActive: false })
  })
})
