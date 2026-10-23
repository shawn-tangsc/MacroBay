import type {
  AgentConfiguration,
  AgentType,
  CreateAgentDto,
  UniqueModelId,
  UpdateAgentDto
} from '../schemas/agentSchemas'

export type AgentConfigSection = 'basic' | 'prompt' | 'permission' | 'tools' | 'advanced'

export const AGENT_CONFIG_SECTIONS: readonly AgentConfigSection[] = [
  'basic',
  'prompt',
  'permission',
  'tools',
  'advanced'
]

export interface AgentDetail {
  id: string
  type: AgentType
  name: string
  description?: string
  instructions?: string
  model: UniqueModelId | null
  modelName: string | null
  planModel?: UniqueModelId
  smallModel?: UniqueModelId
  mcps?: string[]
  disabledTools?: string[]
  configuration?: AgentConfiguration
  createdAt: string
  updatedAt: string
  orderKey: string
}

/**
 * Editable shape of the agent drawer. Model ids use `''` for "not selected" so
 * the form can bind directly to inputs.
 */
export interface AgentFormState {
  name: string
  description: string
  model: UniqueModelId | ''
  planModel: UniqueModelId | ''
  smallModel: UniqueModelId | ''
  instructions: string
  mcps: string[]
  disabledTools: string[]
  avatar: string
  permissionMode: string
  maxTurns: number
  envVarsText: string
  soulEnabled: boolean
  heartbeatEnabled: boolean
  heartbeatInterval: number
}

export interface AgentCreateValidation {
  nameMissing: boolean
  modelMissing: boolean
  isValid: boolean
}

export interface AgentDiffResult {
  dto: UpdateAgentDto
}

export type AgentSaveIntent =
  | { kind: 'create'; payload: CreateAgentDto }
  | { kind: 'update'; payload: UpdateAgentDto }
