import type { ModelCapabilities } from './modelProviderTypes'

const OPTIONAL_CAPABILITY_KEYS = [
  'capabilitiesEdited',
  'tools',
  'vision',
  'reasoning',
  'embedding',
  'imageGeneration',
  'videoGeneration',
  'rerank',
  'speech',
  'transcription',
  'ocr'
] as const

/** PLAT-62：能力字段可为空；只保留调用方**明确给出**的布尔值（不再默认全 true/false）。 */
export function normalizeModelCapabilities(value: unknown): ModelCapabilities {
  const capabilities = value && typeof value === 'object' ? (value as Partial<ModelCapabilities> & { agent?: unknown }) : {}
  const normalized: ModelCapabilities = {
    chat: Boolean(capabilities.chat)
  }
  for (const key of OPTIONAL_CAPABILITY_KEYS) {
    if (typeof capabilities[key] === 'boolean') normalized[key] = capabilities[key]
  }
  // PLAT-76：老数据只有 `audio: true`（= 语音族），迁移成 `speech` 后不再保留 audio。
  if (capabilities.audio === true && normalized.speech !== false) normalized.speech = true
  if (capabilities.audio === false && normalized.speech === undefined) normalized.speech = false
  delete (normalized as { audio?: boolean }).audio
  const agentRuntimes = normalizeAgentRuntimeCapabilities(capabilities)
  if (agentRuntimes) normalized.agentRuntimes = agentRuntimes
  return normalized
}

export function mergeModelCapabilities(
  base: ModelCapabilities,
  override: Partial<ModelCapabilities> | undefined
): ModelCapabilities {
  const normalizedBase = normalizeModelCapabilities(base)
  const normalizedOverride = normalizeModelCapabilities({
    ...override,
    chat: typeof override?.chat === 'boolean' ? override.chat : normalizedBase.chat
  })
  return {
    ...normalizedBase,
    ...normalizedOverride,
    chat: normalizedOverride.chat,
    agentRuntimes: {
      ...normalizedBase.agentRuntimes,
      ...normalizedOverride.agentRuntimes
    }
  }
}

function normalizeAgentRuntimeCapabilities(
  capabilities: Partial<ModelCapabilities> & { agent?: unknown }
): ModelCapabilities['agentRuntimes'] | undefined {
  const candidate = capabilities.agentRuntimes && typeof capabilities.agentRuntimes === 'object'
    ? capabilities.agentRuntimes
    : undefined
  const normalized: Record<string, boolean | undefined> = {
    claudeCode: typeof capabilities.agent === 'boolean' ? capabilities.agent : undefined,
    openaiAgents: undefined
  }
  if (candidate) {
    for (const key of ['claudeCode', 'openaiAgents'] as const) {
      const value = (candidate as Record<string, unknown>)[key]
      if (typeof value === 'boolean') normalized[key] = value
    }
  }
  // 统一口径：旧的 `agent: true` 与新的 `agentRuntimes.claudeCode` 是同一个意思，
  // 否则"列表说有 59 个智能体模型、下拉只有 1 个"这种分裂会反复出现。
  if (normalized.claudeCode === true) normalized.claudeCode = true
  if (capabilities.agent === true && normalized.claudeCode !== false) normalized.claudeCode = true
  const entries = Object.entries(normalized).filter(([, value]) => typeof value === 'boolean')
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}
