import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { createAgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { ChannelAdapterAcceptanceRegistry } from './ChannelAdapterAcceptanceRegistry'
import { ChannelManagementRepository } from './ChannelManagementRepository'
import { ChannelManagementService } from './ChannelManagementService'
import { ChannelSecureHandoff } from './ChannelSecureHandoff'
import { seedChannelAdapterSupport } from './channelTestSupport'

/**
 * 凭据**写完必须落定**这条链的回归用例。
 *
 * 之前的单测为什么没抓到线上必挂的 bug：替身只认 `known-ref`，比真实现宽松得多；而真实仓库对
 * 预留记录（`putReserved` 写进来的那种**唯一**写入形态）一律拒绝 `inspectSafe` / `rotateIfRotation`。
 * 于是「存了却读不出来」「换 Token 永远失败」「启用第一关就被拒」三条同时成立，而单测全绿。
 *
 * 这里的替身按**真实现语义**写：
 * - 预留记录能读（`inspectReserved`）、能落定（`settleReserved`），但 `inspectSafe` 与
 *   `rotateIfRevision` 一律拒绝；
 * - 落定 = 原地改写成普通记录、`revision + 1`、抹掉迁移身份与清理令牌；
 * - ref 是 `f(channelId, 值)`，同一把值必然算出同一个 ref（恢复时要靠它重算 permit）。
 *
 * 教训：替身要比真实现更严格，不能更宽松。
 */

type VaultRecord = {
  channelId: string
  type: string
  value: Record<string, string>
  revision: number
  reserved: boolean
  cleanupToken?: string
  receipt?: { channelId: string; operationId: string; mutationEpoch: number }
}

const unavailable = (): Error => new Error('unavailable')

function canonical(value: Record<string, string>): string {
  return JSON.stringify(Object.entries(value).sort(([left], [right]) => (left < right ? -1 : 1)))
}

function createMemoryVault() {
  const records = new Map<string, VaultRecord>()
  let failNextSettle = false
  const view = (ref: string, record: VaultRecord) => ({ credentialRef: ref, revision: record.revision, maskedFields: { bot_token: '********' } })

  const vault = {
    async prepareMigration(input: { channelId: string; value: Record<string, string> }) {
      const sourceFingerprint = canonical(input.value)
      const digest = createHash('sha256').update(sourceFingerprint).digest('base64url')
      const credentialRef = `channel-migration:${input.channelId}:${digest}`
      return { credentialRef, sourceFingerprint, fingerprintKeyId: 'key-1', migrationPermit: `permit:${credentialRef}` }
    },
    async putReserved(input: { channelId: string; type: string; value: Record<string, string>; credentialRef: string }) {
      const existing = records.get(input.credentialRef)
      if (existing) {
        if (existing.reserved !== true) throw unavailable()
        if (canonical(existing.value) !== canonical(input.value)) throw unavailable()
        // 同一把值重复写 = 采纳这条记录并取消别人的清理令牌。
        delete existing.cleanupToken
        return view(input.credentialRef, existing)
      }
      const record: VaultRecord = { channelId: input.channelId, type: input.type, value: { ...input.value }, revision: 1, reserved: true }
      records.set(input.credentialRef, record)
      return view(input.credentialRef, record)
    },
    async settleReserved(input: { credentialRef: string; expectedRevision: number }) {
      if (failNextSettle) { failNextSettle = false; throw unavailable() }
      const record = records.get(input.credentialRef)
      if (!record || !record.reserved || record.revision !== input.expectedRevision) throw unavailable()
      const settled: VaultRecord = {
        channelId: record.channelId,
        type: record.type,
        value: record.value,
        revision: record.revision + 1,
        reserved: false
      }
      records.set(input.credentialRef, settled)
      return view(input.credentialRef, settled)
    },
    async inspectSafe(ref: string) {
      const record = records.get(ref)
      if (!record) return null
      if (record.reserved) throw unavailable()
      return view(ref, record)
    },
    async get(ref: string) { return records.get(ref)?.value ?? null },
    async has(ref: string) { return records.has(ref) },
    async rotate(_ref: string): Promise<never> { throw unavailable() },
    async put(): Promise<never> { throw unavailable() },
    async rotateIfRevision(ref: string, expectedRevision: number, value: Record<string, string>, mutation: { channelId: string; operationId: string; mutationEpoch: number }) {
      const record = records.get(ref)
      if (!record || record.reserved || record.revision !== expectedRevision) throw unavailable()
      record.value = { ...value }
      record.revision += 1
      record.receipt = { channelId: mutation.channelId, operationId: mutation.operationId, mutationEpoch: mutation.mutationEpoch }
      return view(ref, record)
    },
    async inspectMutationReceipt(ref: string) {
      const record = records.get(ref)
      if (!record || record.reserved || !record.receipt) return null
      return { credentialRef: ref, revision: record.revision, ...record.receipt }
    },
    async inspectReserved(input: { credentialRef: string }) {
      const record = records.get(input.credentialRef)
      if (!record) return null
      if (!record.reserved) throw unavailable()
      return view(input.credentialRef, record)
    },
    async delete(ref: string) { records.delete(ref) },
    async claimReservedCleanup(input: { credentialRef: string }) {
      const record = records.get(input.credentialRef)
      if (!record) return null
      if (!record.reserved) throw unavailable()
      record.cleanupToken = `cleanup-${record.revision}`
      return { revision: record.revision, cleanupToken: record.cleanupToken }
    },
    async deleteReservedIfCleanupClaim(input: { credentialRef: string; expectedRevision: number; cleanupToken: string }) {
      const record = records.get(input.credentialRef)
      if (!record) return false
      if (!record.reserved || record.revision !== input.expectedRevision || record.cleanupToken !== input.cleanupToken) return false
      records.delete(input.credentialRef)
      return true
    },
    async deleteReservedIfRevision(input: { credentialRef: string; expectedRevision: number }) {
      const record = records.get(input.credentialRef)
      if (!record || !record.reserved || record.revision !== input.expectedRevision) return false
      records.delete(input.credentialRef)
      return true
    },
    async deleteIfRevision(input: { credentialRef: string; expectedRevision: number }) {
      const record = records.get(input.credentialRef)
      if (!record || record.revision !== input.expectedRevision) return false
      records.delete(input.credentialRef)
      return true
    },
    // ── 测试观察口 ──
    reservedRefs: () => [...records.entries()].filter(([, record]) => record.reserved).map(([ref]) => ref),
    refs: () => [...records.keys()],
    revisionOf: (ref: string) => records.get(ref)?.revision ?? null,
    failNextSettle: () => { failNextSettle = true }
  }
  return vault
}

function supportedTelegramEntry() {
  return {
    adapterType: 'telegram' as const, adapterVersion: 'release-a', status: 'supported' as const,
    capabilities: { receiveText: true, receiveImages: false, receiveFiles: false, sendText: true, streaming: false, typingIndicator: false, nativeCommands: false, groupMention: false, qrEnrollment: false, reconnect: true },
    receiveSmokeAt: '2026-11-04', sendSmokeAt: '2026-11-04', reconnectSmokeAt: '2026-11-04', restartRecoveryAt: '2026-11-04', proxySmokeAt: '2026-11-04', credentialRotationAt: '2026-11-04', disableDeleteFencingAt: '2026-11-04', capabilityEvidence: {}
  }
}

function createCipher() {
  return {
    encrypt: async () => ({ ciphertext: new Uint8Array([1]), keyRef: 'k', keyRevision: 1 }),
    decrypt: async () => new Uint8Array(),
    keyedHash: async () => 'hash',
    rotate: async () => ({ keyRef: 'k', keyRevision: 1 }),
    revoke: async () => undefined,
    destroy: async () => undefined
  }
}

function createHarness(options: { withRuntime?: boolean } = {}) {
  const database = createAgentPlatformDatabase(':memory:')
  seedChannelAdapterSupport(database, ['telegram'])
  database.connection.exec(`insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at)
    values('agent-a','custom','Agent','[]','[]','a','2026-11-04','2026-11-04')`)
  const repository = new ChannelManagementRepository(database)
  const vault = createMemoryVault()
  const service = new ChannelManagementService({
    repository,
    vault: vault as never,
    cipher: createCipher() as never,
    registry: new ChannelAdapterAcceptanceRegistry([supportedTelegramEntry()]),
    handoff: new ChannelSecureHandoff(),
    now: () => new Date('2026-11-04T03:00:00.000Z'),
    ...(options.withRuntime ? { runtime: { start: async () => { throw new Error('fetch failed') }, stop: () => {} } } : {})
  })
  return { database, repository, vault, service }
}

async function handoffOf(service: ChannelManagementService, id: string, token: string) {
  const begin = await service.beginCredential({ id, senderId: 7 })
  const { webcrypto } = await import('node:crypto')
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const main = await webcrypto.subtle.importKey('jwk', begin.mainPublicJwk as JsonWebKey, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const bits = await webcrypto.subtle.deriveBits({ name: 'ECDH', public: main }, pair.privateKey, 256)
  const key = await webcrypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt'])
  const iv = new Uint8Array(12)
  const aad = new TextEncoder().encode(`${begin.sessionId}:${id}:credential`)
  const ciphertext = new Uint8Array(await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad },
    key,
    new TextEncoder().encode(JSON.stringify({ bot_token: token }))
  ))
  return { sessionId: begin.sessionId, rendererPublicJwk: await webcrypto.subtle.exportKey('jwk', pair.publicKey), iv, ciphertext }
}

