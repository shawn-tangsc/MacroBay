import type { AppLanguage } from '../../../settings/schema/appSettings'
import type { AgentEntity } from '../schemas/agentSchemas'
import type { AgentSessionEntity } from '../schemas/sessionSchemas'
import type { AgentStoreSeed, AgentStoreState } from '../store/agentStore'

/**
 * 内置种子文案的「当前语言视图」。
 *
 * 种子的 name / description / instructions 会随 seed 落进 SQLite，但这些字符串是平台或产品代码
 * 定义的内置文案，不是用户数据（和默认助手、默认工作区一样）。这里按 agent / session id 把
 * 仍是**任一语言原版**（或为空）的字段换成当前语言；用户改过的字段、用户自建条目、会话内容
 * 一律保持原样。
 *
 * 因为对齐的是「定义」而不是「某个版本的库」，切换语言只需要重新跑一次这个纯函数，
 * 不需要一次性数据迁移，也不需要记住上次语言。
 */
export type BuiltinSeedLanguageVariant = {
  language: AppLanguage
  seed: AgentStoreSeed
}

type LocalizableAgentField = 'name' | 'description' | 'instructions'
type LocalizableSessionField = 'name' | 'description'

type AgentCopy = Record<LocalizableAgentField, string | undefined>
type SessionCopy = Record<LocalizableSessionField, string | undefined>

const agentFields: readonly LocalizableAgentField[] = ['name', 'description', 'instructions']
const sessionFields: readonly LocalizableSessionField[] = ['name', 'description']

export function localizeBuiltinSeedCopy(
  state: AgentStoreState,
  language: AppLanguage,
  variants: readonly BuiltinSeedLanguageVariant[]
): AgentStoreState {
  const agentVariants = indexAgentVariants(variants)
  const sessionVariants = indexSessionVariants(variants)
  if (agentVariants.size === 0 && sessionVariants.size === 0) return state

  let changed = false
  const agents = state.agents.map((agent) => {
    const localized = localizeAgent(agent, agentVariants, language)
    if (localized !== agent) changed = true
    return localized
  })
  const sessions = state.sessions.map((session) => {
    const localized = localizeSession(session, sessionVariants, language)
    if (localized !== session) changed = true
    return localized
  })
  return changed ? { ...state, agents, sessions } : state
}

function indexAgentVariants(
  variants: readonly BuiltinSeedLanguageVariant[]
): Map<string, Map<AppLanguage, AgentCopy>> {
  const byId = new Map<string, Map<AppLanguage, AgentCopy>>()
  for (const variant of variants) {
    for (const agent of variant.seed.agents ?? []) {
      const copies = byId.get(agent.id) ?? new Map<AppLanguage, AgentCopy>()
      copies.set(variant.language, {
        name: agent.name,
        description: agent.description,
        instructions: agent.instructions
      })
      byId.set(agent.id, copies)
    }
  }
  return dropIncompleteEntries(byId, variants.length)
}

function indexSessionVariants(
  variants: readonly BuiltinSeedLanguageVariant[]
): Map<string, Map<AppLanguage, SessionCopy>> {
  const byId = new Map<string, Map<AppLanguage, SessionCopy>>()
  for (const variant of variants) {
    for (const session of variant.seed.sessions ?? []) {
      const copies = byId.get(session.id) ?? new Map<AppLanguage, SessionCopy>()
      copies.set(variant.language, { name: session.name, description: session.description })
      byId.set(session.id, copies)
    }
  }
  return dropIncompleteEntries(byId, variants.length)
}

/**
 * 只有每种支持语言都定义过的条目才算「内置定义」；缺一种语言的条目说明它来自 user data，
 * 不参与对齐。
 */
function dropIncompleteEntries<T>(
  byId: Map<string, Map<AppLanguage, T>>,
  languageCount: number
): Map<string, Map<AppLanguage, T>> {
  for (const [id, copies] of byId) {
    if (copies.size !== languageCount) byId.delete(id)
  }
  return byId
}

function localizeAgent(
  agent: AgentEntity,
  variants: Map<string, Map<AppLanguage, AgentCopy>>,
  language: AppLanguage
): AgentEntity {
  const copies = variants.get(agent.id)
  const target = copies?.get(language)
  if (!copies || !target) return agent

  let next = agent
  for (const field of agentFields) {
    const localized = resolveLocalizedField(
      agent[field],
      target[field],
      [...copies.values()].map((copy) => copy[field])
    )
    if (localized !== null) next = { ...next, [field]: localized }
  }
  return next
}

function localizeSession(
  session: AgentSessionEntity,
  variants: Map<string, Map<AppLanguage, SessionCopy>>,
  language: AppLanguage
): AgentSessionEntity {
  const copies = variants.get(session.id)
  const target = copies?.get(language)
  if (!copies || !target) return session

  let next = session
  for (const field of sessionFields) {
    const localized = resolveLocalizedField(
      session[field],
      target[field],
      [...copies.values()].map((copy) => copy[field])
    )
    if (localized !== null) next = { ...next, [field]: localized }
  }
  return next
}

/** 返回 null 表示「不改」，避免无改动时生成新对象。 */
function resolveLocalizedField(
  current: string | undefined,
  target: string | undefined,
  variants: readonly (string | undefined)[]
): string | null {
  const targetValue = target?.trim()
  if (!targetValue) return null
  const currentValue = current?.trim() ?? ''
  if (currentValue === targetValue) return null
  // 空值视为未填写；其余只有仍等于某个语言原版时才算「内置文案未被用户改过」。
  const stillBuiltin = currentValue === '' || variants.some((variant) => variant?.trim() === currentValue)
  return stillBuiltin ? targetValue : null
}
