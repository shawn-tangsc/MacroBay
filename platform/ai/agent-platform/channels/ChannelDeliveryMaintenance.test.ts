import { describe, expect, it } from 'vitest'

import { createAgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { ChannelDeliveryMaintenance } from './ChannelDeliveryMaintenance'
import { ChannelDeliveryRepository } from './ChannelDeliveryRepository'

describe('ChannelDeliveryMaintenance', () => {
  it('runs one bounded SQLite cleanup slice and deletes an attempt past the retention window', () => {
    const database = createAgentPlatformDatabase(':memory:')
    database.connection.exec(`
      insert into channel_delivery_attempts (id, channel_id, agent_id, conversation_id, source_type, source_hash, idempotency_key, status, created_at, updated_at, completed_at)
      values ('old', 'channel-a', 'agent-a', 'conversation-a', 'task-result', 'hash', 'opaque', 'delivered', '2026-01-01', '2026-01-01', '2026-01-01');
    `)
    const maintenance = new ChannelDeliveryMaintenance({
      repository: new ChannelDeliveryRepository(database),
      now: () => new Date('2026-07-19T00:00:00.000Z')
    })

    maintenance.runSlice()

    expect(database.connection.prepare("select count(*) as count from channel_delivery_attempts where id = 'old'").get()).toEqual({ count: 0 })
  })

  // The timer that used to drive this pass now lives in `channelMaintenanceJobs`; a failing retry
  // must still be contained here, because the job handler awaits it.
  it('contains a failing retry pass so it cannot surface as an unhandled rejection', async () => {
    const maintenance = new ChannelDeliveryMaintenance({
      repository: { cleanupChannelsPage: () => ({ nextCursor: null }) } as never,
      retryDue: async () => { throw new Error('retry blew up') }
    })

    await expect(maintenance.runRetrySlice()).resolves.toBeUndefined()
  })

  it('contains cleanup failure so maintenance cannot block inbound or task work', () => {
    const maintenance = new ChannelDeliveryMaintenance({ repository: { cleanupChannelsPage: () => { throw new Error('sqlite busy') } } as never })
    expect(() => maintenance.runSlice()).not.toThrow()
  })
})
