import {
  DEFAULT_HEARTBEAT_ENABLED,
  DEFAULT_HEARTBEAT_INTERVAL,
  DEFAULT_MAX_TURNS,
  normalizePermissionMode,
  type AgentConfiguration,
  type AgentType,
  type CreateAgentDto,
  type UniqueModelId
} from '../schemas/agentSchemas'
import type { Tool } from '../schemas/toolSchemas'
import { diffAgentUpdate } from './agentFormDiff'
import {
  environmentFromText,
  environmentToText,
  readArray,
  readNumber,
  readString,
  uniqueStrings
} from './agentFormEnv'
import {
  AGENT_CONFIG_SECTIONS,
  type AgentConfigSection,
  type AgentCreateValidation,
  type AgentDetail,
  type AgentDiffResult,
  type AgentFormState,
  type AgentSaveIntent
} from './agentFormTypes'

export { AGENT_CONFIG_SECTIONS, diffAgentUpdate }
export type {
  AgentConfigSection,
  AgentCreateValidation,
  AgentDetail,
  AgentDiffResult,
  AgentFormState,
  AgentSaveIntent
}

export function buildInitialAgentFormState(agent?: AgentDetail | null): AgentFormState {
  const configuration = agent?.configuration ?? {}

  return {
    name: agent?.name ?? '',
    description: agent?.description ?? '',
    model: agent?.model ?? '',
    planModel: agent?.planModel ?? '',
    smallModel: agent?.smallModel ?? '',
    instructions: agent?.instructions ?? '',
    mcps: readArray(agent?.mcps),
    disabledTools: uniqueStrings(agent?.disabledTools ?? []),
    avatar: readString(configuration.avatar),
    permissionMode: readString(configuration.permission_mode),
    maxTurns: formMaxTurns(configuration.max_turns),
    envVarsText: environmentToText(configuration.env_vars),
    soulEnabled: configuration.soul_enabled === true,
    heartbeatEnabled: configuration.heartbeat_enabled ?? DEFAULT_HEARTBEAT_ENABLED,
    heartbeatInterval: readNumber(configuration.heartbeat_interval) || DEFAULT_HEARTBEAT_INTERVAL
  }
}

/**
 * 新建智能体时的初始表单：没有可回填的绑定模型时，预填模型服务里的「默认智能体模型」。
 * 运行时仍以 `resolveEffectiveAgentModel` 为准（未设置才回退），这里只是让用户看见默认值。
 */
export function buildAgentFormStateForEditor(
  agent: AgentDetail | null | undefined,
  defaultModelId?: string | null
): AgentFormState {
  const initial = buildInitialAgentFormState(agent)
  if (!agent && !initial.model && defaultModelId?.trim()) {
    initial.model = defaultModelId.trim()
  }
  return initial
}

export function applyAgentFormPatch(
  current: AgentFormState,
  patch: Partial<AgentFormState>,
  _tools: Tool[] = []
): AgentFormState {
  void _tools
  const next: AgentFormState = { ...current, ...patch }

  if (hasOwn(patch, 'disabledTools')) {
    next.disabledTools = uniqueStrings(next.disabledTools)
  }

  if (hasOwn(patch, 'permissionMode')) {
    next.permissionMode = normalizePermissionMode(patch.permissionMode)
  }

  return applySoulModeLinkage(current, next, patch)
}

export function buildCreateAgentPayload(
  form: AgentFormState,
  type: AgentType = 'claude-code'
): CreateAgentDto {
  const disabledTools = uniqueStrings(form.disabledTools)

  return {
    type,
    name: form.name.trim(),
    model: form.model.trim() as UniqueModelId,
    description: form.description || undefined,
    instructions: form.instructions || undefined,
    planModel: form.planModel || undefined,
    smallModel: form.smallModel || undefined,
    mcps: form.mcps.length > 0 ? form.mcps : undefined,
    disabledTools: disabledTools.length > 0 ? disabledTools : undefined,
    configuration: buildConfigurationPayload(form)
  }
}

export function validateAgentCreateForm(form: AgentFormState): AgentCreateValidation {
  const nameMissing = form.name.trim() === ''
  const modelMissing = form.model.trim() === ''

  return {
    nameMissing,
    modelMissing,
    isValid: !nameMissing && !modelMissing
  }
}

export function isCreatePayloadValid(form: AgentFormState): boolean {
  return validateAgentCreateForm(form).isValid
}

export function diffAgentSaveIntent(
  form: AgentFormState,
  baseline: AgentFormState,
  agent: AgentDetail | null
): AgentSaveIntent | null {
  if (!agent) {
    return isCreatePayloadValid(form)
      ? { kind: 'create', payload: buildCreateAgentPayload(form) }
      : null
  }

  const result = diffAgentUpdate(baseline, form, agent)
  return result ? { kind: 'update', payload: result.dto } : null
}

function applySoulModeLinkage(
  current: AgentFormState,
  next: AgentFormState,
  patch: Partial<AgentFormState>
): AgentFormState {
  // Switching away from bypass permissions turns soul mode off, unless the
  // editor patch also sets the soul toggle explicitly.
  const soulWasNotPartOfThePatch = !hasOwn(patch, 'soulEnabled')
  if (
    hasOwn(patch, 'permissionMode') &&
    soulWasNotPartOfThePatch &&
    current.soulEnabled &&
    next.permissionMode !== 'bypassPermissions'
  ) {
    next.soulEnabled = false
  }

  // Turning soul mode on always selects bypass permissions.
  if (patch.soulEnabled === true && !current.soulEnabled) {
    next.permissionMode = 'bypassPermissions'
  }

  return next
}

function buildConfigurationPayload(form: AgentFormState): AgentConfiguration | undefined {
  const configuration: Record<string, unknown> = {}

  if (form.avatar) {
    configuration.avatar = form.avatar
  }
  if (form.permissionMode) {
    configuration.permission_mode = form.permissionMode
  }
  if (form.maxTurns > 0) {
    configuration.max_turns = form.maxTurns
  }
  if (form.envVarsText.trim()) {
    configuration.env_vars = environmentFromText(form.envVarsText)
  }
  if (form.soulEnabled) {
    configuration.soul_enabled = true
  }

  if (!form.heartbeatEnabled) {
    configuration.heartbeat_enabled = false
  } else if (form.heartbeatInterval > 0 && form.heartbeatInterval !== DEFAULT_HEARTBEAT_INTERVAL) {
    configuration.heartbeat_enabled = true
    configuration.heartbeat_interval = form.heartbeatInterval
  }

  return Object.keys(configuration).length > 0 ? configuration : undefined
}

function formMaxTurns(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }
  if (value <= 0 || value === DEFAULT_MAX_TURNS) {
    return 0
  }
  return value
}

function hasOwn(target: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(target, key)
}
