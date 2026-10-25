import { useEffect, useRef, useState } from 'react'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import { autoModelDetectionSignature, planAutoModelDetection } from './autoModelDetectionPlan'
import { getModelDetectionSnapshot, isDetectionRunning, startModelDetection } from './modelDetectionController'

/**
 * 配置好 / 模型变更后**自动**跑一次联通性检测（不弹窗，不走手动入口）。
 *
 * 触发面：签名（Key/端点/模型集合）变了才排期；同一签名只跑一次。
 * 只依赖签名字符串而不是 provider 对象：保存后的 refresh 会换对象但签名不变，
 * 不能因此把已经排期的定时器清掉。
 * 让位规则：已有 run（手动或自动）在跑 ⇒ 这一轮不重复发请求。
 * 结果：主进程落库（`recordModelAvailability`），AppShell 的 done 事件会刷新一次列表。
 */
export const AUTO_MODEL_DETECTION_DELAY_MS = 1_200

export type AutoModelDetectionOutcome = {
  started: number
  /** 候选里因单批上限没测的数量。 */
  skipped: number
}

export function useAutoModelDetection(input: {
  provider: SafeModelProvider | null
  delayMs?: number
  enabled?: boolean
}): AutoModelDetectionOutcome | null {
  const [outcome, setOutcome] = useState<AutoModelDetectionOutcome | null>(null)
  const signatureRef = useRef<string | null>(null)
  const providerRef = useRef(input.provider)
  providerRef.current = input.provider

  const providerId = input.provider?.id ?? null
  const signature = input.provider === null ? null : autoModelDetectionSignature(input.provider)
  const delayMs = input.delayMs ?? AUTO_MODEL_DETECTION_DELAY_MS
  const enabled = input.enabled !== false

  // 切换供应商时把上一家的提示收掉（结果与提示都属于某一家）。
  useEffect(() => {
    setOutcome(null)
  }, [providerId])

  useEffect(() => {
    if (!enabled || signature === null) return undefined
    if (signature === signatureRef.current) return undefined

    const timer = setTimeout(() => {
      signatureRef.current = signature
      const provider = providerRef.current
      if (provider === null) return
      // 已有 run 在跑：让它测完（手动入口本来就是全量），这一轮不再叠加请求。
      if (isDetectionRunning(getModelDetectionSnapshot(), provider.id)) return
      const plan = planAutoModelDetection(provider)
      if (!plan) return
      setOutcome({ started: plan.modelIds.length, skipped: plan.skipped })
      void startModelDetection(provider.id, ['connectivity'], plan.modelIds).catch(() => undefined)
    }, delayMs)

    return () => clearTimeout(timer)
  }, [delayMs, enabled, signature])

  return outcome
}
