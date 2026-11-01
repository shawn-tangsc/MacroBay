import { describe, expect, it } from 'vitest'

import { createAgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { ChannelInboundRepository } from './ChannelInboundRepository'

/**
 * 测量型用例：断言的是「固定预算下清理一片的代价」，不是功能对错。
 *
 * 它和几百个功能用例挤在同一个并发池时，量到的是机器的忙闲：同一提交在这台机器上跑出
 * 780ms、1107ms。因此单独进 `measurement` project 串行跑（见 `vitest.config.ts`），
 * 并把断言改成「同机连续三次取中位」——绝对阈值保留，但不再由一次抖动决定。
 */
describe('inbound cleanup cost', () => {
  it('keeps one bounded cleanup slice under the 1s budget, measured as the median of three runs', () => {
    const database = createAgentPlatformDatabase(':memory:')
    const repository = new ChannelInboundRepository(database)
    database.connection.exec(`
      with digits(d) as (values (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)),
      n(x) as (select a.d + b.d * 10 + c.d * 100 + d.d * 1000 + e.d * 10000 + f.d * 100000 + 1 from digits a cross join digits b cross join digits c cross join digits d cross join digits e cross join digits f)
      insert into channel_receipts (id, channel_id, provider_event_key_ciphertext, provider_event_key_ref, provider_event_key_revision,
        provider_event_key_hash, status, generation, created_at, updated_at)
      select 'receipt-' || x, 'channel-a', x'01', 'payload-ref', 1, 'hash-' || x, 'ignored', 1, '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z' from n where x <= 100000;
    `)

    const memoryBefore = process.memoryUsage().heapUsed
    const samples: number[] = []
    for (let run = 0; run < 3; run += 1) {
      // One eligible row per sample: the bulk rows sit on the cutoff and stay, so every run scans
      // the same 100,000 rows and deletes exactly the probe — the scan is what we measure.
      database.connection.exec(`
        insert into channel_receipts (id, channel_id, provider_event_key_ciphertext, provider_event_key_ref, provider_event_key_revision,
          provider_event_key_hash, status, generation, created_at, updated_at)
        values ('probe-${run}', 'channel-a', x'01', 'payload-ref', 1, 'probe-hash-${run}', 'ignored', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
      `)
      const started = performance.now()
      const result = repository.cleanupChannel('channel-a', new Date('2026-07-18T00:00:00.000Z'), 500)
      samples.push(performance.now() - started)
      // The budget is what is under test: one slice removes at most the configured page.
      expect(result.receipts).toBe(1)
    }
    const median = [...samples].sort((left, right) => left - right)[1]
    // Printed so the number in the ledger is reproducible, not remembered.
    console.info(`[measurement] cleanup samples(ms)=${JSON.stringify(samples.map((value) => Number(value.toFixed(1))))} median=${median.toFixed(1)}`)
    expect(median).toBeLessThan(1_000)
    expect(process.memoryUsage().heapUsed - memoryBefore).toBeLessThanOrEqual(64 * 1024 * 1024)
    expect(database.connection.prepare('select count(*) as count from channel_receipts').get()).toEqual({ count: 100000 })

    database.connection.exec(`
      with digits(d) as (values (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)),
      n(x) as (select a.d + b.d * 10 + c.d * 100 + d.d * 1000 + e.d * 10000 + 1 from digits a cross join digits b cross join digits c cross join digits d cross join digits e)
      insert into channel_inbound_work_items (id, receipt_id, channel_id, conversation_id, dispatch_id, payload_ciphertext,
        payload_key_ref, payload_key_revision, status, lease_expires_at, attempt_count, created_at, updated_at)
      select 'work-' || x, 'work-receipt-' || x, 'channel-a', 'conversation-budget', 'dispatch-' || x, x'01',
        'payload-ref', 1, 'completed', null, 1, '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z' from n where x <= 10001;
    `)
    const workCleanup = repository.cleanupChannel('channel-a', new Date('2026-07-18T00:00:00.000Z'), 500)
    expect(workCleanup.workItems).toBe(1)
    expect(database.connection.prepare('select count(*) as count from channel_inbound_work_items').get()).toEqual({ count: 10000 })
  })
})
