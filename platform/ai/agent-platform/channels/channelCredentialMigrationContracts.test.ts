import { describe, expect, it } from 'vitest'

import { parseLegacyChannelCredentialMigrationSource } from './channelCredentialMigrationContracts'

describe('legacy channel credential migration source', () => {
  it('splits every migratable provider legacy config into strict public metadata and Vault-only secrets', () => {
    const cases = [
      ['telegram', { bot_token: 'token' }, {}, { bot_token: 'token' }],
      ['slack', { bot_token: 'bot', app_token: 'app' }, {}, { bot_token: 'bot', app_token: 'app' }],
      ['feishu', { app_id: 'app', domain: 'lark', app_secret: 'secret', encrypt_key: 'encrypt', verification_token: 'verify' }, { app_id: 'app', domain: 'lark' }, { app_secret: 'secret', encrypt_key: 'encrypt', verification_token: 'verify' }],
      ['qq', { app_id: 'app', client_secret: 'secret' }, { app_id: 'app' }, { client_secret: 'secret' }],
      ['discord', { bot_token: 'token' }, {}, { bot_token: 'token' }]
    ] as const

    for (const [type, config, publicConfig, secrets] of cases) {
      expect(parseLegacyChannelCredentialMigrationSource({ type, config, activeChatIds: ['legacy-chat'], sessionId: 'legacy-session' })).toEqual({
        kind: 'migratable',
        publicConfig,
        secrets,
        legacyDiscoveredConversationCandidates: ['legacy-chat'],
        legacySessionState: 'legacy-unmapped'
      })
    }
  })

  it('does not carry credentials or routing fields into public migration metadata', () => {
    const parsed = parseLegacyChannelCredentialMigrationSource({
      type: 'feishu',
      config: { app_id: 'app', domain: 'feishu', app_secret: 'secret', encrypt_key: 'encrypt', verification_token: 'verify' },
      activeChatIds: ['chat-2', 'chat-1', 'chat-2'],
      sessionId: 'legacy-session'
    })

    expect(parsed).toEqual({
      kind: 'migratable',
      publicConfig: { app_id: 'app', domain: 'feishu' },
      secrets: { app_secret: 'secret', encrypt_key: 'encrypt', verification_token: 'verify' },
      legacyDiscoveredConversationCandidates: ['chat-1', 'chat-2'],
      legacySessionState: 'legacy-unmapped'
    })
    expect(JSON.stringify((parsed as { publicConfig?: unknown }).publicConfig)).not.toContain('secret')
    expect(Object.keys(parsed)).not.toEqual(expect.arrayContaining([
      'agentId', 'workspace', 'allowPolicy', 'deliveryTarget', 'sessionId', 'runtime'
    ]))
  })

  it('requires reenrollment for the exact legacy WeChat token path without retaining the path', () => {
    const tokenPath = '/private/legacy/wechat-credentials.json'
    const parsed = parseLegacyChannelCredentialMigrationSource({
      type: 'wechat',
      config: { token_path: tokenPath },
      activeChatIds: ['chat-2', 'chat-1', 'chat-2'],
      sessionId: 'legacy-session'
    })

    expect(parsed).toEqual({
      kind: 'requires-reenrollment',
      legacyDiscoveredConversationCandidates: ['chat-1', 'chat-2'],
      legacySessionState: 'legacy-unmapped'
    })
    expect(JSON.stringify(parsed)).not.toContain(tokenPath)
    expect(parsed).not.toHaveProperty('publicConfig')
    expect(parsed).not.toHaveProperty('secrets')
    expect(parsed).not.toHaveProperty('credentialRef')
    expect(parsed).not.toHaveProperty('vaultInput')
  })

  it.each([
    ['telegram', { bot_token: 'telegram-secret', unexpected: 'x' }],
    ['slack', { bot_token: 'slack-bot', app_token: 'slack-app', allowed_channel_ids: 'legacy' }],
    ['feishu', { app_id: 'app', domain: 'feishu', app_secret: 'secret', encrypt_key: 'encrypt', verification_token: 'verify', allowed_chat_ids: 'legacy' }],
    ['qq', { app_id: 'app', client_secret: 'qq-secret', endpoint: 'https://bad' }],
    ['discord', { bot_token: 'discord-secret', allowed_channel_ids: 'legacy' }],
    ['wechat', { token_path: '/private/wechat.json', allowed_chat_ids: 'legacy' }],
    ['wechat', { token: 'wechat-token', baseUrl: 'https://example.test', accountId: 'account', userId: 'user', contextToken: 'context' }]
  ] as const)('rejects %s unknown or legacy authorization config without disclosing secrets', (type, config) => {
    try {
      parseLegacyChannelCredentialMigrationSource({ type, config })
      throw new Error('expected migration source rejection')
    } catch (error) {
      expect(error).toHaveProperty('message', 'Channel credential migration source is invalid.')
      expect(String(error)).not.toContain(Object.values(config)[0]!)
    }
  })

  it.each([
    ['telegram', {}],
    ['slack', { bot_token: 'bot' }],
    ['feishu', { app_id: 'app', domain: 'feishu', app_secret: 'secret', encrypt_key: 'encrypt' }],
    ['qq', { app_id: 'app' }],
    ['discord', {}],
    ['wechat', {}]
  ] as const)('rejects %s when a required secret is missing', (type, config) => {
    expect(() => parseLegacyChannelCredentialMigrationSource({ type, config })).toThrow(
      'Channel credential migration source is invalid.'
    )
  })
})
