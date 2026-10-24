import { describe, expect, it } from 'vitest'

import { createAgentPlatformDatabase } from '../db/createAgentPlatformDatabase'

describe('channel canonical shadow', () => {
  it('mirrors legacy writes and lifecycle changes into the canonical table', () => {
    const database = createAgentPlatformDatabase(':memory:')
    database.connection.exec(`
      insert into agent_channels(id,type,name,agent_id,public_config_json,credential_ref,credential_revision,credential_health,requested_enabled,migration_state,created_at,updated_at)
        values('channel-shadow','feishu','Lark','agent-a','{"domain":"lark"}','ref',1,'configured',1,'runtime-ready','2026-10-24','2026-10-24');
    `)
    expect(database.connection.prepare(
      "select adapter_key,lifecycle_state,public_config_json,credential_ref from agent_channels_next where id='channel-shadow'"
    ).get()).toEqual({ adapter_key: 'lark', lifecycle_state: 'enabled', public_config_json: '{"domain":"lark"}', credential_ref: 'ref' })

    database.connection.prepare(
      "update agent_channels set migration_state='configuration-ready', credential_ref='next-ref', updated_at='2026-10-25' where id='channel-shadow'"
    ).run()
    expect(database.connection.prepare(
      "select lifecycle_state,credential_ref,updated_at from agent_channels_next where id='channel-shadow'"
    ).get()).toEqual({ lifecycle_state: 'ready', credential_ref: 'next-ref', updated_at: '2026-10-25' })

    database.connection.prepare("delete from agent_channels where id='channel-shadow'").run()
    expect(database.connection.prepare("select 1 from agent_channels_next where id='channel-shadow'").get()).toBeUndefined()
  })
})