function pendingStates(database: ReturnType<typeof createAgentPlatformDatabase>, channelId: string): number {
  const row = database.connection.prepare(
    `select count(*) as count from channel_management_operations
     where channel_id = ? and state in ('reserved','needs-recovery','external-inflight','revoked-cleanup','revoked-inflight')`
  ).get(channelId) as { count: number }
  return row.count
}

describe('credential writes settle the reserved record', () => {
  it('rotates a credential that was written as a reserved record instead of failing', async () => {
    const { database, service, vault } = createHarness()
    const id = service.create({ type: 'telegram', name: 'test', agentId: 'agent-a', actorId: 'user-a' }).channel!.id

    // 1) 新建频道：provision（putReserved → settleReserved → setCredential）
    await expect(Promise.resolve(service.provision({ id, actorId: 'user-a', senderId: 7, handoff: await handoffOf(service, id, '111:first'), purpose: 'credential' } as never)))
      .resolves.toMatchObject({ ok: true })
    // ① provision 结束后 Vault 里不许留预留记录
    expect(vault.reservedRefs()).toEqual([])
    const metadata = database.connection.prepare('select credential_ref, credential_revision from agent_channels where id = ?').get(id) as { credential_ref: string; credential_revision: number }
    // ② 元数据写的是**落定后**的 revision（预留 1 → 普通 2），否则 verifyCredential 仍判 unavailable
    expect(metadata.credential_revision).toBe(2)
    expect(await vault.inspectSafe(metadata.credential_ref)).toMatchObject({ revision: 2 })

    // 2) 编辑弹层的顺序：先 update，再换 Token
    expect(service.update({ id, name: 'test', agentId: 'agent-a', actorId: 'user-a' })).toMatchObject({ ok: true })
    const rotated = await Promise.resolve(service.rotate({ id, actorId: 'user-a', senderId: 7, handoff: await handoffOf(service, id, '222:second') }))
    expect(rotated).toMatchObject({ ok: true })
    expect(service.get(id)?.credential.status).toBe('configured')
    expect(vault.revisionOf(metadata.credential_ref)).toBe(3)
    expect(pendingStates(database, id)).toBe(0)

    // 连换两次也不许留下卡住的操作
    const again = await Promise.resolve(service.rotate({ id, actorId: 'user-a', senderId: 7, handoff: await handoffOf(service, id, '333:third') }))
    expect(again).toMatchObject({ ok: true })
    expect(pendingStates(database, id)).toBe(0)
    expect(vault.reservedRefs()).toEqual([])
  })

  it('no longer reports a settled credential as unavailable when enabling', async () => {
    const { service, vault } = createHarness({ withRuntime: true })
    const id = service.create({ type: 'telegram', name: 'test', agentId: 'agent-a', actorId: 'user-a' }).channel!.id
    await expect(Promise.resolve(service.provision({ id, actorId: 'user-a', senderId: 7, handoff: await handoffOf(service, id, '111:first'), purpose: 'credential' } as never)))
      .resolves.toMatchObject({ ok: true })
    expect(vault.reservedRefs()).toEqual([])

    // ③ 启用不再被「凭据读不出来」拦住：这里在运行时启动那一关失败（网络），说明凭据检查已经过了。
    const enabled = await Promise.resolve(service.requestEnable({ id, actorId: 'user-a' }))
    expect(enabled.code).not.toBe('channel-credential-unavailable')
    expect(enabled.code).toBe('adapter-runtime-start-failed')
  })

  it('self-heals a crash between putReserved and settleReserved on restart', async () => {
    const { database, repository, service, vault } = createHarness()
    const id = service.create({ type: 'telegram', name: 'test', agentId: 'agent-a', actorId: 'user-a' }).channel!.id
    const value = { bot_token: '111:first' }
    const reservation = await vault.prepareMigration({ channelId: id, value })
    await vault.putReserved({ channelId: id, type: 'telegram', value, ...reservation })
    const operationId = '5c0d3c0e-1f43-4f0e-9a35-6a4a4c0e11aa'
    const now = '2026-11-04T03:00:00.000Z'
    repository.reserveOperation({
      id: operationId, channelId: id, purpose: 'provision', ref: reservation.credentialRef,
      fingerprint: reservation.sourceFingerprint, keyId: reservation.fingerprintKeyId,
      permit: reservation.migrationPermit, now
    })
    // 模拟进程在「写进去」与「落定」之间消失：日志停在 external-inflight，记录还是预留形态。
    database.connection.prepare("update channel_management_operations set state = 'external-inflight' where id = ?").run(operationId)
    expect(vault.reservedRefs()).toEqual([reservation.credentialRef])

    await service.recover()

    expect(vault.reservedRefs()).toEqual([])
    expect(database.connection.prepare('select credential_ref, credential_revision, credential_health from agent_channels where id = ?').get(id)).toMatchObject({
      credential_ref: reservation.credentialRef,
      credential_revision: 2,
      credential_health: 'configured'
    })
    expect(database.connection.prepare('select state from channel_management_operations where id = ?').get(operationId)).toEqual({ state: 'completed' })

    // 恢复之后这条凭据是能用的：换 Token 走正常轮换而不是再写一次。
    const rotated = await Promise.resolve(service.rotate({ id, actorId: 'user-a', senderId: 7, handoff: await handoffOf(service, id, '222:second') }))
    expect(rotated).toMatchObject({ ok: true })
    expect(vault.revisionOf(reservation.credentialRef)).toBe(3)
  })

  it('self-heals the historical broken channel without deleting or recreating it', async () => {
    const { database, repository, service, vault } = createHarness({ withRuntime: true })
    const id = service.create({ type: 'telegram', name: 'test', agentId: 'agent-a', actorId: 'user-a' }).channel!.id
    const value = { bot_token: '111:first' }
    const reservation = await vault.prepareMigration({ channelId: id, value })
    await vault.putReserved({ channelId: id, type: 'telegram', value, ...reservation })
    // 用户库里那条坏记录的真实形态：元数据指向**预留** ref（revision 1、unavailable），日志里压着失败的 rotate。
    database.connection.prepare(
      "update agent_channels set credential_ref = ?, credential_revision = 1, credential_health = 'unavailable', lifecycle_state = 'disabled' where id = ?"
    ).run(reservation.credentialRef, id)
    const operationId = '9f4c9a52-6d5b-4f2a-9d0e-3b7c1a2e4f60'
    repository.reserveOperation({
      id: operationId, channelId: id, purpose: 'rotate', ref: reservation.credentialRef,
      expectedRevision: 1, now: '2026-11-04T03:00:00.000Z'
    })
    database.connection.prepare("update channel_management_operations set state = 'revoked-cleanup' where id = ?").run(operationId)
    // 那一夜失败的操作还留下了自己的生命周期 owner 行：它不清掉，用户下次点启用/保存会被永久挡住。
    database.connection.prepare("update channel_management_operations set lifecycle_owner_token = 'owner-crashed' where id = ?").run(operationId)
    database.connection.exec(`insert into channel_telegram_lifecycle_operations(channel_id, owner_token, purpose, generation, created_at, updated_at)
      values('${id}', 'owner-crashed', 'mutation', null, '2026-11-04T03:00:00.000Z', '2026-11-04T03:00:00.000Z')`)

    await service.recover()

    // ⑤ 不删、不改数据，重启后凭据可读、能进启用流程
    expect(vault.reservedRefs()).toEqual([])
    expect(database.connection.prepare('select credential_revision, credential_health from agent_channels where id = ?').get(id)).toEqual({
      credential_revision: 2,
      credential_health: 'configured'
    })
    expect(database.connection.prepare('select state, stable_error_code from channel_management_operations where id = ?').get(operationId)).toEqual({
      state: 'abandoned',
      stable_error_code: 'channel-credential-settled'
    })
    expect(service.get(id)?.credential.status).toBe('configured')
    // 卡住那笔操作自己的 owner 行必须一起清掉，否则下一次启用会被「这个频道已有 owner」挡住。
    expect(database.connection.prepare('select count(*) as count from channel_telegram_lifecycle_operations where channel_id = ?').get(id)).toEqual({ count: 0 })
    const enabled = await Promise.resolve(service.requestEnable({ id, actorId: 'user-a' }))
    expect(enabled.code).not.toBe('channel-credential-unavailable')
    // 用户能在原频道上继续动作（这一次走真的轮换，而不是再写一条）。
    const rotated = await Promise.resolve(service.rotate({ id, actorId: 'user-a', senderId: 7, handoff: await handoffOf(service, id, '222:after-recovery') }))
    expect(rotated).toMatchObject({ ok: true })
    expect(vault.revisionOf(reservation.credentialRef)).toBe(3)
  })

  it('saving over an unreadable credential switches the ref and retires the old reserved record', async () => {
    const { database, repository, service, vault } = createHarness()
    const id = service.create({ type: 'telegram', name: 'test', agentId: 'agent-a', actorId: 'user-a' }).channel!.id
    const oldValue = { bot_token: '111:old' }
    const oldReservation = await vault.prepareMigration({ channelId: id, value: oldValue })
    await vault.putReserved({ channelId: id, type: 'telegram', value: oldValue, ...oldReservation })
    database.connection.prepare(
      "update agent_channels set credential_ref = ?, credential_revision = 1, credential_health = 'unavailable', lifecycle_state = 'disabled' where id = ?"
    ).run(oldReservation.credentialRef, id)

    const saved = await Promise.resolve(service.rotate({ id, actorId: 'user-a', senderId: 7, handoff: await handoffOf(service, id, '222:new') }))
    expect(saved).toMatchObject({ ok: true })
    const metadata = database.connection.prepare('select credential_ref, credential_revision, credential_health from agent_channels where id = ?').get(id) as {
      credential_ref: string; credential_revision: number; credential_health: string
    }
    expect(metadata.credential_ref).not.toBe(oldReservation.credentialRef)
    expect(metadata.credential_revision).toBe(2)
    expect(metadata.credential_health).toBe('configured')
    // 旧值（旧 Token）必须从盘上清掉，并且不许留下任何预留记录
    expect(vault.refs()).not.toContain(oldReservation.credentialRef)
    expect(vault.reservedRefs()).toEqual([])
    expect(pendingStates(database, id)).toBe(0)
    expect(repository.credentialReferences(id, oldReservation.credentialRef)).toBe(false)
  })

  it('gives up on an operation that can never recover, with bounded retries and an audit row', async () => {
    const { database, repository, service } = createHarness()
    const id = service.create({ type: 'telegram', name: 'test', agentId: 'agent-a', actorId: 'user-a' }).channel!.id
    const value = { bot_token: '111:first' }
    const reservation = await service.beginCredential({ id, senderId: 7 })
    void reservation
    const migration = await createMemoryVault().prepareMigration({ channelId: id, value })
    const operationId = '1d2a3b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b'
    // rotate 却缺 expected_revision：恢复永远判不出来，以前每次启动都 defer 一次、永远压着。
    repository.reserveOperation({ id: operationId, channelId: id, purpose: 'rotate', ref: migration.credentialRef, now: '2026-11-04T03:00:00.000Z' })
    database.connection.prepare("update channel_management_operations set state = 'revoked-cleanup' where id = ?").run(operationId)

    await service.recover()
    await service.recover()
    expect(database.connection.prepare('select state from channel_management_operations where id = ?').get(operationId)).toEqual({ state: 'revoked-cleanup' })

    // 第三次：到上限，落 abandoned + unavailable + 一行审计，不再无限重试。
    await service.recover()
    expect(database.connection.prepare('select state, stable_error_code, recovery_attempts from channel_management_operations where id = ?').get(operationId)).toEqual({
      state: 'abandoned',
      stable_error_code: 'channel-credential-recovery-exhausted',
      recovery_attempts: 3
    })
    expect(database.connection.prepare('select credential_health from agent_channels where id = ?').get(id)).toEqual({ credential_health: 'unavailable' })
    expect(database.connection.prepare(
      "select count(*) as count from channel_management_audits where channel_id = ? and code = 'channel-credential-recovery-exhausted'"
    ).get(id)).toEqual({ count: 1 })
  })
})
