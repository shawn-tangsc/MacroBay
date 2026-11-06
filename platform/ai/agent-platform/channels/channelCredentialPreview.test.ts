import { describe, expect, it } from 'vitest'

import { createAgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { ChannelManagementRepository } from './ChannelManagementRepository'
import { ChannelManagementService } from './ChannelManagementService'
import { ChannelAdapterAcceptanceRegistry } from './ChannelAdapterAcceptanceRegistry'
import { ChannelSecureHandoff } from './ChannelSecureHandoff'
import { maskCredentialValue } from './channelCredentialPreview'
import { FakeCipher, FakeVaultKinds, makeVault } from './channelCredentialTestSupport'

const LONG_TOKEN = '6050123456789012345678901234567890xAA'

describe('credential head/tail mask', () => {
  it('shows head 4, one ellipsis and tail 3 for a normal token', () => {
    expect(maskCredentialValue(LONG_TOKEN)).toBe('6050…xAA')
    expect(maskCredentialValue(LONG_TOKEN)).toHaveLength(8)
  })

  it('never leaks a short token: below 8 characters the projection falls back to the fixed mask', () => {
    expect(maskCredentialValue('abc123')).toBe('…123')
    // 投影层对 <8 的掩码串一律换成固定掩码（见 channelCredentialProjection）。
    expect(maskCredentialValue('abc123')).not.toBe('abc123')
  })

  it('does not put the full token or its interior into the JSON the renderer receives', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    database.connection.exec(`insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at)
      values('agent-a','custom','Agent','[]','[]','a','2026-11-04','2026-11-04')`)
    const repository = new ChannelManagementRepository(database)
    const vault = makeVault({ bot_token: LONG_TOKEN })
    const service = new ChannelManagementService({
      repository,
      vault,
      cipher: new FakeCipher() as never,
      registry: new ChannelAdapterAcceptanceRegistry(),
      handoff: new ChannelSecureHandoff()
    })
    const id = service.create({ type: 'telegram', name: 'Telegram', agentId: 'agent-a', actorId: 'user-a' }).channel!.id
    database.connection.prepare(
      "update agent_channels set credential_ref='ref-1', credential_revision=2, credential_health='configured', lifecycle_state='ready' where id = ?"
    ).run(id)

    const views = await service.listWithCredentialPreviews()
    const payload = JSON.stringify(views)
    expect(payload).toContain('6050…xAA')
    expect(payload).not.toContain(LONG_TOKEN)
    // 中间部分（前 5 到倒数第 4 位）也不许出现：那等于把整串拼回来。
    expect(payload).not.toContain(LONG_TOKEN.slice(4, -3))
    expect((await service.getWithCredentialPreviews(id))?.credential.maskedFields.bot_token).toBe('6050…xAA')
  })

  it('falls back to the fixed mask for a short stored token', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    database.connection.exec(`insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at)
      values('agent-a','custom','Agent','[]','[]','a','2026-11-04','2026-11-04')`)
    const repository = new ChannelManagementRepository(database)
    const service = new ChannelManagementService({
      repository,
      vault: makeVault({ bot_token: 'abc123' }),
      cipher: new FakeCipher() as never,
      registry: new ChannelAdapterAcceptanceRegistry(),
      handoff: new ChannelSecureHandoff()
    })
    const id = service.create({ type: 'telegram', name: 'Telegram', agentId: 'agent-a', actorId: 'user-a' }).channel!.id
    database.connection.prepare(
      "update agent_channels set credential_ref='ref-1', credential_revision=2, credential_health='configured', lifecycle_state='ready' where id = ?"
    ).run(id)
    const view = await service.getWithCredentialPreviews(id)
    expect(view?.credential.maskedFields.bot_token).toBe('********')
    expect(JSON.stringify(view)).not.toContain('abc123')
  })
})
