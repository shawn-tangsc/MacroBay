import { describe, expect, it } from 'vitest'

import { createAgentPlatformDatabase, type AgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { ChannelDeliveryRepository } from './ChannelDeliveryRepository'
import { ChannelInboundRepository } from './ChannelInboundRepository'
import { ChannelManagementQueryRepository } from './ChannelManagementQueryRepository'

// PLAT-43: the audit / retention queries already carry an explicit `created_at, id` tie-break, but
// no test pinned it, so a "simplification" that drops the second key would not be caught. Every
// guard below fixes the clock by writing the *same* created_at constant (no sleep, no randomness)
// and inserts the two ids in the opposite order of the expected result. An implementation that
// sorts only by created_at therefore falls back to insertion (rowid) order and fails.

const FIXED_CLOCK = '2026-07-18T00:00:00.000Z'

function ids(rows: Array<{ id: string }>): string[] {
  return rows.map((row) => row.id)
}

function seedManagedChannel(database: AgentPlatformDatabase): void {
  database.connection.exec(`
    insert into agent_entities(id,type, name, mcps_json, disabled_tools_json, order_key, created_at, updated_at)
      values ('agent-a', 'general', 'Agent', '[]', '[]', '0', '2026-01-01', '2026-01-01');
    insert into agent_channels (id, adapter_key, name, agent_id, requested_enabled, lifecycle_state, created_at, updated_at)
      values ('channel-a', 'telegram', 'Channel', 'agent-a', 1, 'enabled', '2026-01-01', '2026-01-01');
  `)
}

describe('audit page tie-break', () => {
  it('orders delivery audits with the same created_at by id desc, not by insertion order', () => {
    const database = createAgentPlatformDatabase(':memory:')
    database.connection.exec(`
      insert into channel_delivery_audits (id, channel_id, attempt_id, code, created_at) values
        ('audit-a', 'channel-a', 'attempt-1', 'channel-delivery-delivered', '${FIXED_CLOCK}'),
        ('audit-b', 'channel-a', 'attempt-1', 'channel-delivery-delivered', '${FIXED_CLOCK}');
    `)
    // Insertion order (audit-a, audit-b) is the reverse of the expected page order: without the
    // `id desc` tie-break the query would return audit-a first.
    expect(ids(database.connection.prepare('select id from channel_delivery_audits order by rowid asc').all() as Array<{ id: string }>))
      .toEqual(['audit-a', 'audit-b'])

    const page = new ChannelDeliveryRepository(database).listAudits({ channelId: 'channel-a', limit: 50, offset: 0 })
    expect(page.total).toBe(2)
    expect(ids(page.audits)).toEqual(['audit-b', 'audit-a'])
  })

  it('orders management audits with the same created_at by id desc, not by insertion order', () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedManagedChannel(database)
    database.connection.exec(`
      insert into channel_management_audits (id, channel_id, actor_id, action, code, summary_json, created_at) values
        ('audit-a', 'channel-a', 'user-a', 'update', null, '{}', '${FIXED_CLOCK}'),
        ('audit-b', 'channel-a', 'user-a', 'update', null, '{}', '${FIXED_CLOCK}');
    `)
    expect(ids(database.connection.prepare('select id from channel_management_audits order by rowid asc').all() as Array<{ id: string }>))
      .toEqual(['audit-a', 'audit-b'])

    const page = new ChannelManagementQueryRepository(database).audits('channel-a', 50, 0)
    expect(ids(page)).toEqual(['audit-b', 'audit-a'])
  })

  it('deletes same-created_at receipts by id asc under a bounded retention slice, not by insertion order', () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedManagedChannel(database)
    database.connection.exec(`
      insert into channel_receipts (id, channel_id, provider_event_key_ciphertext, provider_event_key_ref,
        provider_event_key_revision, provider_event_key_hash, status, generation, created_at, updated_at) values
        ('receipt-b', 'channel-a', x'01', 'ref', 1, 'hash-b', 'ignored', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
        ('receipt-a', 'channel-a', x'01', 'ref', 1, 'hash-a', 'ignored', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    `)
    // Both receipts share one created_at and are inserted b-then-a, the reverse of the `r.id asc`
    // tie-break: without it the bounded slice would delete receipt-b first.
    expect(ids(database.connection.prepare('select id from channel_receipts order by rowid asc').all() as Array<{ id: string }>))
      .toEqual(['receipt-b', 'receipt-a'])

    const cleaned = new ChannelInboundRepository(database).cleanupChannel('channel-a', new Date(FIXED_CLOCK), 1)
    expect(cleaned).toEqual({ receipts: 1, workItems: 0 })
    // The single-row slice takes the lowest id (receipt-a); only receipt-b survives.
    expect(ids(database.connection.prepare('select id from channel_receipts order by id asc').all() as Array<{ id: string }>))
      .toEqual(['receipt-b'])
  })
})
