export const DEFAULT_ASSISTANT_ID = 'default'

export const assistantMcpModes = ['disabled', 'auto', 'manual'] as const
export type AssistantMcpMode = (typeof assistantMcpModes)[number]

export type AssistantCustomParameter =
  | { name: string; type: 'string'; value: string }
  | { name: string; type: 'number'; value: number }
  | { name: string; type: 'boolean'; value: boolean }
  | { name: string; type: 'json'; value: unknown }

export type AssistantSettings = {
  temperature: number
  enableTemperature: boolean
  topP: number
  enableTopP: boolean
  maxTokens: number
  enableMaxTokens: boolean
  streamOutput: boolean
  reasoningEffort: string
  mcpMode: AssistantMcpMode
  maxToolCalls: number
  enableMaxToolCalls: boolean
  enableWebSearch: boolean
  customParameters: AssistantCustomParameter[]
}

export type AssistantTag = {
  id: string
  name: string
}

export type AssistantEntity = {
  id: string
  name: string
  prompt: string
  icon: string
  description: string
  settings: AssistantSettings
  modelId: string | null
  modelName: string | null
  mcpServerIds: string[]
  contextSourceIds: string[]
  tags: AssistantTag[]
  orderKey: string
  createdAt: string
  updatedAt: string
}

export type CreateAssistantDto = {
  id?: string
  name: string
  prompt?: string
  icon?: string
  description?: string
  settings?: Partial<AssistantSettings>
  modelId?: string | null
  mcpServerIds?: string[]
  contextSourceIds?: string[]
  tags?: AssistantTag[]
}

export type UpdateAssistantDto = Partial<Omit<CreateAssistantDto, 'id'>>

export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = {
  temperature: 0.7,
  enableTemperature: false,
  topP: 1,
  enableTopP: false,
  maxTokens: 4096,
  enableMaxTokens: false,
  streamOutput: true,
  reasoningEffort: '',
  mcpMode: 'disabled',
  maxToolCalls: 20,
  enableMaxToolCalls: false,
  enableWebSearch: false,
  customParameters: []
}

export function createDefaultAssistantSettings(): AssistantSettings {
  return {
    ...DEFAULT_ASSISTANT_SETTINGS,
    customParameters: []
  }
}

export function isAssistantMcpMode(value: unknown): value is AssistantMcpMode {
  return typeof value === 'string' && (assistantMcpModes as readonly string[]).includes(value)
}

export function normalizeAssistantSettings(
  input: Partial<AssistantSettings> | undefined | null
): AssistantSettings {
  const base = createDefaultAssistantSettings()
  if (!input) return base

  if (input.mcpMode !== undefined && !isAssistantMcpMode(input.mcpMode)) {
    throw new Error(`Invalid assistant mcpMode: ${String(input.mcpMode)}`)
  }

  return {
    temperature: typeof input.temperature === 'number' ? input.temperature : base.temperature,
    enableTemperature:
      typeof input.enableTemperature === 'boolean' ? input.enableTemperature : base.enableTemperature,
    topP: typeof input.topP === 'number' ? input.topP : base.topP,
    enableTopP: typeof input.enableTopP === 'boolean' ? input.enableTopP : base.enableTopP,
    maxTokens: typeof input.maxTokens === 'number' ? input.maxTokens : base.maxTokens,
    enableMaxTokens:
      typeof input.enableMaxTokens === 'boolean' ? input.enableMaxTokens : base.enableMaxTokens,
    streamOutput: typeof input.streamOutput === 'boolean' ? input.streamOutput : base.streamOutput,
    reasoningEffort:
      typeof input.reasoningEffort === 'string' ? input.reasoningEffort : base.reasoningEffort,
    mcpMode: input.mcpMode ?? base.mcpMode,
    maxToolCalls: typeof input.maxToolCalls === 'number' ? input.maxToolCalls : base.maxToolCalls,
    enableMaxToolCalls:
      typeof input.enableMaxToolCalls === 'boolean' ? input.enableMaxToolCalls : base.enableMaxToolCalls,
    enableWebSearch:
      typeof input.enableWebSearch === 'boolean' ? input.enableWebSearch : base.enableWebSearch,
    customParameters: Array.isArray(input.customParameters)
      ? input.customParameters.map(normalizeCustomParameter)
      : base.customParameters
  }
}

function normalizeCustomParameter(value: AssistantCustomParameter): AssistantCustomParameter {
  if (!value || typeof value.name !== 'string' || !value.name.trim()) {
    throw new Error('Assistant custom parameter requires a name.')
  }
  switch (value.type) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'json':
      return value
    default:
      throw new Error(`Invalid assistant custom parameter type: ${String((value as { type?: unknown }).type)}`)
  }
}
