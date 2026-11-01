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
  /** 首次观测到这个失败码的时间（UTC ISO）。 */
  firstObservedAt: string
  /** 最近一次**仍然观测到**它的时间；超过阈值没更新，就说明这是一条旧结论。 */
  lastObservedAt: string
}

/**
 * 判「已下线」需要几次**不同日**的观测。
 *
 * 一次是 404 就下结论太急：供应商维护、路由抖动都会返一次错误码，用户会真的去换模型。
 * 所以要求连续两次、且不在同一天（成功一次就清空，见 `advanceInUseModelPatrol`）。
 */
export const IN_USE_MODEL_RETIRED_CONFIRMATIONS = 2

/** 超过这么多天没有再次确认，横幅的措辞要降级成「上次检查时不可用」。 */
export const IN_USE_MODEL_STALE_AFTER_DAYS = 3

/** 一次观测：`reason` 为 null 表示这次探到了（自愈），或这次失败不构成下线结论。 */
export type InUseModelPatrolObservation = {
  target: InUseModelTarget
  reason: InUseModelRetiredReason | null
}

export type InUseModelPatrolPending = {
  providerId: string
  modelId: string
  modelName: string
  reason: InUseModelRetiredReason
  firstObservedAt: string
  lastObservedAt: string
  /** 观测到该失败码的 UTC 日（`YYYY-MM-DD`），用来要求「不同日」。 */
  observedDays: readonly string[]
}

export type InUseModelPatrolState = {
  pending: readonly InUseModelPatrolPending[]
  retired: readonly InUseModelRetiredItem[]
}

export function createInUseModelPatrolState(): InUseModelPatrolState {
  return { pending: [], retired: [] }
}

/**
 * 把一次巡检结果并进状态。纯函数：不读时钟、不写存储，`now` 由调用方给。
 *
 * 三条规则：
 * - 探到可用（`reason: null`）⇒ 清掉待定与已下线，自愈；
 * - 同一失败码累计到两个不同日 ⇒ 转成「已下线」，记下首末观测时间；
 * - 换了失败码，或只有一天 ⇒ 回到待定，不对外声称已下线。
 */
export function advanceInUseModelPatrol(
  state: InUseModelPatrolState,
  checked: readonly InUseModelPatrolObservation[],
  now: Date
): InUseModelPatrolState {
  const day = now.toISOString().slice(0, 10)
  const at = now.toISOString()
  const pending = new Map(state.pending.map((entry) => [patrolKey(entry.providerId, entry.modelId), entry]))
  const retired = new Map(state.retired.map((entry) => [patrolKey(entry.providerId, entry.modelId), entry]))

  for (const { target, reason } of checked) {
    const key = patrolKey(target.providerId, target.modelId)
    if (reason === null) {
      pending.delete(key)
      retired.delete(key)
      continue
    }

    const previous = pending.get(key)
    const sameReason = previous?.reason === reason
    const observedDays = sameReason
      ? [...new Set([...(previous?.observedDays ?? []), day])]
      : [day]
    const next: InUseModelPatrolPending = {
      providerId: target.providerId,
      modelId: target.modelId,
      modelName: target.modelName,
      reason,
      firstObservedAt: sameReason ? (previous?.firstObservedAt ?? at) : at,
      lastObservedAt: at,
      observedDays
    }
    pending.set(key, next)

    if (observedDays.length >= IN_USE_MODEL_RETIRED_CONFIRMATIONS) {
      retired.set(key, {
        providerId: next.providerId,
        modelId: next.modelId,
        modelName: next.modelName,
        reason: next.reason,
        firstObservedAt: next.firstObservedAt,
        lastObservedAt: next.lastObservedAt
      })
    } else {
      // 只观测到一次，或换了失败码：不保留旧结论，避免拿旧码当新事实。
      retired.delete(key)
    }
  }

  return { pending: [...pending.values()], retired: [...retired.values()] }
}

/** 这条「已下线」结论有多旧。给界面用：决定说「已下线」还是「上次检查时不可用」。 */
export function inUseModelRetiredStaleness(
  item: InUseModelRetiredItem,
  now: Date
): { days: number; stale: boolean } {
  const last = Date.parse(item.lastObservedAt)
  if (!Number.isFinite(last)) return { days: 0, stale: true }
  const days = Math.max(0, Math.floor((now.getTime() - last) / 86_400_000))
  return { days, stale: days >= IN_USE_MODEL_STALE_AFTER_DAYS }
}

function patrolKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`
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
