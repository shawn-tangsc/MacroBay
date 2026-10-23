import type { ProviderConnectionFailureCode } from './providerFailureMapping'

/**
 * PLAT-75：**在用模型巡检**（只探"用户真的在用"的少数模型，不做全量扫描）。
 *
 * 目标集合 = 已启用且有 Key 的供应商的**默认聊天模型** + 智能体绑定的模型，去重后最多 3 个。
 * 结论只认两类：`model_retired` / `model_not_found`；限流、网络、鉴权、5xx 一律不算"下线"
 *（否则会误报，用户被告知换模型但其实只是网络抖了一下）。
 *
 * 纯函数、无 I/O、不写日志：探测本身由调用方用平台 fetch 执行，这里只负责选目标与判定。
 */
export type InUseModelSource = 'default' | 'agent' | 'configured'

export type InUseModelTarget = {
  providerId: string
  modelId: string
  modelName: string
  source: InUseModelSource
}

export type InUseModelRetiredReason = 'retired' | 'not_found'

export type InUseModelRetiredItem = {
  providerId: string
  modelId: string
  modelName: string
  reason: InUseModelRetiredReason
}

type ProviderShape = {
  id: string
  enabled: boolean
  /** 有 vault 引用才算"配好了 Key"；明文 Key 不会出现在渲染层数据里。 */
  apiKeyRef?: string
  defaultChatModelId?: string
  models: ReadonlyArray<{ id: string; name?: string }>
}

/** `providerId:modelId`（智能体绑定的是一个复合 id）。模型 id 里可能有冒号，只按第一个冒号切。 */
export function splitUniqueModelId(value: string): { providerId: string; modelId: string } | null {
  const trimmed = value.trim()
  const index = trimmed.indexOf(':')
  if (index <= 0 || index === trimmed.length - 1) return null
  return { providerId: trimmed.slice(0, index), modelId: trimmed.slice(index + 1) }
}

export function collectInUseModelTargets(input: {
  providers: readonly ProviderShape[]
  agentModelIds?: readonly string[]
  /** 模型服务页「默认模型」（助手 / 智能体…）：用户显式选过，必须一起巡检。 */
  configuredDefaultModelIds?: readonly string[]
  limit?: number
}): InUseModelTarget[] {
  const limit = input.limit ?? 3
  const providersById = new Map(input.providers.map((provider) => [provider.id, provider]))
  const targets: InUseModelTarget[] = []
  const seen = new Set<string>()

  const push = (providerId: string, modelId: string, source: InUseModelSource): void => {
    const key = `${providerId}:${modelId}`
    if (seen.has(key)) return
    const provider = providersById.get(providerId)
    if (!provider?.enabled) return
    const model = provider.models.find((item) => item.id === modelId)
    if (!model) return
    seen.add(key)
    targets.push({ providerId, modelId, modelName: model.name?.trim() || model.id, source })
  }

  // 用户显式选择的默认模型排最前：被挤掉的应该是"供应商自带默认"，不是用户的选择。
  for (const uniqueModelId of input.configuredDefaultModelIds ?? []) {
    if (targets.length >= limit) break
    const parsed = splitUniqueModelId(uniqueModelId)
    if (!parsed) continue
    push(parsed.providerId, parsed.modelId, 'configured')
  }
  for (const provider of input.providers) {
    if (targets.length >= limit) break
    if (!provider.enabled || !provider.apiKeyRef || !provider.defaultChatModelId) continue
    push(provider.id, provider.defaultChatModelId, 'default')
  }
  for (const uniqueModelId of input.agentModelIds ?? []) {
    if (targets.length >= limit) break
    const parsed = splitUniqueModelId(uniqueModelId)
    if (!parsed) continue
    push(parsed.providerId, parsed.modelId, 'agent')
  }
  return targets
}

/** 只有"模型生命周期"结论才算下线；其它失败保持沉默。 */
export function toInUseModelRetiredReason(
  failureCode: ProviderConnectionFailureCode | null | undefined
): InUseModelRetiredReason | null {
  if (failureCode === 'model_retired') return 'retired'
  if (failureCode === 'model_not_found') return 'not_found'
  return null
}

/**
 * 合并巡检结果：同一模型只留一条（重复巡检不叠加）；本次确认可用的旧条目会被移除（自愈）。
 */
export function mergeInUseModelRetiredItems(
  previous: readonly InUseModelRetiredItem[],
  checked: ReadonlyArray<{ target: InUseModelTarget; reason: InUseModelRetiredReason | null }>
): InUseModelRetiredItem[] {
  const checkedKeys = new Set(checked.map(({ target }) => `${target.providerId}:${target.modelId}`))
  const merged = previous.filter((item) => !checkedKeys.has(`${item.providerId}:${item.modelId}`))
  const seen = new Set(merged.map((item) => `${item.providerId}:${item.modelId}`))

  for (const { target, reason } of checked) {
    if (reason === null) continue
    const key = `${target.providerId}:${target.modelId}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push({
      providerId: target.providerId,
      modelId: target.modelId,
      modelName: target.modelName,
      reason
    })
  }
  return merged
}
