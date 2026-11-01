import type { ProviderConnectionFailureCode } from './providerFailureMapping'
import {
  advanceInUseModelPatrol,
  collectInUseModelTargets,
  createInUseModelPatrolState,
  toInUseModelRetiredReason,
  type InUseModelPatrolObservation,
  type InUseModelPatrolState,
  type InUseModelRetiredItem
} from './inUseModelPatrol'

/**
 * 「在用模型」巡检的**调度者**，住在主进程。
 *
 * 它原本住在渲染层（`useInUseModelPatrol`）：一个 `setInterval` 在界面上按天发测试请求。
 * 那违反两条口径——界面层不承担外部请求，也不承担调度；而且窗口关掉巡检就停、开两个窗口就发两遍。
 *
 * 这里只负责「什么时候探、探完记下来」；探什么、怎么判定仍是 `inUseModelPatrol` 的纯函数，
 * 真正的请求由注入的 `testConnection` 发出（主进程解析 Key，渲染层永远拿不到凭据）。
 */
export type InUseModelPatrolRuntimeDeps = {
  listProviders: () => Promise<readonly {
    id: string
    enabled: boolean
    apiKeyRef?: string
    defaultChatModelId?: string
    models: ReadonlyArray<{ id: string; name?: string }>
  }[]>
  loadAgentModelIds: () => Promise<readonly string[]>
  configuredDefaultModelIds?: () => Promise<readonly string[]>
  testConnection: (
    providerId: string,
    modelId: string
  ) => Promise<{ failureCode?: ProviderConnectionFailureCode | null } | null>
  now?: () => Date
}

export type InUseModelPatrolRuntime = {
  runOnce: () => Promise<readonly InUseModelRetiredItem[]>
  getRetired: () => readonly InUseModelRetiredItem[]
}

export function createInUseModelPatrolRuntime(deps: InUseModelPatrolRuntimeDeps): InUseModelPatrolRuntime {
  let state: InUseModelPatrolState = createInUseModelPatrolState()
  let running = false

  async function runOnce(): Promise<readonly InUseModelRetiredItem[]> {
    if (running) return state.retired
    running = true
    try {
      const agentModelIds = await deps.loadAgentModelIds().catch(() => [])
      const configuredDefaultModelIds = await deps.configuredDefaultModelIds?.().catch(() => []) ?? []
      const providers = await deps.listProviders()
      const targets = collectInUseModelTargets({
        providers,
        agentModelIds,
        configuredDefaultModelIds
      })
      if (targets.length === 0) return state.retired

      const checked: InUseModelPatrolObservation[] = []
      for (const target of targets) {
        const result = await deps.testConnection(target.providerId, target.modelId).catch(() => null)
        checked.push({ target, reason: toInUseModelRetiredReason(result?.failureCode ?? null) })
      }
      // 一次观测不足以判下线：判据在纯函数里，这里只负责传时间与累积状态。
      state = advanceInUseModelPatrol(state, checked, (deps.now ?? (() => new Date()))())
      return state.retired
    } finally {
      running = false
    }
  }

  return {
    runOnce,
    getRetired: () => state.retired
  }
}
