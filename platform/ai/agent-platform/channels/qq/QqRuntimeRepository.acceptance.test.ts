import { afterEach, describe, expect, it } from 'vitest'

import { createAgentPlatformDatabase } from '../../db/createAgentPlatformDatabase'
import { retainChannelAcceptance, setChannelAcceptanceOverride } from '../channelAcceptanceOverride'
import { QqRuntimeRepository } from './QqRuntimeRepository'

/**
 * 授权 SQL 必须**每次拼**，不能模块加载时算成常量。
 *
 * 现场：内存判定（`isCurrentActive`）说「现役」，写侧（`auditIfCurrent` / `commitIfCurrent`）说「没资格」——
 * 同一份授权两边结论相反。根因是 `supportedChannelSql` 里含「进程内取证放行」，
 * 而放行是用户点启用之后才建立的；常量在模块加载那一刻就把空放行集算死。
 * 后果链：READY 到达 → commit 被拒 → 当成序号过期 → 审计 `qq-sequence-stale` 并关连接，
 * 于是每次握手都自我关闭，单聊消息永远推不下来。
 */

const CHANNEL_ID = 'qq-acceptance'
const GENERATION = 31

function seed(): ReturnType<typeof createAgentPlatformDatabase> {
  const database = createAgentPlatformDatabase(':memory:')
  database.connection.exec(`
    insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at)
      values('agent-a','custom','Agent','[]','[]','a','2026-11-11','2026-11-11');
    insert into agent_channels(id,adapter_key,name,agent_id,public_config_json,requested_enabled,lifecycle_state,credential_health,created_at,updated_at)
      values('${CHANNEL_ID}','qq','QQ','agent-a','{}',1,'enabled','configured','2026-11-11','2026-11-11');
    insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at)
      values('${CHANNEL_ID}',${GENERATION},'active','2026-11-11');
  `)
  // 不 seed channel_adapter_support：六家在库里全是 blocked，正是用户机器的状态。
  return database
}

afterEach(() => {
  setChannelAcceptanceOverride(null)
})

describe('qq runtime repository authorization', () => {
  it('lets the runtime audit through once the override is granted after module load', () => {
    const repository = new QqRuntimeRepository(seed())
    // 放行建立在模块加载之后——常量写法在那一刻就把 SQL 算死了，这条必红。
    retainChannelAcceptance('qq')
    expect(repository.auditIfCurrent(CHANNEL_ID, GENERATION, 'qq-gateway-open')).toBe(true)
  })

  it('lets the READY commit through once the override is granted after module load', () => {
    // 现场后果链：commit 被拒 → 当序号过期 → 关连接。这条直接钉 write 侧。
    const repository = new QqRuntimeRepository(seed())
    retainChannelAcceptance('qq')
    expect(repository.commitIfCurrent(CHANNEL_ID, GENERATION, 2)).toBe(true)
    expect(repository.commitIfCurrent(CHANNEL_ID, GENERATION, 1)).toBe(true) // 更小的序号不推回游标
    expect(repository.commitIfCurrent(CHANNEL_ID, GENERATION, -1)).toBe(false)
  })

  it('stays false without any acceptance, so the gate itself is still enforced', () => {
    const repository = new QqRuntimeRepository(seed())
    expect(repository.auditIfCurrent(CHANNEL_ID, GENERATION, 'qq-gateway-open')).toBe(false)
    expect(repository.commitIfCurrent(CHANNEL_ID, GENERATION, 2)).toBe(false)
  })
})
