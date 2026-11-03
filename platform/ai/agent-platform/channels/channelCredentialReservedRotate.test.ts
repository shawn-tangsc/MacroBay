import { describe, expect, it } from 'vitest'

import { createAgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { ChannelAdapterAcceptanceRegistry } from './ChannelAdapterAcceptanceRegistry'
import { ChannelManagementRepository } from './ChannelManagementRepository'
import { ChannelManagementService } from './ChannelManagementService'
import { ChannelSecureHandoff } from './ChannelSecureHandoff'
import { seedChannelAdapterSupport } from './channelTestSupport'

/**
 * 换 Token 在「凭据是预留记录」时失败——这条用例按**真实语义**写替身。
 *
 * 之前的单测为什么没抓到：测试用的假仓库只认 `known-ref`，比真实现宽松得多；
 * 而真实仓库（`encryptedChannelCredentialVault.ts:158`）对 reserved 记录直接 `throw unavailable()`，
 * 于是 `rotate` 永远失败、原因被压成 `channel-credential-unavailable`，界面只能说「没存上」。
 * 教训：替身要比真实现更严格，不能更宽松。
 *
 * 现在是 `it.fails`：它**故意红**，把当前缺陷钉在树上；修好之后它会变绿、`it.fails` 报「预期失败却通过」，
 * 那时把 `it.fails` 改成 `it` —— 这就是「红用例先落库」的机制。
 */
describe('rotating a credential that was written as a reserved record', () => {
  it.fails('rotates it instead of failing with channel-credential-unavailable', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedChannelAdapterSupport(database, ['telegram'])
    database.connection.exec(`insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at)
      values('agent-a','custom','Agent','[]','[]','a','2026-11-04','2026-11-04')`)

    // 替身按真实仓库语义实现：reserved 记录一律拒绝就地轮换。
    const store = { ref: null as string | null, revision: 1, reserved: false }
    const vault = {
      prepareMigration: async (input: { channelId: string }) => ({
        credentialRef: `channel-migration:${input.channelId}:fp`,
        sourceFingerprint: 'fp',
        fingerprintKeyId: 'key-1',
        migrationPermit: 'permit-1'
      }),
      putReserved: async (input: { channelId: string; value: Record<string, string> }) => {
        store.ref = `channel-migration:${input.channelId}:fp`
        store.revision = 1
        store.reserved = true
        return { credentialRef: store.ref, revision: 1, maskedFields: { bot_token: '********' } }
      },
      inspectReserved: async () => (store.ref === null ? null : { credentialRef: store.ref, revision: store.revision, maskedFields: {} }),
      rotateIfRevision: async () => {
        // 与真实现一致：reserved 记录不能就地轮换。
        if (store.reserved) throw new Error('unavailable')
        store.revision += 1
        return { credentialRef: store.ref, revision: store.revision, maskedFields: {} }
      },
      inspectMutationReceipt: async () => null,
      claimReservedCleanup: async () => ({ revision: 1, cleanupToken: 'cleanup-1' }),
      deleteReservedIfCleanupClaim: async () => true,
      deleteReservedIfRevision: async () => true,
      delete: async () => undefined,
      get: async () => null
    } as never
    const cipher = {
      encrypt: async () => ({ ciphertext: new Uint8Array([1]), keyRef: 'k', keyRevision: 1 }),
      decrypt: async () => new Uint8Array(),
      keyedHash: async () => 'hash',
      rotate: async () => ({ keyRef: 'k', keyRevision: 1 }),
      revoke: async () => undefined,
      destroy: async () => undefined
    } as never
    const service = new ChannelManagementService({
      repository: new ChannelManagementRepository(database),
      vault,
      cipher,
      registry: new ChannelAdapterAcceptanceRegistry(),
      handoff: new ChannelSecureHandoff(),
      now: () => new Date('2026-11-04T03:00:00.000Z')
    })
    const id = service.create({ type: 'telegram', name: 'test', agentId: 'agent-a', actorId: 'user-a' }).channel!.id

    const handoffOf = async (token: string) => {
      const begin = await service.beginCredential({ id, senderId: 7 })
      const { webcrypto } = await import('node:crypto')
      const pair = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
      const main = await webcrypto.subtle.importKey('jwk', begin.mainPublicJwk as JsonWebKey, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
      const bits = await webcrypto.subtle.deriveBits({ name: 'ECDH', public: main }, pair.privateKey, 256)
      const key = await webcrypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt'])
      const iv = new Uint8Array(12)
      const aad = new TextEncoder().encode(`${begin.sessionId}:${id}:credential`)
      const ciphertext = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, new TextEncoder().encode(JSON.stringify({ bot_token: token }))))
      return { sessionId: begin.sessionId, rendererPublicJwk: await webcrypto.subtle.exportKey('jwk', pair.publicKey), iv, ciphertext }
    }

    // 1) 新建时写入凭据（这条路走的是 provision → putReserved）
    await expect(Promise.resolve(service.provision({ id, actorId: 'user-a', senderId: 7, handoff: await handoffOf('111:first'), purpose: 'credential' } as never)))
      .resolves.toMatchObject({ ok: true })

    // 2) 编辑弹层的顺序：先 update，再换 Token
    expect(service.update({ id, name: 'test', agentId: 'agent-a', actorId: 'user-a' })).toMatchObject({ ok: true })
    const rotated = await Promise.resolve(service.rotate({ id, actorId: 'user-a', senderId: 7, handoff: await handoffOf('222:second') }))

    // 期望：能换；连续换两次也不许留卡住的操作。
    expect(rotated).toMatchObject({ ok: true })
    expect(service.get(id)?.credential.status).toBe('configured')
    const stuck = database.connection.prepare(
      "select count(*) as count from channel_management_operations where channel_id = ? and state in ('reserved','needs-recovery','external-inflight','revoked-cleanup')"
    ).get(id) as { count: number }
    expect(stuck.count).toBe(0)
  })
})
