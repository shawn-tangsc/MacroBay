import { describe, expect, it } from 'vitest'

import { createAgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { seedChannelAdapterSupport } from './channelTestSupport'
import { ChannelManagementQueryRepository } from './ChannelManagementQueryRepository'

/**
 * B3：运行审计**按频道筛**——读者要回答「这个频道最近发没发出去、为什么失败」。
 *
 * 判据是「别的频道一行都不混进来」：两个频道各有自己的行、时刻交错，按 A 查只得到 A 的，
 * 且顺序仍是 `(created_at desc, id asc)`（与索引一致，分页游标才靠得住）。
 */
function databaseWithTwoChannels() {
  const database = createAgentPlatformDatabase(':memory:')
  seedChannelAdapterSupport(database, ['telegram'])
  database.connection.exec(`
    insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at)
      values('agent-a','custom','Agent','[]','[]','a','2026-11-04','2026-11-04');
    insert into agent_channels(id,adapter_key,name,agent_id,public_config_json,requested_enabled,lifecycle_state,credential_health,created_at,updated_at) values
      ('channel-a','telegram','Telegram A','agent-a','{}',1,'enabled','configured','2026-11-04','2026-11-04'),
      ('channel-b','telegram','Telegram B','agent-a','{}',1,'enabled','configured','2026-11-04','2026-11-04');
  `)
  const insert = database.connection.prepare(
    'insert into channel_runtime_audits (id, channel_id, generation, code, created_at) values (?, ?, ?, ?, ?)'
  )
  insert.run('a-1', 'channel-a', 1, 'telegram-poll-failed', '2026-11-04T01:00:00.000Z')
  insert.run('b-1', 'channel-b', 1, 'telegram-poll-failed', '2026-11-04T01:00:30.000Z')
  insert.run('a-2', 'channel-a', 1, 'telegram-poll-recovered', '2026-11-04T01:01:00.000Z')
  insert.run('b-2', 'channel-b', 1, 'telegram-conflict', '2026-11-04T01:02:00.000Z')
  return database
}

describe('channel runtime audits are read per channel', () => {
  it('returns only the requested channel, newest first', () => {
    const repository = new ChannelManagementQueryRepository(databaseWithTwoChannels())

    expect(repository.runtimeAudits('channel-a', 50, null).rows).toEqual([
      { id: 'a-2', code: 'telegram-poll-recovered', createdAt: '2026-11-04T01:01:00.000Z' },
      { id: 'a-1', code: 'telegram-poll-failed', createdAt: '2026-11-04T01:00:00.000Z' }
    ])
    expect(repository.runtimeAudits('channel-b', 50, null).rows.map((row) => row.id)).toEqual(['b-2', 'b-1'])
  })

  it('returns an empty page for a channel with no rows, which is not a read failure', () => {
    const repository = new ChannelManagementQueryRepository(databaseWithTwoChannels())
    // 空页与「读失败」是两回事：这里只是没有记录，仓库照常返回 `{ rows: [], nextCursor: null }`。
    expect(repository.runtimeAudits('channel-c', 50, null)).toEqual({ rows: [], nextCursor: null })
  })
})
