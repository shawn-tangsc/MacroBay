import { useEffect, useRef, useState } from 'react'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import {
  collectInUseModelTargets,
  mergeInUseModelRetiredItems,
  toInUseModelRetiredReason,
  type InUseModelRetiredItem
} from '@platform/ai/providers/inUseModelPatrol'

/**
 * PLAT-75：**启动时 + 每天一次**的"在用模型"巡检。
 *
 * 只探 `collectInUseModelTargets` 选出的少数模型（默认聊天模型 + 智能体绑定，最多 3 个），
 * 复用既有 `testConnection` 通道（`modelId` 是既有 additive 参数，不新增通道/preload）。
 * 只有 `model_retired` / `model_not_found` 才进提示；限流、网络失败、鉴权错误一律忽略。
 * 全程不写日志、不把 Key 带进渲染层（Key 只在主进程解析）。
 */
export const IN_USE_MODEL_PATROL_INTERVAL_MS = 24 * 60 * 60 * 1000

type UseInUseModelPatrolInput = {
  providers: readonly SafeModelProvider[]
  /** 智能体绑定的 `providerId:modelId`；由调用方从智能体状态里取。 */
  loadAgentModelIds: () => Promise<readonly string[]>
  /** 模型服务页「默认模型」的 `providerId:modelId` 列表（空串已过滤）。 */
  configuredDefaultModelIds?: readonly string[]
  intervalMs?: number
  enabled?: boolean
}

export function useInUseModelPatrol(input: UseInUseModelPatrolInput): InUseModelRetiredItem[] {
  const [retired, setRetired] = useState<InUseModelRetiredItem[]>([])
  const running = useRef(false)
  const latest = useRef(input)

  latest.current = input

  useEffect(() => {
    if (input.enabled === false) return
    let cancelled = false

    async function runOnce(): Promise<void> {
      if (running.current || cancelled) return
      running.current = true
      try {
        const { providers, loadAgentModelIds, configuredDefaultModelIds } = latest.current
        const agentModelIds = await loadAgentModelIds().catch(() => [])
        const targets = collectInUseModelTargets({ providers, agentModelIds, configuredDefaultModelIds })
        if (targets.length === 0) return
        const checked: Array<{ target: (typeof targets)[number]; reason: ReturnType<typeof toInUseModelRetiredReason> }> = []
        for (const target of targets) {
          const result = await window.platform.modelProviders
            .testConnection(target.providerId, { modelId: target.modelId })
            .catch(() => null)
          checked.push({
            target,
            reason: toInUseModelRetiredReason(
              (result as { failureCode?: Parameters<typeof toInUseModelRetiredReason>[0] } | null)?.failureCode ?? null
            )
          })
        }
        if (cancelled) return
        setRetired((previous) => mergeInUseModelRetiredItems(previous, checked))
      } finally {
        running.current = false
      }
    }

    void runOnce()
    const timer = setInterval(() => void runOnce(), input.intervalMs ?? IN_USE_MODEL_PATROL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
    // 供应商列表加载/变化时补一次巡检（启动时 providers 通常还是空数组）。
  }, [input.enabled, input.intervalMs, input.providers])

  return retired
}
