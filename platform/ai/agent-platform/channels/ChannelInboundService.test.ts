import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAgentPlatformDatabase, type AgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import type { ChannelPayloadCipher } from '../../../secrets/channels/channelCredentialContracts'
import { createAgentSqliteStore } from '../store/agentSqliteStore'
import type { ChannelInboundFacts } from './ChannelInboundContracts'
import { ChannelInboundRepository } from './ChannelInboundRepository'
import { ChannelInboundService } from './ChannelInboundService'
import { seedChannelAdapterSupport } from './channelTestSupport'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('ChannelInboundService', () => {
  it('isolates sessions per channel and provider conversation without persisting provider values in ordinary text columns', async () => {
    const { service, database, cipher } = createHarness()
    await allow(service, 'channel-a', 'user-a')
    await allow(service, 'channel-a', 'user-b')
    await allow(service, 'channel-b', 'user-a')
    const first = await receive(service, 'channel-a', { providerConversationKey: 'conversation-a', providerUserKey: 'user-a' })
    const second = await receive(service, 'channel-a', { providerConversationKey: 'conversation-b', providerUserKey: 'user-b', providerEventKey: 'event-b' })
    const third = await receive(service, 'channel-b', { providerConversationKey: 'conversation-a', providerUserKey: 'user-a', providerEventKey: 'event-c' })

    const sessions = database.connection.prepare('select agent_session_id from channel_conversations order by channel_id, id').all() as Array<{ agent_session_id: string }>
    expect(new Set(sessions.map((item) => item.agent_session_id)).size).toBe(3)
    const text = database.connection.prepare(
      `select group_concat(sql, '\n') as schema from sqlite_master where type = 'table' and name like 'channel_%'`
    ).get() as { schema: string }
    expect(text.schema).not.toContain('provider_event_key text')
    const dump = JSON.stringify(database.connection.prepare('select * from channel_conversations').all())
    expect(dump).not.toContain('conversation-a')
    expect(cipher.encrypt).toHaveBeenCalled()
  })

  it('requires explicit allow policy and structured mention for groups and channels, without turning discovery into targets', async () => {
    const { service, database, repository } = createHarness()
    await allow(service, 'channel-a', 'user-a', 'group')
    const groupWithoutMention = await receive(service, 'channel-a', { conversationKind: 'group', mentionedBot: false })
    const groupMention = await receive(service, 'channel-a', { providerEventKey: 'event-group-mention', conversationKind: 'group', mentionedBot: true })
    const channelWithoutMention = await receive(service, 'channel-a', { providerEventKey: 'event-channel-no-mention', conversationKind: 'channel', mentionedBot: false })
    const directDenied = await receive(service, 'channel-a', { providerEventKey: 'event-direct-denied', providerUserKey: 'user-x' })

    expect(groupWithoutMention.disposition).toBe('ignored')
    expect(groupMention.disposition).toBe('acknowledged')
    expect(channelWithoutMention.disposition).toBe('ignored')
    expect(directDenied.disposition).toBe('ignored')
    expect(database.connection.prepare('select count(*) as count from channel_delivery_targets').get()).toEqual({ count: 0 })
    expect(database.connection.prepare('select code from channel_runtime_audits order by created_at, id').all()).toEqual([
      { code: 'channel-mention-required' }, { code: 'channel-mention-required' }, { code: 'channel-policy-denied' }
    ])
  })

  it('claims concurrent duplicates once, acknowledges both, and never creates a second dispatch', async () => {
    const { service, database, repository } = createHarness()
    await allow(service, 'channel-a', 'user-a')
    const firstAck = vi.fn(async () => {})
    const secondAck = vi.fn(async () => {})
    const facts = baseFacts()
    const [first, second] = await Promise.all([
      service.receive({ ...facts, acknowledge: firstAck }),
      service.receive({ ...facts, acknowledge: secondAck })
    ])

    expect([first.disposition, second.disposition].sort()).toEqual(['acknowledged', 'duplicate'])
    expect(firstAck).toHaveBeenCalledTimes(1)
    expect(secondAck).toHaveBeenCalledTimes(1)
    expect(database.connection.prepare('select count(*) as count from channel_inbound_work_items').get()).toEqual({ count: 1 })
  })

  it('makes an acknowledged inbound work item immediately available only as a main-process ownership claim', async () => {
    const { service, repository, database } = createHarness()
    await allow(service, 'channel-a', 'user-a')
    const result = await receive(service, 'channel-a', { providerEventKey: 'initial-dispatch' })

    expect(result).toEqual({ disposition: 'acknowledged', dispatchId: expect.any(String) })
    expect(JSON.stringify(result)).not.toContain('leaseToken')
    const claim = service.takeInitialExecutionClaim(result.dispatchId!)
    expect(claim).toEqual(expect.objectContaining({ dispatchId: result.dispatchId, leaseToken: expect.any(String) }))
    expect(JSON.stringify(claim)).not.toContain('ciphertext')
    expect(service.takeInitialExecutionClaim(result.dispatchId!)).toBeNull()
    expect(repository.admitDispatch(claim!, new Date('2026-07-18T00:00:01.000Z'))).toEqual(
      expect.objectContaining({ ciphertext: expect.any(Uint8Array) })
    )
    expect(repository.admitDispatch(claim!, new Date('2026-07-18T00:00:01.000Z'))).toBeNull()
    expect(database.connection.prepare('select lease_token from channel_inbound_work_items').get()).toEqual({ lease_token: claim!.leaseToken })
  })

  it('notifies composition with only the opaque dispatch id after a successful acknowledgement', async () => {
    const { service, repository } = createHarness()
    const observed = vi.fn()
    ;(service as unknown as { deps: { onInitialClaimAvailable?: (dispatchId: string) => void } }).deps.onInitialClaimAvailable = observed
    await allow(service, 'channel-a', 'user-a')
    const result = await receive(service, 'channel-a', { providerEventKey: 'opaque-initial' })
    expect(observed).toHaveBeenCalledWith(result.dispatchId)
    expect(JSON.stringify(observed.mock.calls)).not.toContain('leaseToken')
    expect(JSON.stringify(observed.mock.calls)).not.toContain('ciphertext')
    // The private queue, rather than the callback, retains the actual ownership claim.
    expect(service.takeInitialExecutionClaim(result.dispatchId!)).toEqual(expect.objectContaining({ leaseToken: expect.any(String) }))
    expect(repository.reclaimExpired(new Date('2026-07-18T00:00:00.000Z'))).toEqual([])
  })

  it('requeues the original initial claim after an acknowledgement retry without duplicating durable work', async () => {
    const { service, repository, database } = createHarness()
    await allow(service, 'channel-a', 'user-a')
    const failedAck = vi.fn(async () => { throw new Error('provider acknowledgement failed') })
    const request = { ...baseFacts({ providerEventKey: 'ack-retry' }), acknowledge: failedAck }

    await expect(service.receive(request)).resolves.toEqual({ disposition: 'retry' })
    expect(database.connection.prepare('select count(*) as count from channel_receipts').get()).toEqual({ count: 1 })
    expect(database.connection.prepare('select count(*) as count from channel_inbound_work_items').get()).toEqual({ count: 1 })
    const durable = database.connection.prepare('select dispatch_id, lease_token, lease_expires_at, generation from channel_inbound_work_items join channel_receipts on channel_receipts.id = receipt_id').get() as {
      dispatch_id: string; lease_token: string; lease_expires_at: string; generation: number
    }

    const retryAck = vi.fn(async () => {})
    await expect(service.receive({ ...request, acknowledge: retryAck })).resolves.toEqual({ disposition: 'duplicate' })
    expect(retryAck).toHaveBeenCalledTimes(1)
    const claim = service.takeInitialExecutionClaim(durable.dispatch_id)
    expect(claim).toEqual({
      workItemId: expect.any(String), receiptId: expect.any(String), channelId: 'channel-a', dispatchId: durable.dispatch_id,
      generation: durable.generation, leaseToken: durable.lease_token, leaseExpiresAt: durable.lease_expires_at
    })
    expect(JSON.stringify(claim)).not.toContain('ciphertext')
    expect(repository.admitDispatch(claim!, new Date('2026-07-18T00:00:01.000Z'))).toEqual(expect.objectContaining({ ciphertext: expect.any(Uint8Array) }))
    expect(repository.admitDispatch(claim!, new Date('2026-07-18T00:00:01.000Z'))).toBeNull()
    expect(database.connection.prepare('select count(*) as count from channel_inbound_work_items').get()).toEqual({ count: 1 })
  })

  it('does not release an expired or fenced in-memory initial claim', async () => {
    const { service, repository, database } = createHarness()
    await allow(service, 'channel-a', 'user-a')
    const result = await receive(service, 'channel-a', { providerEventKey: 'stale-initial-claim' })
    const dispatch = result.dispatchId!
    repository.fence('channel-a', 'inactive')
    expect(service.takeInitialExecutionClaim(dispatch)).toBeNull()
    database.connection.prepare("update channel_inbound_work_items set lease_expires_at = '2000-01-01T00:00:00.000Z'").run()
    expect(repository.reclaimExpired(new Date('2026-07-18T00:00:00.000Z'))).toEqual([])
  })

  it('finalizes only the active dispatch owner and keeps terminal work out of recovery', async () => {
    const { service, repository } = createHarness()
    await allow(service, 'channel-a', 'user-a')
    const completed = await receive(service, 'channel-a', { providerEventKey: 'complete-dispatch' })
    const completeClaim = service.takeInitialExecutionClaim(completed.dispatchId!)
    if (!completeClaim) throw new Error('Expected initial claim.')
    expect(repository.admitDispatch(completeClaim, new Date('2026-07-18T00:00:01.000Z'))).toEqual(expect.objectContaining({ ciphertext: expect.any(Uint8Array) }))
    expect(repository.finalizeDispatch(completeClaim, 'completed', new Date('2026-07-18T00:00:02.000Z'))).toBe(true)
    expect(repository.finalizeDispatch(completeClaim, 'completed', new Date('2026-07-18T00:00:02.001Z'))).toBe(false)
    expect(repository.reclaimExpired(new Date('2026-07-19T00:00:00.000Z'))).toEqual([])

    const failed = await receive(service, 'channel-a', { providerEventKey: 'fail-dispatch' })
    const failClaim = service.takeInitialExecutionClaim(failed.dispatchId!)
    if (!failClaim) throw new Error('Expected initial claim.')
    expect(repository.admitDispatch(failClaim, new Date('2026-07-18T00:00:03.000Z'))).toEqual(expect.objectContaining({ ciphertext: expect.any(Uint8Array) }))
    expect(repository.finalizeDispatch(failClaim, 'failed', new Date('2026-07-18T00:00:04.000Z'))).toBe(true)
    expect(repository.reclaimExpired(new Date('2026-07-19T00:00:00.000Z'))).toEqual([])
  })

  it('renews a dispatch lease and rejects finalization by fenced or adopted prior owners', async () => {
    const { service, repository, database } = createHarness()
    await allow(service, 'channel-a', 'user-a')
    const result = await receive(service, 'channel-a', { providerEventKey: 'renew-dispatch' })
    const claim = service.takeInitialExecutionClaim(result.dispatchId!)
    if (!claim) throw new Error('Expected initial claim.')
    expect(repository.admitDispatch(claim, new Date('2026-07-18T00:00:01.000Z'))).toEqual(expect.objectContaining({ ciphertext: expect.any(Uint8Array) }))
    const renewed = repository.renewDispatchLease(claim, new Date('2026-07-18T00:00:02.000Z'), 120_000)
    if (!renewed) throw new Error('Expected renewed lease.')
    expect(repository.reclaimExpired(new Date('2026-07-18T00:01:01.000Z'))).toEqual([])
    repository.fence('channel-a', 'deleted')
    expect(repository.finalizeDispatch(renewed, 'completed', new Date('2026-07-18T00:01:02.000Z'))).toBe(false)
    expect(database.connection.prepare('select status from channel_inbound_work_items').get()).toEqual({ status: 'dispatching' })
  })

  it('returns a conversation binding only to the exact active dispatch owner', async () => {
    const { service, repository } = createHarness()
    await allow(service, 'channel-a', 'user-a')
    const result = await receive(service, 'channel-a', { providerEventKey: 'binding-owner' })
    const claim = service.takeInitialExecutionClaim(result.dispatchId!)
    if (!claim) throw new Error('Expected initial claim.')
    const admitted = repository.admitDispatch(claim, new Date('2026-07-18T00:00:01.000Z'))
    if (!admitted) throw new Error('Expected admission.')
    expect(repository.getConversationBinding({ claim, conversationId: admitted.conversationId, now: new Date('2026-07-18T00:00:01.000Z') })).toEqual({
      agentId: 'agent-1', sessionId: 'agent-1-session-1'
    })
    expect(repository.getConversationBinding({ claim: { ...claim, leaseToken: 'stale' }, conversationId: admitted.conversationId, now: new Date('2026-07-18T00:00:01.000Z') })).toBeNull()
  })

  it('does not acknowledge when SQLite work persistence fails or the callback generation is stale', async () => {
    const { service, database, repository } = createHarness()
    await allow(service, 'channel-a', 'user-a')
    database.connection.exec(`create trigger reject_work before insert on channel_inbound_work_items begin select raise(abort, 'busy'); end;`)
    const failedAck = vi.fn(async () => {})
    expect((await service.receive({ ...baseFacts(), acknowledge: failedAck })).disposition).toBe('retry')
    expect(failedAck).not.toHaveBeenCalled()
    expect(database.connection.prepare('select count(*) as count from channel_receipts').get()).toEqual({ count: 0 })
    database.connection.exec('drop trigger reject_work')
    repository.fence('channel-a')
    const staleAck = vi.fn(async () => {})
    expect((await service.receive({ ...baseFacts({ providerEventKey: 'stale-event' }), acknowledge: staleAck })).disposition).toBe('retry')
    expect(staleAck).not.toHaveBeenCalled()
  })

  it('rechecks generation immediately before acknowledgement after a lifecycle fence', async () => {
    const { service, repository } = createHarness()
    await allow(service, 'channel-a', 'user-a')
    const acknowledge = vi.fn(async () => {})
    ;(service as unknown as { deps: { beforeAcknowledge: () => Promise<void> } }).deps.beforeAcknowledge = async () => {
      repository.fence('channel-a')
    }

    expect((await service.receive({ ...baseFacts({ providerEventKey: 'fenced-before-ack' }), acknowledge })).disposition).toBe('retry')
    expect(acknowledge).not.toHaveBeenCalled()
  })

  it('does not let a caller revive a fenced generation and rejects a missing Agent binding', async () => {
    const { service, repository, database } = createHarness()
    await allow(service, 'channel-a', 'user-a')
    repository.fence('channel-a')
    expect(repository.start('channel-a')).toBe(3)
    repository.fence('channel-a')
    database.connection.prepare("delete from agent_entities where id = 'agent-1'").run()
    const acknowledge = vi.fn(async () => {})

    expect((await service.receive({ ...baseFacts({ generation: 4, providerEventKey: 'missing-agent' }), acknowledge })).disposition).toBe('retry')
    expect(acknowledge).not.toHaveBeenCalled()
    expect(database.connection.prepare("select code from channel_runtime_audits where code = 'channel-agent-missing'").all()).toHaveLength(1)
  })

  it('does not acknowledge when Vault encryption or keyed hashing fails', async () => {
    const { service, cipher, database } = createHarness()
    await allow(service, 'channel-a', 'user-a')
    cipher.keyedHash = async () => { throw new Error('vault unavailable') }
    const acknowledge = vi.fn(async () => {})

    expect(await service.receive({ ...baseFacts({ providerEventKey: 'hash-failure' }), acknowledge })).toEqual({ disposition: 'retry' })
    expect(acknowledge).not.toHaveBeenCalled()
    expect(database.connection.prepare('select count(*) as count from channel_receipts').get()).toEqual({ count: 0 })
  })

  it('rejects unverified attachments before persistence and acknowledgement', async () => {
    const { service, database } = createHarness()
    await allow(service, 'channel-a', 'user-a')
    const acknowledge = vi.fn(async () => {})
    const result = await service.receive({
      ...baseFacts({ attachments: [{ kind: 'file', stableRef: '', mimeType: 'application/octet-stream' }] }),
      acknowledge
    })

    expect(result).toEqual({ disposition: 'retry' })
    expect(acknowledge).not.toHaveBeenCalled()
    expect(database.connection.prepare('select count(*) as count from channel_receipts').get()).toEqual({ count: 0 })
  })

  it('rejects malformed external facts before acknowledgement or SQLite writes', async () => {
    const { service, database } = createHarness()
    await allow(service, 'channel-a', 'user-a')
    const invalidFacts: Array<Partial<ChannelInboundFacts>> = [
      { providerEventKey: 3 as unknown as string },
      { conversationKind: 'invalid' as 'direct' },
      { attachments: [{ kind: 'invalid' as 'file', stableRef: 'ref', mimeType: 'text/plain' }] },
      { attachments: [{ kind: 'file', stableRef: 'ref', mimeType: 'text/plain', sizeBytes: -1 }] },
      { attachments: [{ kind: 'file', stableRef: 'r'.repeat(513), mimeType: 'text/plain' }] }
    ]
    for (const facts of invalidFacts) {
      const acknowledge = vi.fn(async () => {})
      await expect(service.receive({ ...baseFacts(facts), acknowledge })).resolves.toEqual({ disposition: 'retry' })
      expect(acknowledge).not.toHaveBeenCalled()
    }
    expect(database.connection.prepare('select count(*) as count from channel_receipts').get()).toEqual({ count: 0 })
  })

  it('reclaims after restart with the same dispatch id and quarantines receipts that have no work item', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'channel-inbound-'))
    directories.push(directory)
    const path = join(directory, 'agent.sqlite')
    const first = createHarness(createAgentPlatformDatabase(path))
    await allow(first.service, 'channel-a', 'user-a')
    const result = await receive(first.service, 'channel-a')
    const dispatch = result.dispatchId!
    first.database.connection.prepare("update channel_inbound_work_items set lease_expires_at = '2000-01-01T00:00:00.000Z'").run()
    first.database.connection.close()

    const reopened = createHarness(createAgentPlatformDatabase(path), false)
    expect(reopened.repository.start('channel-a')).toBe(2)
    const reclaimed = reopened.repository.reclaimExpired(new Date('2026-07-18T00:00:00.000Z'))
    expect(reclaimed).toEqual([expect.objectContaining({ dispatchId: dispatch, generation: 2, leaseToken: expect.any(String) })])
    expect(JSON.stringify(reclaimed)).not.toContain('ciphertext')
    reopened.database.connection.prepare(
      `insert into channel_receipts (id, channel_id, provider_event_key_ciphertext, provider_event_key_ref, provider_event_key_revision,
        provider_event_key_hash, status, generation, created_at, updated_at)
       values ('orphan', 'channel-a', x'01', 'payload-ref', 1, 'orphan-hash', 'processing', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
    ).run()
    reopened.repository.reclaimExpired(new Date('2026-07-18T00:00:00.000Z'))
    expect(reopened.database.connection.prepare("select status from channel_receipts where id = 'orphan'").get()).toEqual({ status: 'quarantined' })
  })

  it('rejects a recovered execution claim after another connection fences its generation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'channel-inbound-fence-'))
    directories.push(directory)
    const path = join(directory, 'agent.sqlite')
    const first = createHarness(createAgentPlatformDatabase(path))
    await allow(first.service, 'channel-a', 'user-a')
    await receive(first.service, 'channel-a', { providerEventKey: 'recovery-fence' })
    first.database.connection.prepare("update channel_inbound_work_items set lease_expires_at = '2000-01-01T00:00:00.000Z'").run()

    const [claim] = first.repository.reclaimExpired(new Date('2026-07-18T00:00:00.000Z'))
    if (!claim) throw new Error('Expected recovery claim.')
    expect(claim).toEqual(expect.objectContaining({ generation: 1, leaseToken: expect.any(String) }))
    expect(JSON.stringify(claim)).not.toContain('ciphertext')

    const second = createAgentPlatformDatabase(path)
    new ChannelInboundRepository(second).fence('channel-a', 'inactive')
    second.connection.close()

    // A future dispatcher receives payload only from this final atomic admission gate.
    expect(first.repository.admitDispatch(claim, new Date('2026-07-18T00:00:01.000Z'))).toBeNull()
    expect(first.database.connection.prepare('select status from channel_inbound_work_items').get()).toEqual({ status: 'quarantined' })
    expect(first.database.connection.prepare('select status from channel_receipts').get()).toEqual({ status: 'quarantined' })
  })

  it('consumes a recovery claim once, so concurrent dispatcher retries cannot read its payload twice', async () => {
    const { service, repository, database } = createHarness()
    await allow(service, 'channel-a', 'user-a')
    const received = await receive(service, 'channel-a', { providerEventKey: 'single-admission' })
    database.connection.prepare("update channel_inbound_work_items set lease_expires_at = '2000-01-01T00:00:00.000Z'").run()
    const [claim] = repository.reclaimExpired(new Date('2026-07-18T00:00:00.000Z'))
    if (!claim) throw new Error('Expected recovery claim.')

    const [first, second] = await Promise.all([
      Promise.resolve(repository.admitDispatch(claim, new Date('2026-07-18T00:00:01.000Z'))),
      Promise.resolve(repository.admitDispatch(claim, new Date('2026-07-18T00:00:01.000Z')))
    ])

    expect([first, second].filter(Boolean)).toHaveLength(1)
    expect([first, second].find(Boolean)).toEqual(expect.objectContaining({ dispatchId: received.dispatchId, ciphertext: expect.any(Uint8Array) }))
    expect(JSON.stringify(claim)).not.toContain('ciphertext')
    expect(database.connection.prepare('select status from channel_inbound_work_items').get()).toEqual({ status: 'dispatching' })
    expect(database.connection.prepare('select status from channel_receipts').get()).toEqual({ status: 'dispatching' })
  })

  it('does not let an expired lease claim alter or read a newer recovery lease owner', async () => {
    const { service, repository, database } = createHarness()
    await allow(service, 'channel-a', 'user-a')
    await receive(service, 'channel-a', { providerEventKey: 'lease-owner-replaced' })
    database.connection.prepare("update channel_inbound_work_items set lease_expires_at = '2000-01-01T00:00:00.000Z'").run()
    const [firstClaim] = repository.reclaimExpired(new Date('2026-07-18T00:00:00.000Z'), 1_000)
    if (!firstClaim) throw new Error('Expected first recovery claim.')
    const [secondClaim] = repository.reclaimExpired(new Date('2026-07-18T00:00:02.000Z'))
    if (!secondClaim) throw new Error('Expected replacement recovery claim.')

    expect(repository.admitDispatch(firstClaim, new Date('2026-07-18T00:00:02.001Z'))).toBeNull()
    expect(database.connection.prepare('select status, lease_token from channel_inbound_work_items').get()).toEqual({
      status: 'processing', lease_token: secondClaim.leaseToken
    })
    expect(repository.admitDispatch(secondClaim, new Date('2026-07-18T00:00:02.001Z'))).toEqual(
      expect.objectContaining({ dispatchId: secondClaim.dispatchId, ciphertext: expect.any(Uint8Array) })
    )
  })

  it('leaves a naturally expired claim recoverable until reclaim assigns its next lease', async () => {
    const { service, repository, database } = createHarness()
    await allow(service, 'channel-a', 'user-a')
    const received = await receive(service, 'channel-a', { providerEventKey: 'natural-expiry' })
    database.connection.prepare("update channel_inbound_work_items set lease_expires_at = '2000-01-01T00:00:00.000Z'").run()
    const [expiredClaim] = repository.reclaimExpired(new Date('2026-07-18T00:00:00.000Z'), 1_000)
    if (!expiredClaim) throw new Error('Expected recovery claim.')

    expect(repository.admitDispatch(expiredClaim, new Date('2026-07-18T00:00:02.000Z'))).toBeNull()
    expect(database.connection.prepare('select status from channel_inbound_work_items').get()).toEqual({ status: 'processing' })
    expect(database.connection.prepare('select status from channel_receipts').get()).toEqual({ status: 'processing' })
    expect(database.connection.prepare("select count(*) as count from channel_runtime_audits where code = 'channel-lifecycle-fenced'").get()).toEqual({ count: 0 })

    const [nextClaim] = repository.reclaimExpired(new Date('2026-07-18T00:00:02.000Z'))
    if (!nextClaim) throw new Error('Expected replacement recovery claim.')
    expect(nextClaim).toEqual(expect.objectContaining({ dispatchId: received.dispatchId }))
    expect(nextClaim.leaseToken).not.toBe(expiredClaim.leaseToken)
    expect(repository.admitDispatch(nextClaim, new Date('2026-07-18T00:00:02.001Z'))).toEqual(
      expect.objectContaining({ dispatchId: received.dispatchId, ciphertext: expect.any(Uint8Array) })
    )
  })

  it('reclaims an admitted dispatch after restart with the same dispatch id and admits its new lease once', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'channel-inbound-admission-restart-'))
    directories.push(directory)
    const path = join(directory, 'agent.sqlite')
    const first = createHarness(createAgentPlatformDatabase(path))
    await allow(first.service, 'channel-a', 'user-a')
    const received = await receive(first.service, 'channel-a', { providerEventKey: 'admitted-restart' })
    first.database.connection.prepare("update channel_inbound_work_items set lease_expires_at = '2000-01-01T00:00:00.000Z'").run()
    const [firstClaim] = first.repository.reclaimExpired(new Date('2026-07-18T00:00:00.000Z'), 1_000)
    if (!firstClaim) throw new Error('Expected first recovery claim.')
    expect(first.repository.admitDispatch(firstClaim, new Date('2026-07-18T00:00:00.001Z'))).toEqual(
      expect.objectContaining({ dispatchId: received.dispatchId, ciphertext: expect.any(Uint8Array) })
    )
    first.database.connection.close()

    const reopened = createHarness(createAgentPlatformDatabase(path), false)
    expect(reopened.repository.start('channel-a')).toBe(2)
    const [recoveredClaim] = reopened.repository.reclaimExpired(new Date('2026-07-18T00:00:02.000Z'))
    if (!recoveredClaim) throw new Error('Expected admitted work to be recoverable.')
    expect(recoveredClaim.dispatchId).toBe(received.dispatchId)
    expect(JSON.stringify(recoveredClaim)).not.toContain('ciphertext')
    expect(reopened.repository.admitDispatch(recoveredClaim, new Date('2026-07-18T00:00:02.001Z'))).toEqual(
      expect.objectContaining({ dispatchId: received.dispatchId, ciphertext: expect.any(Uint8Array) })
    )
    expect(reopened.repository.admitDispatch(recoveredClaim, new Date('2026-07-18T00:00:02.001Z'))).toBeNull()
  })

  it('adopts expired work onto the active restart generation and rejects the prior claim', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'channel-inbound-generation-adoption-'))
    directories.push(directory)
    const path = join(directory, 'agent.sqlite')
    const first = createHarness(createAgentPlatformDatabase(path))
    await allow(first.service, 'channel-a', 'user-a')
    const received = await receive(first.service, 'channel-a', { providerEventKey: 'generation-adoption' })
    first.database.connection.prepare("update channel_inbound_work_items set lease_expires_at = '2000-01-01T00:00:00.000Z'").run()
    const [generationOneClaim] = first.repository.reclaimExpired(new Date('2026-07-18T00:00:00.000Z'), 1_000)
    if (!generationOneClaim) throw new Error('Expected generation one claim.')
    first.database.connection.close()

    const restarted = createHarness(createAgentPlatformDatabase(path), false)
    expect(restarted.repository.start('channel-a')).toBe(2)
    const [generationTwoClaim] = restarted.repository.reclaimExpired(new Date('2026-07-18T00:00:02.000Z'))
    if (!generationTwoClaim) throw new Error('Expected adopted generation two claim.')
    expect(generationTwoClaim).toEqual(expect.objectContaining({ generation: 2, dispatchId: received.dispatchId }))
    expect(restarted.repository.admitDispatch(generationOneClaim, new Date('2026-07-18T00:00:02.001Z'))).toBeNull()
    expect(restarted.database.connection.prepare('select status, generation from channel_receipts').get()).toEqual({ status: 'processing', generation: 2 })
    expect(restarted.repository.admitDispatch(generationTwoClaim, new Date('2026-07-18T00:00:02.001Z'))).toEqual(
      expect.objectContaining({ dispatchId: received.dispatchId, generation: 2, ciphertext: expect.any(Uint8Array) })
    )
    expect(restarted.repository.finalizeDispatch(generationOneClaim, 'completed', new Date('2026-07-18T00:00:02.002Z'))).toBe(false)
  })

  it('allows only the final active generation to admit work after rapid restarts', async () => {
    const { service, repository, database } = createHarness()
    await allow(service, 'channel-a', 'user-a')
    await receive(service, 'channel-a', { providerEventKey: 'rapid-generation' })
    database.connection.prepare("update channel_inbound_work_items set lease_expires_at = '2000-01-01T00:00:00.000Z'").run()
    const [generationOneClaim] = repository.reclaimExpired(new Date('2026-07-18T00:00:00.000Z'), 1_000)
    if (!generationOneClaim) throw new Error('Expected generation one claim.')
    expect(repository.start('channel-a')).toBe(2)
    const [generationTwoClaim] = repository.reclaimExpired(new Date('2026-07-18T00:00:02.000Z'), 1_000)
    if (!generationTwoClaim) throw new Error('Expected generation two claim.')
    expect(repository.start('channel-a')).toBe(3)
    const [generationThreeClaim] = repository.reclaimExpired(new Date('2026-07-18T00:00:04.000Z'))
    if (!generationThreeClaim) throw new Error('Expected generation three claim.')

    expect(repository.admitDispatch(generationOneClaim, new Date('2026-07-18T00:00:04.001Z'))).toBeNull()
    expect(repository.admitDispatch(generationTwoClaim, new Date('2026-07-18T00:00:04.001Z'))).toBeNull()
    expect(repository.admitDispatch(generationThreeClaim, new Date('2026-07-18T00:00:04.001Z'))).toEqual(
      expect.objectContaining({ generation: 3, ciphertext: expect.any(Uint8Array) })
    )
  })

  it('quarantines expired work after disable/delete fence instead of reclaiming it', async () => {
    const { service, repository, database } = createHarness()
    await allow(service, 'channel-a', 'user-a')
    const result = await receive(service, 'channel-a', { providerEventKey: 'fenced-recovery' })
    expect(result.disposition).toBe('acknowledged')
    database.connection.prepare("update channel_inbound_work_items set lease_expires_at = '2000-01-01T00:00:00.000Z'").run()
    repository.fence('channel-a', 'deleted')

    expect(repository.reclaimExpired(new Date('2026-07-18T00:00:00.000Z'))).toEqual([])
    expect(database.connection.prepare('select status from channel_inbound_work_items').get()).toEqual({ status: 'quarantined' })
    expect(database.connection.prepare('select status from channel_receipts').get()).toEqual({ status: 'quarantined' })
  })

  it('does not reclaim a candidate fenced after selection but before its lease CAS', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedRuntimeReadyChannel(database, 'channel-a')
    const repository = new ChannelInboundRepository(database, { beforeReclaimLease: () => repository.fence('channel-a') })
    repository.start('channel-a')
    database.connection.exec(`
      insert into channel_receipts (id, channel_id, provider_event_key_ciphertext, provider_event_key_ref, provider_event_key_revision,
        provider_event_key_hash, status, generation, created_at, updated_at)
      values ('race-receipt', 'channel-a', x'01', 'payload-ref', 1, 'race-hash', 'processing', 1,
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      insert into channel_inbound_work_items (id, receipt_id, channel_id, conversation_id, dispatch_id, payload_ciphertext,
        payload_key_ref, payload_key_revision, status, lease_expires_at, attempt_count, created_at, updated_at)
      values ('race-work', 'race-receipt', 'channel-a', 'conversation-race', 'dispatch-race', x'01',
        'payload-ref', 1, 'processing', '2000-01-01T00:00:00.000Z', 1,
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    `)

    expect(repository.reclaimExpired(new Date('2026-07-18T00:00:00.000Z'))).toEqual([])
    expect(database.connection.prepare("select status from channel_inbound_work_items where id = 'race-work'").get()).toEqual({ status: 'quarantined' })
  })

  it('replaces only the current conversation session for future /new semantics', async () => {
    const { service, database } = createHarness()
    await allow(service, 'channel-a', 'user-a')
    await receive(service, 'channel-a')
    const original = (database.connection.prepare(
      "select agent_session_id from channel_conversations where channel_id = 'channel-a'"
    ).get() as { agent_session_id: string }).agent_session_id
    const replacement = await service.startNewConversation({ channelId: 'channel-a', generation: 1, providerConversationKey: 'conversation-a' })
    expect(replacement).not.toBe(original)
  })

  it('compensates a stale /new session and serializes competing replacements', async () => {
    const { service, database, repository } = createHarness()
    await allow(service, 'channel-a', 'user-a')
    await receive(service, 'channel-a')
    const discarded: string[] = []
    let resolveSession: ((value: string) => void) | null = null
    let sessionCreationStarted: (() => void) | null = null
    const sessionCreation = new Promise<void>((resolve) => { sessionCreationStarted = resolve })
    ;(service as unknown as { deps: { sessions: { createForConversation: () => Promise<string>; discardUnbound: (sessionId: string) => Promise<void> } } }).deps.sessions = {
      createForConversation: () => new Promise((resolve) => {
        resolveSession = resolve
        sessionCreationStarted?.()
      }),
      discardUnbound: async (sessionId) => { discarded.push(sessionId) }
    }
    const replacing = service.startNewConversation({ channelId: 'channel-a', generation: 1, providerConversationKey: 'conversation-a' })
    await sessionCreation
    repository.fence('channel-a')
    resolveSession!('orphan-session')

    await expect(replacing).rejects.toThrow('Channel conversation session replacement failed.')
    expect(discarded).toEqual(['orphan-session'])
    expect(database.connection.prepare("select agent_session_id from channel_conversations where channel_id = 'channel-a'").get()).not.toEqual({ agent_session_id: 'orphan-session' })
  })

  it('uses one reservation across service instances for a rapid same-conversation restart', async () => {
    const { service, database, repository, cipher } = createHarness()
    await allow(service, 'channel-a', 'user-a')
    await receive(service, 'channel-a')
    const created: string[] = []
    const sessions = {
      createForConversation: async () => { const id = `session-race-${created.length + 1}`; created.push(id); return id },
      discardUnbound: async () => {}
    }
    const secondService = new ChannelInboundService({ repository, encryption: { cipher }, sessions })
    ;(service as unknown as { deps: { sessions: typeof sessions } }).deps.sessions = sessions
    const [first, second] = await Promise.allSettled([
      service.startNewConversation({ channelId: 'channel-a', generation: 1, providerConversationKey: 'conversation-a' }),
      secondService.startNewConversation({ channelId: 'channel-a', generation: 1, providerConversationKey: 'conversation-a' })
    ])

    expect([first.status, second.status].filter((state) => state === 'fulfilled')).toHaveLength(1)
    expect(created).toHaveLength(1)
    expect(database.connection.prepare("select count(*) as count from channel_conversation_session_operations").get()).toEqual({ count: 0 })
  })

  it('rejects admission before ack when 10,000 active work items fill the channel budget', async () => {
    const { service, database, repository } = createHarness()
    await allow(service, 'channel-a', 'user-a')
    seedActiveWork(database, 10_000)
    const acknowledge = vi.fn(async () => {})
    expect((await service.receive({ ...baseFacts({ providerEventKey: 'capacity-event' }), acknowledge })).disposition).toBe('retry')
    expect(acknowledge).not.toHaveBeenCalled()
    expect(repository.cleanupChannel('channel-a', new Date('2026-07-18T00:00:00.000Z'))).toEqual({ receipts: 0, workItems: 0 })
    expect(database.connection.prepare("select count(*) as count from channel_inbound_work_items where status = 'processing'").get()).toEqual({ count: 10000 })
  })

  it('does not create a conversation or Agent session for a new key when active work is saturated', async () => {
    const { service, database } = createHarness()
    await allow(service, 'channel-a', 'user-a')
    seedActiveWork(database, 10_000)
    const createSession = vi.fn(async () => 'must-not-be-created')
    ;(service as unknown as { deps: { sessions: { createForConversation: typeof createSession } } }).deps.sessions.createForConversation = createSession
    const acknowledge = vi.fn(async () => {})
    const before = database.connection.prepare('select count(*) as count from channel_conversations').get() as { count: number }

    expect(await service.receive({
      ...baseFacts({ providerEventKey: 'capacity-new-event', providerConversationKey: 'capacity-new-conversation' }), acknowledge
    })).toEqual({ disposition: 'retry' })
    expect(acknowledge).not.toHaveBeenCalled()
    expect(createSession).not.toHaveBeenCalled()
    expect(database.connection.prepare('select count(*) as count from channel_conversations').get()).toEqual(before)
    expect(database.connection.prepare("select count(*) as count from channel_receipts where provider_event_key_hash = 'hash:Y2FwYWNpdHktbmV3LWV2ZW50'").get()).toEqual({ count: 0 })
    expect(database.connection.prepare("select count(*) as count from channel_inbound_work_items where conversation_id = 'capacity-new-conversation'").get()).toEqual({ count: 0 })
  })

  it('compensates a newly created conversation and session when the final admission check loses a race', async () => {
    const { service, database, repository } = createHarness()
    await allow(service, 'channel-a', 'user-a')
    const discarded: string[] = []
    let sessionCreated = false
    ;(service as unknown as { deps: { sessions: { createForConversation: () => Promise<string>; discardUnbound: (sessionId: string) => Promise<void> } } }).deps.sessions = {
      createForConversation: async () => {
        sessionCreated = true
        seedActiveWork(database, 10_000)
        return 'race-session'
      },
      discardUnbound: async (sessionId) => { discarded.push(sessionId) }
    }
    const acknowledge = vi.fn(async () => {})

    expect(await service.receive({
      ...baseFacts({ providerEventKey: 'race-capacity-event', providerConversationKey: 'race-capacity-conversation' }), acknowledge
    })).toEqual({ disposition: 'retry' })
    expect(sessionCreated).toBe(true)
    expect(discarded).toEqual(['race-session'])
    expect(acknowledge).not.toHaveBeenCalled()
    expect(database.connection.prepare("select count(*) as count from channel_conversations where agent_session_id = 'race-session'").get()).toEqual({ count: 0 })
    expect(database.connection.prepare("select count(*) as count from channel_inbound_admission_reservations").get()).toEqual({ count: 0 })
    expect(repository.cleanupChannel('channel-a')).toEqual({ receipts: 0, workItems: 0 })
  })

  it('observes a real SQLite busy lock without acknowledgement', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'channel-inbound-busy-'))
    directories.push(directory)
    const path = join(directory, 'agent.sqlite')
    const harness = createHarness(createAgentPlatformDatabase(path))
    await allow(harness.service, 'channel-a', 'user-a')
    const lock = new DatabaseSync(path)
    lock.exec('begin exclusive')
    const acknowledge = vi.fn(async () => {})
    try {
      expect((await harness.service.receive({ ...baseFacts({ providerEventKey: 'busy-event' }), acknowledge })).disposition).toBe('retry')
      expect(acknowledge).not.toHaveBeenCalled()
    } finally {
      lock.exec('rollback')
      lock.close()
      harness.database.connection.close()
    }
  })

  it('uses bounded pagination for the fixed 100,000 receipt and 10,000 work-item budgets', () => {
    const { database, repository } = createHarness()
    database.connection.exec(`
      with digits(d) as (values (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)),
      n(x) as (select a.d + b.d * 10 + c.d * 100 + d.d * 1000 + e.d * 10000 + f.d * 100000 + 1 from digits a cross join digits b cross join digits c cross join digits d cross join digits e cross join digits f)
      insert into channel_receipts (id, channel_id, provider_event_key_ciphertext, provider_event_key_ref, provider_event_key_revision,
        provider_event_key_hash, status, generation, created_at, updated_at)
      select 'receipt-' || x, 'channel-a', x'01', 'payload-ref', 1, 'hash-' || x, 'ignored', 1, '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z' from n where x <= 100001;
    `)
    const memoryBefore = process.memoryUsage().heapUsed
    const started = performance.now()
    const result = repository.cleanupChannel('channel-a', new Date('2026-07-18T00:00:00.000Z'), 500)
    expect(result.receipts).toBe(1)
    expect(performance.now() - started).toBeLessThan(1_000)
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

  it('cleans expired maintenance records in stable 500-row pages', () => {
    const { database, repository } = createHarness()
    database.connection.exec(`
      with digits(d) as (values (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)),
      n(x) as (select a.d + b.d * 10 + c.d * 100 + 1 from digits a cross join digits b cross join digits c)
      insert into channel_receipts (id, channel_id, provider_event_key_ciphertext, provider_event_key_ref, provider_event_key_revision,
        provider_event_key_hash, status, generation, created_at, updated_at)
      select 'expired-' || x, 'channel-a', x'01', 'payload-ref', 1, 'expired-hash-' || x, 'ignored', 1,
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z' from n where x <= 501;
    `)
    const first = repository.cleanupPage('channel-a', null, new Date('2026-07-18T00:00:00.000Z'))
    const second = repository.cleanupPage('channel-a', first.nextCursor, new Date('2026-07-18T00:00:00.000Z'))

    expect(first.receipts).toBe(500)
    expect(first.workItems).toBe(0)
    expect(first.nextCursor).toEqual(expect.any(String))
    expect(second.receipts).toBe(1)
    expect(second.nextCursor).toBeNull()
    expect(database.connection.prepare("select count(*) as count from channel_receipts where id like 'expired-%'").get()).toEqual({ count: 0 })
  })

  it('pages failed and quarantined terminal work but never processing or unknown work', () => {
    const { database, repository } = createHarness()
    database.connection.exec(`
      with digits(d) as (values (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)),
      n(x) as (select a.d + b.d * 10 + c.d * 100 + 1 from digits a cross join digits b cross join digits c)
      insert into channel_inbound_work_items (id, receipt_id, channel_id, conversation_id, dispatch_id, payload_ciphertext,
        payload_key_ref, payload_key_revision, status, lease_expires_at, attempt_count, created_at, updated_at)
      select 'terminal-' || x, 'terminal-receipt-' || x, 'channel-a', 'conversation-terminal', 'dispatch-terminal-' || x, x'01',
        'payload-ref', 1, case when x % 2 = 0 then 'failed' else 'quarantined' end, null, 1,
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z' from n where x <= 501;
      insert into channel_inbound_work_items (id, receipt_id, channel_id, conversation_id, dispatch_id, payload_ciphertext,
        payload_key_ref, payload_key_revision, status, lease_expires_at, attempt_count, created_at, updated_at)
      values ('processing-retained', 'processing-receipt', 'channel-a', 'conversation-active', 'dispatch-active', x'01',
        'payload-ref', 1, 'processing', '2000-01-01T00:00:00.000Z', 1,
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
       ('unknown-retained', 'unknown-receipt', 'channel-a', 'conversation-active', 'dispatch-unknown', x'01',
        'payload-ref', 1, 'unknown-after-restart', null, 1,
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    `)
    const first = repository.cleanupPage('channel-a', null, new Date('2026-07-18T00:00:00.000Z'))
    const second = repository.cleanupPage('channel-a', first.nextCursor, new Date('2026-07-18T00:00:00.000Z'))

    expect(first.workItems).toBe(500)
    expect(second.workItems).toBe(1)
    expect(database.connection.prepare("select count(*) as count from channel_inbound_work_items where id in ('processing-retained', 'unknown-retained')").get()).toEqual({ count: 2 })
  })

  it('keeps encrypted inbound tables out of AgentStore state and has no safe view reader', async () => {
    const { service, database } = createHarness()
    await allow(service, 'channel-a', 'user-a')
    await receive(service, 'channel-a', { text: 'provider body must stay encrypted' })
    database.connection.prepare("update agent_channels set migration_state = 'completed' where id = 'channel-a'").run()

    const state = await createAgentSqliteStore(database).getState()
    expect(JSON.stringify(state)).not.toContain('provider body must stay encrypted')
    expect(JSON.stringify(state)).not.toContain('conversation-a')
    expect(state).not.toHaveProperty('channelReceipts')
    expect(state).not.toHaveProperty('channelInboundWorkItems')
  })
})

function createHarness(database = createAgentPlatformDatabase(':memory:'), seed = true): {
  database: AgentPlatformDatabase; repository: ChannelInboundRepository; service: ChannelInboundService; cipher: ChannelPayloadCipher & { encrypt: ReturnType<typeof vi.fn> }
} {
  if (seed) seedRuntimeReadyChannel(database, 'channel-a')
  if (seed) seedRuntimeReadyChannel(database, 'channel-b')
  const cipher = createCipher()
  const repository = new ChannelInboundRepository(database)
  if (seed) { repository.start('channel-a'); repository.start('channel-b') }
  let sequence = 0
  return {
    database,
    repository,
    cipher,
    service: new ChannelInboundService({
      repository,
      encryption: { cipher },
      sessions: { createForConversation: async ({ agentId }) => `${agentId}-session-${++sequence}`, discardUnbound: async () => {} },
      now: () => new Date('2026-07-18T00:00:00.000Z')
    })
  }
}

function createCipher(): ChannelPayloadCipher & { encrypt: ReturnType<typeof vi.fn> } {
  const encrypt = vi.fn(async (_channelId: string, value: Uint8Array) => ({
    ciphertext: Uint8Array.from(value, (byte) => byte ^ 0xa5), keyRef: 'channel-payload-key:opaque', keyRevision: 1
  }))
  return {
    encrypt,
    decrypt: async () => new Uint8Array(),
    keyedHash: async (_channelId, value) => `hash:${Buffer.from(value).toString('base64url')}`,
    rotate: async () => ({ keyRef: 'channel-payload-key:opaque', keyRevision: 1 }),
    revoke: async () => {}
  }
}

function seedRuntimeReadyChannel(database: AgentPlatformDatabase, id: string): void {
  database.connection.prepare(
    `insert or ignore into agent_entities (
      id, type, name, mcps_json, disabled_tools_json, order_key, created_at, updated_at
    ) values ('agent-1', 'general', 'Agent', '[]', '[]', '0', '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z')`
  ).run()
  database.connection.prepare(
    `insert into agent_channels (id, type, name, agent_id, requested_enabled, migration_state, created_at, updated_at)
     values (?, 'telegram', ?, 'agent-1', 1, 'runtime-ready', '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z')`
  ).run(id, id)
  seedChannelAdapterSupport(database, ['telegram'])
}

function seedActiveWork(database: AgentPlatformDatabase, count: number): void {
  database.connection.exec(`
    with digits(d) as (values (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)),
    n(x) as (select a.d + b.d * 10 + c.d * 100 + d.d * 1000 + e.d * 10000 + 1 from digits a cross join digits b cross join digits c cross join digits d cross join digits e)
    insert into channel_inbound_work_items (id, receipt_id, channel_id, conversation_id, dispatch_id, payload_ciphertext,
      payload_key_ref, payload_key_revision, status, lease_expires_at, attempt_count, created_at, updated_at)
    select 'active-work-' || x, 'active-receipt-' || x, 'channel-a', 'conversation-capacity', 'active-dispatch-' || x, x'01',
      'payload-ref', 1, 'processing', '2099-01-01T00:00:00.000Z', 1, '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z' from n where x <= ${count};
  `)
}

function allow(service: ChannelInboundService, channelId: string, userKey: string, kind?: 'direct' | 'group' | 'channel'): Promise<void> {
  return service.allow({ channelId, subjectType: 'user', key: userKey, conversationKind: kind })
}

async function receive(service: ChannelInboundService, channelId: string, overrides: Partial<ChannelInboundFacts> = {}) {
  return service.receive({ ...baseFacts(overrides), channelId, acknowledge: async () => {} })
}

function baseFacts(overrides: Partial<ChannelInboundFacts> = {}): ChannelInboundFacts {
  return { channelId: 'channel-a', generation: 1, providerEventKey: 'event-a', providerConversationKey: 'conversation-a', providerUserKey: 'user-a', conversationKind: 'direct', mentionedBot: false, text: 'secret body', ...overrides }
}
