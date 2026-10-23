import { DEFAULT_MAX_TURNS, type UpdateAgentDto } from '../schemas/agentSchemas'
import { environmentFromText, uniqueStrings } from './agentFormEnv'
import type { AgentDetail, AgentDiffResult, AgentFormState } from './agentFormTypes'

type ConfigRule = {
  key: string
  isChanged: (baseline: AgentFormState, next: AgentFormState) => boolean
  read: (next: AgentFormState) => unknown
}

/** Configuration keys that map one-to-one onto a form field. */
const CONFIG_RULES: readonly ConfigRule[] = [
  {
    key: 'avatar',
    isChanged: (baseline, next) => baseline.avatar !== next.avatar,
    read: (next) => next.avatar
  },
  {
    key: 'permission_mode',
    isChanged: (baseline, next) => baseline.permissionMode !== next.permissionMode,
    read: (next) => next.permissionMode || 'default'
  },
  {
    key: 'max_turns',
    isChanged: (baseline, next) => baseline.maxTurns !== next.maxTurns,
    read: (next) => (next.maxTurns > 0 ? next.maxTurns : DEFAULT_MAX_TURNS)
  },
  {
    key: 'env_vars',
    isChanged: (baseline, next) => baseline.envVarsText !== next.envVarsText,
    read: (next) => environmentFromText(next.envVarsText)
  },
  {
    key: 'soul_enabled',
    isChanged: (baseline, next) => baseline.soulEnabled !== next.soulEnabled,
    read: (next) => next.soulEnabled
  },
  {
    key: 'heartbeat_enabled',
    isChanged: (baseline, next) => baseline.heartbeatEnabled !== next.heartbeatEnabled,
    read: (next) => next.heartbeatEnabled
  }
]

/**
 * Produces the minimal update payload between the loaded baseline and the
 * edited form. Returns null when nothing changed.
 */
export function diffAgentUpdate(
  baseline: AgentFormState,
  next: AgentFormState,
  agent: AgentDetail
): AgentDiffResult | null {
  const dto: UpdateAgentDto = {}
  let dirty = false
  const markDirty = (): void => {
    dirty = true
  }

  if (baseline.name !== next.name) {
    dto.name = next.name
    markDirty()
  }
  if (baseline.description !== next.description) {
    dto.description = next.description
    markDirty()
  }
  if (baseline.model !== next.model) {
    if (next.model) {
      dto.model = next.model
    }
    markDirty()
  }
  if (baseline.planModel !== next.planModel) {
    dto.planModel = next.planModel || undefined
    markDirty()
  }
  if (baseline.smallModel !== next.smallModel) {
    dto.smallModel = next.smallModel || undefined
    markDirty()
  }
  if (baseline.instructions !== next.instructions) {
    dto.instructions = next.instructions
    markDirty()
  }
  if (!sameOrderedStrings(baseline.mcps, next.mcps)) {
    dto.mcps = next.mcps
    markDirty()
  }

  const disabledTools = uniqueStrings(next.disabledTools)
  if (!sameStringSet(baseline.disabledTools, disabledTools)) {
    dto.disabledTools = disabledTools
    markDirty()
  }

  const configPatch = collectConfigPatch(baseline, next)
  if (configPatch) {
    dto.configuration = { ...agent.configuration, ...configPatch }
    markDirty()
  }

  return dirty ? { dto } : null
}

function collectConfigPatch(
  baseline: AgentFormState,
  next: AgentFormState
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {}

  for (const rule of CONFIG_RULES) {
    if (rule.isChanged(baseline, next)) {
      patch[rule.key] = rule.read(next)
    }
  }

  // The interval field also implies "heartbeat on" when a value is set.
  if (baseline.heartbeatInterval !== next.heartbeatInterval) {
    if (next.heartbeatEnabled) {
      patch.heartbeat_enabled = true
    }
    patch.heartbeat_interval = next.heartbeatInterval
  }

  return Object.keys(patch).length > 0 ? patch : null
}

function sameOrderedStrings(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  return left.every((value, index) => value === right[index])
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  if (leftSet.size !== rightSet.size) {
    return false
  }
  for (const value of leftSet) {
    if (!rightSet.has(value)) {
      return false
    }
  }
  return true
}
