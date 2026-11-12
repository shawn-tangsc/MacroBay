import { describe, expect, it } from 'vitest'

import { createAgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { ChannelManagementRepository } from './ChannelManagementRepository'
import { seedChannelAdapterSupport } from './channelTestSupport'
import { shouldShowAutoDisabledHint } from './autoDisabledHint'

/**
 * 「曾被规则自动停用」的**只读证据**（原型 2026-11-13）：两个时刻都从审计表算出来，
 * 判据是纯函数。这里验的是投影——审计里有那一行、之后有没有再启用，决定提示显不显示。
 */
function harness() {
  const database = createAgentPlatformDatabase(':memory:')
  seedChannelAdapterSupport(database, ['telegram'])
  database.connection.exec(`
    insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at)
      values('agent-a','custom','Agent','[]','[]','a','2026-11-12','2026-11-12');
    insert into agent_channels(id,adapter_key,name,agent_id,public_config_json,requested_enabled,lifecycle_state,credential_health,credential_ref,credential_revision,created_at,updated_at)
      values('channel-a','telegram','Telegram','agent-a','{}',0,'disabled','configured','ref-a',2,'2026-11-12','2026-11-12');
  `)
  const repository = new ChannelManagementRepository(database)
  const audit = (action: string, code: string | null, summary: Record<string, string>, at: string): void => {
    database.connection.prepare(
      `insert into channel_management_audits(id,channel_id,actor_id,action,code,summary_json,created_at)
       values(?,?, 'system', ?, ?, ?, ?)`
    ).run(`audit-${at}-${action}`, 'channel-a', action, code, JSON.stringify(summary), at)
  }
  return { repository, audit }
}

const INVARIANT = { auto: 'true', reason: 'single-channel-invariant' }

describe('auto-disabled evidence projection + predicate', () => {
  it('shows when the rule disabled it and nothing re-enabled it', () => {
    const { repository, audit } = harness()
    audit('disable', null, INVARIANT, '2026-11-11T10:00:00.000Z')
    const view = repository.query.get('channel-a')
    expect(view?.autoDisabled).toEqual({ autoDisabledAt: '2026-11-11T10:00:00.000Z', lastEnabledAt: null })
    expect(shouldShowAutoDisabledHint(view?.autoDisabled)).toBe(true)
  })

  it('hides after a successful re-enable, and ignores failed attempts', () => {
    const { repository, audit } = harness()
    audit('disable', null, INVARIANT, '2026-11-11T10:00:00.000Z')
    // 失败过的启用不算「重新启用过」。
    audit('request-enable', 'channel-smoke-failed', {}, '2026-11-11T11:00:00.000Z')
    expect(shouldShowAutoDisabledHint(repository.query.get('channel-a')?.autoDisabled)).toBe(true)
    audit('request-enable', null, {}, '2026-11-12T09:00:00.000Z')
    expect(shouldShowAutoDisabledHint(repository.query.get('channel-a')?.autoDisabled)).toBe(false)
  })

  it('does not mistake an ordinary user disable for the rule', () => {
    const { repository, audit } = harness()
    audit('disable', null, {}, '2026-11-11T10:00:00.000Z')
    expect(repository.query.get('channel-a')?.autoDisabled)
      .toEqual({ autoDisabledAt: null, lastEnabledAt: null })
    expect(shouldShowAutoDisabledHint(repository.query.get('channel-a')?.autoDisabled)).toBe(false)
  })
})
