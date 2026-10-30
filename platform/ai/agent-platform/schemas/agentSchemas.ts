export const agentTypes = ['claude-code'] as const
export type AgentType = (typeof agentTypes)[number]

export const agentPermissionModes = ['default', 'acceptEdits', 'bypassPermissions', 'plan'] as const
export const agentEffortLevels = ['off', 'low', 'high', 'max'] as const
export type AgentEffort = (typeof agentEffortLevels)[number]
export type AgentPermissionMode = (typeof agentPermissionModes)[number]

export const agentSchedulerTypes = ['cron', 'interval', 'one-time'] as const
export type AgentSchedulerType = (typeof agentSchedulerTypes)[number]

export const DEFAULT_PERMISSION_MODE = 'default' satisfies AgentPermissionMode
export const DEFAULT_MAX_TURNS = 100
export const DEFAULT_HEARTBEAT_ENABLED = true
export const DEFAULT_HEARTBEAT_INTERVAL = 30

export type UniqueModelId = string

export type AgentConfiguration = {
  avatar?: string
  slash_commands?: string[]
  permission_mode?: AgentPermissionMode
  effort?: AgentEffort
  max_turns?: number
  env_vars?: Record<string, string>
  soul_enabled?: boolean
  bootstrap_completed?: boolean
  scheduler_enabled?: boolean
  scheduler_type?: AgentSchedulerType
  scheduler_cron?: string
  scheduler_interval?: number
  scheduler_one_time_delay?: number
  scheduler_last_run?: string
  heartbeat_enabled?: boolean
  heartbeat_interval?: number
  /**
   * true = 这个 agent 的 prompt 类 builtin（WebSearch/WebFetch/Bash…）默认不预授权，
   * 只有会话显式传 allowedTools 时才放行；缺省 false，保持历史行为。
   */
  requireSessionToolAllowlist?: boolean
} & Record<string, unknown>

export type AgentBase = {
  name: string
  description?: string
  instructions?: string
  model: UniqueModelId
  planModel?: UniqueModelId
  smallModel?: UniqueModelId
  mcps?: string[]
  disabledTools?: string[]
  configuration?: AgentConfiguration
}

export type AgentEntity = Omit<AgentBase, 'model'> & {
  id: string
  type: AgentType
  createdAt: string
  updatedAt: string
  orderKey: string
  model: UniqueModelId | null
  modelName: string | null
}

export type CreateAgentDto = AgentBase & {
  type: AgentType
}

export type UpdateAgentDto = Partial<AgentBase>

export type SanitizedAgentConfiguration = {
  data: AgentConfiguration | undefined
  invalidKeys: string[]
}

const stringArrayKeys = new Set<keyof AgentConfiguration>(['slash_commands'])
const stringRecordKeys = new Set<keyof AgentConfiguration>(['env_vars'])
const stringKeys = new Set<keyof AgentConfiguration>([
  'avatar',
  'permission_mode',
  'effort',
  'scheduler_type',
  'scheduler_cron',
  'scheduler_last_run'
])
const numberKeys = new Set<keyof AgentConfiguration>([
  'max_turns',
  'scheduler_interval',
  'scheduler_one_time_delay',
  'heartbeat_interval'
])
const booleanKeys = new Set<keyof AgentConfiguration>([
  'soul_enabled',
  'bootstrap_completed',
  'scheduler_enabled',
  'heartbeat_enabled',
  'requireSessionToolAllowlist'
])

export function isAgentPermissionMode(value: unknown): value is AgentPermissionMode {
  return typeof value === 'string' && (agentPermissionModes as readonly string[]).includes(value)
}

export function isAgentEffort(value: unknown): value is AgentEffort {
  return typeof value === 'string' && (agentEffortLevels as readonly string[]).includes(value)
}

export function normalizeAgentEffort(value: unknown): AgentEffort | null {
  return isAgentEffort(value) ? value : null
}

export function normalizePermissionMode(mode: string | undefined | null): AgentPermissionMode {
  return isAgentPermissionMode(mode) ? mode : DEFAULT_PERMISSION_MODE
}

export function isSoulModeEnabled(configuration: AgentConfiguration | undefined | null): boolean {
  return configuration?.soul_enabled === true
}

export function sanitizeAgentConfiguration(raw: unknown): SanitizedAgentConfiguration {
  if (raw == null) return { data: undefined, invalidKeys: [] }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { data: undefined, invalidKeys: ['<root>'] }

  const invalidKeys: string[] = []
  const data: AgentConfiguration = {}

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isKnownConfigurationKey(key)) {
      data[key] = value
      continue
    }

    if (key === 'effort' && !isAgentEffort(value)) {
      invalidKeys.push(key)
      continue
    }
    if (stringKeys.has(key) && !isValidStringConfigurationValue(key, value)) {
      invalidKeys.push(key)
      continue
    }
    if (numberKeys.has(key) && !isFiniteNumber(value)) {
      invalidKeys.push(key)
      continue
    }
    if (booleanKeys.has(key) && typeof value !== 'boolean') {
      invalidKeys.push(key)
      continue
    }
    if (stringArrayKeys.has(key) && !isStringArray(value)) {
      invalidKeys.push(key)
      continue
    }
    if (stringRecordKeys.has(key) && !isStringRecord(value)) {
      invalidKeys.push(key)
      continue
    }

    data[key] = value
  }

  return { data, invalidKeys }
}

function isKnownConfigurationKey(key: string): key is keyof AgentConfiguration {
  return (
    stringKeys.has(key as keyof AgentConfiguration) ||
    numberKeys.has(key as keyof AgentConfiguration) ||
    booleanKeys.has(key as keyof AgentConfiguration) ||
    stringArrayKeys.has(key as keyof AgentConfiguration) ||
    stringRecordKeys.has(key as keyof AgentConfiguration)
  )
}

function isValidStringConfigurationValue(key: keyof AgentConfiguration, value: unknown): boolean {
  if (typeof value !== 'string') return false
  if (key === 'permission_mode') return isAgentPermissionMode(value)
  if (key === 'scheduler_type') return (agentSchedulerTypes as readonly string[]).includes(value)
  return true
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every((item) => typeof item === 'string')
}
