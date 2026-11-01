export const mcpServerTypes = ['stdio', 'sse', 'streamableHttp', 'inMemory'] as const
export type McpServerType = (typeof mcpServerTypes)[number]

export const mcpServerInstallSources = ['builtin', 'manual', 'protocol', 'unknown'] as const
export type McpServerInstallSource = (typeof mcpServerInstallSources)[number]

/**
 * 运行时可上报的状态。`idle` 表示「还没有过任何一次运行时上报」——不是「正在连接」。
 * 与下方 `mcpRuntimeLifecycleStates` 的 `idle` 同名同义，不允许再引入第二个词描述同一件事。
 */
export const mcpRuntimeStates = ['idle', 'connected', 'connecting', 'error', 'disabled'] as const
export type McpRuntimeState = (typeof mcpRuntimeStates)[number]

export const mcpRuntimeErrorKinds = ['abort', 'config', 'dependency', 'auth', 'transient'] as const
export type McpRuntimeErrorKind = (typeof mcpRuntimeErrorKinds)[number]

export const mcpRuntimeLifecycleStates = [
  'idle',
  'connecting',
  'connected',
  'reconnect-scheduled',
  'reconnecting',
  'retry-exhausted',
  'terminal-error',
  'disabled'
] as const
export type McpRuntimeLifecycleState = (typeof mcpRuntimeLifecycleStates)[number]

export type McpRuntimeStatus = {
  state: McpRuntimeState
  message?: string
  errorKind?: McpRuntimeErrorKind
  retryable?: boolean
  lifecycleState?: McpRuntimeLifecycleState
  lastCheckedAt: number
}

export type McpConfigSample = {
  command: string
  args: string[]
  env?: Record<string, string>
}

export type McpServerEntity = {
  id: string
  name: string
  type?: McpServerType
  description?: string
  baseUrl?: string
  command?: string
  registryUrl?: string
  args?: string[]
  env?: Record<string, string>
  headers?: Record<string, string>
  provider?: string
  providerUrl?: string
  logoUrl?: string
  tags?: string[]
  longRunning?: boolean
  timeout?: number
  dxtVersion?: string
  dxtPath?: string
  reference?: string
  searchKey?: string
  configSample?: McpConfigSample
  disabledTools?: string[]
  disabledAutoApproveTools?: string[]
  shouldConfig?: boolean
  sortOrder?: number
  isActive: boolean
  installSource?: McpServerInstallSource
  isTrusted?: boolean
  trustedAt?: number
  installedAt?: number
  createdAt?: string
  updatedAt?: string
}

export type CreateMcpServerDto = Omit<McpServerEntity, 'id' | 'createdAt' | 'updatedAt'>
export type UpdateMcpServerDto = Partial<CreateMcpServerDto>
