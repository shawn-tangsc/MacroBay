import { describe, expect, it } from 'vitest'

import { createAgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { ChannelDeliveryMaintenance } from './ChannelDeliveryMaintenance'
import { ChannelDeliveryRepository } from './ChannelDeliveryRepository'

describe('ChannelDeliveryMaintenance', () => {
  it('runs one bounded SQLite cleanup slice at startup and again at fifteen minutes', () => {
    const database = createAgentPlatformDatabase(':memory:')
    database.connection.exec(`
      insert into channel_delivery_attempts (id, channel_id, agent_id, conversation_id, source_type, source_hash, idempotency_key, status, created_at, updated_at, completed_at)
      values ('old', 'channel-a', 'agent-a', 'conversation-a', 'task-result', 'hash', 'opaque', 'delivered', '2026-01-01', '2026-01-01', '2026-01-01');
    `)
    let tick: (() => void) | undefined
    const maintenance = new ChannelDeliveryMaintenance({
      repository: new ChannelDeliveryRepository(database), now: () => new Date('2026-07-19T00:00:00.000Z'),
      setInterval: (callback, delay) => { expect(delay).toBe(15 * 60_000); tick = callback; return 1 as never }, clearInterval: () => {}
    })
    const dispose = maintenance.start()
    expect(database.connection.prepare("select count(*) as count from channel_delivery_attempts where id = 'old'").get()).toEqual({ count: 0 })
    tick?.()
    dispose()
  })

  it('contains cleanup failure so maintenance cannot block inbound or task work', () => {
    const maintenance = new ChannelDeliveryMaintenance({ repository: { cleanupChannelsPage: () => { throw new Error('sqlite busy') } } as never })
    expect(() => maintenance.runSlice()).not.toThrow()
  })
})
