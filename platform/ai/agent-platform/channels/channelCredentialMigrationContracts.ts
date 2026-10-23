import type { AgentChannelType, FeishuDomain } from '../schemas/channelSchemas'

export type PublicChannelConfig =
  | { type: 'telegram'; value: Record<string, never> }
  | { type: 'slack'; value: Record<string, never> }
  | { type: 'feishu'; value: { app_id: string; domain: FeishuDomain } }
  | { type: 'qq'; value: { app_id: string } }
  | { type: 'discord'; value: Record<string, never> }

export type LegacyChannelCredentialMigrationSource = {
  type: AgentChannelType
  config: unknown
  activeChatIds?: unknown
  sessionId?: unknown
}

type LegacyMigrationSafetyContext = {
  legacyDiscoveredConversationCandidates: string[]
  legacySessionState: 'legacy-unmapped' | null
}

export type MigratableLegacyChannelCredentialMigrationSource = LegacyMigrationSafetyContext & {
  kind: 'migratable'
  publicConfig: PublicChannelConfig['value']
  secrets: Record<string, string>
}

export type RequiresReenrollmentLegacyChannelCredentialMigrationSource = LegacyMigrationSafetyContext & {
  kind: 'requires-reenrollment'
}

export type ParsedLegacyChannelCredentialMigrationSource =
  | MigratableLegacyChannelCredentialMigrationSource
  | RequiresReenrollmentLegacyChannelCredentialMigrationSource

export function parseLegacyChannelCredentialMigrationSource(
  input: LegacyChannelCredentialMigrationSource
): ParsedLegacyChannelCredentialMigrationSource {
  const config = requireStringRecord(input.config)
  const candidates = parseLegacyCandidates(input.activeChatIds)
  const legacySessionState = typeof input.sessionId === 'string' && input.sessionId ? 'legacy-unmapped' : null

  switch (input.type) {
    case 'telegram':
      return splitConfig(config, ['bot_token'], [], candidates, legacySessionState)
    case 'slack':
      return splitConfig(config, ['bot_token', 'app_token'], [], candidates, legacySessionState)
    case 'feishu': {
      const parsed = splitConfig(config, ['app_secret', 'encrypt_key', 'verification_token'], ['app_id', 'domain'], candidates, legacySessionState)
      const publicConfig = parsed.publicConfig as { app_id: string; domain: string }
      if (!isFeishuDomain(publicConfig.domain)) throw invalidLegacyChannelSource()
      return { ...parsed, publicConfig: { app_id: publicConfig.app_id, domain: publicConfig.domain } }
    }
    case 'qq':
      return splitConfig(config, ['client_secret'], ['app_id'], candidates, legacySessionState)
    case 'discord':
      return splitConfig(config, ['bot_token'], [], candidates, legacySessionState)
    case 'wechat':
      if (!hasExactFields(config, ['token_path'])) throw invalidLegacyChannelSource()
      return {
        kind: 'requires-reenrollment',
        legacyDiscoveredConversationCandidates: candidates,
        legacySessionState
      }
  }
}

function splitConfig(
  config: Record<string, string>,
  secretFields: readonly string[],
  publicFields: readonly string[],
  candidates: string[],
  legacySessionState: 'legacy-unmapped' | null
): MigratableLegacyChannelCredentialMigrationSource {
  if (!hasExactFields(config, [...secretFields, ...publicFields])) throw invalidLegacyChannelSource()
  if (secretFields.some((field) => !config[field])) throw invalidLegacyChannelSource()
  if (publicFields.some((field) => !config[field])) throw invalidLegacyChannelSource()
  return {
    kind: 'migratable',
    publicConfig: Object.fromEntries(publicFields.map((field) => [field, config[field]!])) as PublicChannelConfig['value'],
    secrets: Object.fromEntries(secretFields.map((field) => [field, config[field]!])),
    legacyDiscoveredConversationCandidates: candidates,
    legacySessionState
  }
}

function hasExactFields(config: Record<string, string>, fields: readonly string[]): boolean {
  const allowed = new Set(fields)
  return Object.keys(config).length === allowed.size && Object.keys(config).every((field) => allowed.has(field))
}

function requireStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidLegacyChannelSource()
  const record = value as Record<string, unknown>
  if (!Object.values(record).every((item) => typeof item === 'string' && item.length > 0)) throw invalidLegacyChannelSource()
  return record as Record<string, string>
}

function parseLegacyCandidates(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item)) throw invalidLegacyChannelSource()
  return [...new Set(value)].sort()
}

function isFeishuDomain(value: string | undefined): value is FeishuDomain {
  return value === 'feishu' || value === 'lark'
}

function invalidLegacyChannelSource(): Error {
  return new Error('Channel credential migration source is invalid.')
}
