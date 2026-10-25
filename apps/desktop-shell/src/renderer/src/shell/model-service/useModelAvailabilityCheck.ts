import { useEffect, useRef } from 'react'

import type { ModelDefinition, SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'
import { isModelAvailabilityStale } from '@platform/ai/providers/modelAvailability'

import { isAvailabilityProbeModel } from './modelAvailabilityView'
import { getModelDetectionSnapshot, isDetectionRunning, startModelDetection } from './modelDetectionController'

/**
 * **只测选中的这一个模型**：配置好 / 换了选择之后，若它还没有新鲜结论，就单独探一次。
 *
 * 和「检测模型」全量扫描的区别：
 *  - 永远不会遍历供应商的模型列表，一次 run 只有 `modelIds: [model.id]`；
 *  - 已有新鲜结论（同一指纹）就不发请求；
 *  - 停用 / 没 Key / 非聊天模型 / 媒体模型一律不探；
 *  - 同一配置只尝试一次（失败或让位不在本次会话里重试），避免刷新 → 再探的死循环。
 */
export const MODEL_AVAILABILITY_CHECK_DELAY_MS = 500

export function useModelAvailabilityCheck(input: {
  provider: SafeModelProvider | undefined
  model: ModelDefinition | undefined
  delayMs?: number
}): void {
  const attempted = useRef<string | null>(null)
  const provider = input.provider
  const model = input.model
  const delayMs = input.delayMs ?? MODEL_AVAILABILITY_CHECK_DELAY_MS

  const configKey = provider && model
    ? [
        provider.id,
        model.id,
        provider.apiKeyPreview,
        provider.endpoints.map((endpoint) => `${endpoint.protocol}@${endpoint.baseUrl}`).join(',')
      ].join('|')
    : null
  const needsCheck = Boolean(
    provider
    && model
    && configKey !== null
    && provider.enabled
    && provider.hasApiKey
    && provider.baseUrl.trim()
    && isAvailabilityProbeModel(model)
    && (
      model.availability === undefined
      || isModelAvailabilityStale(
        model.availability,
        { endpoints: provider.endpoints, apiKeyPreview: provider.apiKeyPreview },
        model
      )
    )
  )

  useEffect(() => {
    if (!needsCheck || provider === undefined || model === undefined || configKey === null) return undefined
    if (attempted.current === configKey) return undefined

    const timer = setTimeout(() => {
      // 已有 run（手动或别处的单选）在跑：让位，不叠加请求；下次 provider 刷新会再试。
      if (isDetectionRunning(getModelDetectionSnapshot(), provider.id)) return
      void startModelDetection(provider.id, ['connectivity'], [model.id])
        // 只有真正开跑才记「本配置已尝试」；被拒绝/桥不可用时留到下一次刷新再试。
        .then((runId) => { if (runId !== null) attempted.current = configKey })
        .catch(() => undefined)
    }, delayMs)

    return () => clearTimeout(timer)
  }, [configKey, delayMs, model, needsCheck, provider])
}
