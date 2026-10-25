import { describe, expect, it } from 'vitest'

import { createAgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { ChannelDispatchRunRepository } from './ChannelDispatchRunRepository'

describe('ChannelDispatchRunRepository', () => {
  it('records one started run, stores the encrypted result, and marks delivery', () => {
    const database = createAgentPlatformDatabase(':memory:')
    const runs = new ChannelDispatchRunRepository(database)
    const input = {
      dispatchId: 'dispatch-a',
      channelId: 'channel-a',
      workItemId: 'work-a',
      conversationId: 'conversation-a',
      now: new Date('2026-10-24T00:00:00.000Z')
    }

    expect(runs.start(input)).toBe(true)
    expect(runs.start(input)).toBe(false)
    expect(runs.get('dispatch-a')).toMatchObject({ status: 'started', workItemId: 'work-a' })

    runs.complete({
      dispatchId: 'dispatch-a',
      channelId: 'channel-a',
      conversationId: 'conversation-a',
      textCiphertext: new Uint8Array([1, 2, 3]),
      textKeyRef: 'ref',
      textKeyRevision: 1,
      now: new Date('2026-10-24T00:01:00.000Z')
    })
    expect(runs.get('dispatch-a')).toMatchObject({ status: 'completed' })
    expect(runs.getResult('dispatch-a')).toMatchObject({ status: 'pending', textKeyRef: 'ref' })

    runs.markResult('dispatch-a', 'delivered')
    expect(runs.getResult('dispatch-a')).toMatchObject({ status: 'delivered' })
  })

  it('marks only a started run as failed or interrupted', () => {
    const database = createAgentPlatformDatabase(':memory:')
    const runs = new ChannelDispatchRunRepository(database)
    runs.start({ dispatchId: 'dispatch-a', channelId: 'channel-a', workItemId: 'work-a', conversationId: 'conversation-a' })
    runs.fail('dispatch-a', 'interrupted')
    expect(runs.get('dispatch-a')).toMatchObject({ status: 'interrupted' })
    runs.fail('dispatch-a', 'failed')
    expect(runs.get('dispatch-a')).toMatchObject({ status: 'interrupted' })
  })
})
