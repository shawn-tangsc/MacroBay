import { describe, expect, it } from 'vitest'

import { createAgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { ChannelManagementRepository } from './ChannelManagementRepository'
import { seedChannelAdapterSupport } from './channelTestSupport'

/**
 * 投递审计要**读得出**通道原话（`detail`）。
 *
 * 写入侧（`5af36d9`）已经把它写进新列，但查询一直没 select 它——渲染层再会画也拿不到。
 * 这一条钉住「写进去的读得出来」，并且兼容没有 detail 的历史行（回 `null`，界面不画空括号）。
 */
describe('delivery audit detail', () => {
  it('returns the redacted channel detail and null for older rows', () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedChannelAdapterSupport(database, ['telegram'])
    database.connection.exec(`
      insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at)
        values('agent-a','custom','Agent','[]','[]','a','2026-11-04','2026-11-04');
      insert into agent_channels(id,adapter_key,name,agent_id,public_config_json,lifecycle_state,credential_health,created_at,updated_at)
        values('channel-a','telegram','test','agent-a','{}','ready','configured','2026-11-04','2026-11-04');
      insert into channel_delivery_audits(id,channel_id,attempt_id,code,detail,created_at)
        values('audit-new','channel-a','attempt-a','delivery-provider-rejected','Bad Request: chat not found','2026-11-04T09:06:38.000Z');
      insert into channel_delivery_audits(id,channel_id,attempt_id,code,created_at)
        values('audit-old','channel-a',null,'channel-delivery-failed','2026-11-04T09:06:00.000Z');
    `)
    const repository = new ChannelManagementRepository(database)

    const rows = repository.query.deliveryAudits('channel-a', 50, 0)

    expect(rows).toEqual([
      {
        id: 'audit-new',
        attemptId: 'attempt-a',
        code: 'delivery-provider-rejected',
        detail: 'Bad Request: chat not found',
        createdAt: '2026-11-04T09:06:38.000Z'
      },
      {
        id: 'audit-old',
        attemptId: null,
        code: 'channel-delivery-failed',
        detail: null,
        createdAt: '2026-11-04T09:06:00.000Z'
      }
    ])
  })
})
