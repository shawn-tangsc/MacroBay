import type {
  ModelDetectionReasonCode,
  ModelDetectionResult,
  ModelDetectionSkipReasonCode,
  ModelProtocolProbeOutcome
} from '@platform/ai/providers/modelDetection/types'
import type { ModelChatProtocol, ModelDefinition } from '@platform/ai/providers/modelProviderTypes'

import type { PlatformText } from '../../i18n/platformText'

import type { ModelDetectionRun } from './modelDetectionController'
import { modelProtocolLabel } from './modelProtocolFilter'
import { probeReasonLabel, probeSkipReasonLabel } from './modelProbeReason'
import type { ModelDetectionModelStatus } from './useModelDetection'

/**
 * PLAT-82：本会话检测结果的**展示派生**（唯一实现；模型行与检测弹窗直接读它）。
 *
 * 只读内存里的 `ModelDetectionResult`，绝不碰持久字段：
 *  - 行内文案：`测试中…` / `成功` / `失败：<原因>` / `跳过：<原因>` / `已停止`，
 *    本次 run 勾了「协议支持」时再追加 ` · 协议 <通>/<总数>`；
 *  - 行内 title：逐协议明细（`chat-completions ✓ · messages ✗ 端点不支持`），
 *    协议探测复用联通性结论时标「复用联通性」；
 *  - 弹窗汇总：`协议支持：已测 N 个模型，M 项不通`（M=0 ⇒ 全部通过）；
 *  - 标红：只认 `model.declaredProtocols` ∩ 本次失败协议（厂商声明不被检测结论覆盖）。
 */
export function detectionSkipReasonOf(
  result: ModelDetectionResult | undefined
): ModelDetectionSkipReasonCode | undefined {
  if (!result) return undefined
  if (result.connectivity?.status === 'skipped') return result.connectivity.reasonCode
  // `missing_api_key` 走 failed（见 detect.ts 前置），这里仅防御性忽略。
  return result.protocolSkipReason === 'missing_api_key' ? undefined : result.protocolSkipReason
}

/** 本模型协议探测的通过/总数；没跑协议探测（或整项被跳过）⇒ `undefined`。 */
export type ProtocolOutcomeSummary = {
  total: number
  passed: number
  failed: ModelProtocolProbeOutcome[]
}

export function protocolOutcomeSummary(
  result: ModelDetectionResult | undefined
): ProtocolOutcomeSummary | undefined {
  const protocols = result?.protocols
  if (!protocols || protocols.length === 0) return undefined
  const failed = protocols.filter((entry) => !entry.ok)
  return { total: protocols.length, passed: protocols.length - failed.length, failed }
}

/** 逐协议明细：`chat-completions ✓ · messages ✗ 端点不支持`（复用的结论会标明来源）。 */
export function protocolOutcomeDetail(
  labels: PlatformText['models'],
  result: ModelDetectionResult | undefined
): string {
  const protocols = result?.protocols ?? []
  return protocols
    .map((entry) => {
      const name = modelProtocolLabel(labels, entry.protocol)
      const reused = entry.reused ? `（${labels.detectionProtocolReusedBadge}）` : ''
      return entry.ok
        ? `${name} ✓${reused}`
        : `${name} ✗ ${probeReasonLabel(labels, entry.reasonCode)}${reused}`
    })
    .join(' · ')
}

/** 基础状态文案（不含协议摘要）。 */
function baseStatusText(
  labels: PlatformText['models'],
  status: ModelDetectionModelStatus,
  result: ModelDetectionResult | undefined
): string {
  if (status === 'testing') return labels.detectionStatusLabel('testing')
  if (status === 'ok') return labels.detectionStatusLabel('ok')
  if (status === 'cancelled') return labels.detectStopped
  if (status === 'skipped') {
    return labels.detectionSkippedWithReason(probeSkipReasonLabel(labels, detectionSkipReasonOf(result)))
  }
  return labels.detectionFailedWithReason(probeReasonLabel(labels, result?.reasonCode))
}

/**
 * 行内状态：`成功 · 协议 2/2`。
 *
 * 协议摘要只在**本次 run 真的跑了协议探测**时追加（`protocols` 非空）；跳过协议模式
 * （供应商未启用 / 非聊天模型 / 未配置端点）时不加，那行已经有"跳过：原因"了。
 */
export function detectionStatusText(
  labels: PlatformText['models'],
  status: ModelDetectionModelStatus,
  result: ModelDetectionResult | undefined
): string {
  const base = baseStatusText(labels, status, result)
  const summary = protocolOutcomeSummary(result)
  if (!summary) return base
  return `${base} · ${labels.detectionProtocolCount(summary.passed, summary.total)}`
}

/** 行内状态的 title：状态 + 逐协议明细（没有协议明细时就等于状态本身）。 */
export function detectionStatusTitle(
  labels: PlatformText['models'],
  status: ModelDetectionModelStatus,
  result: ModelDetectionResult | undefined
): string {
  const statusText = detectionStatusText(labels, status, result)
  const detail = protocolOutcomeDetail(labels, result)
  return detail ? `${statusText} · ${detail}` : statusText
}

/**
 * 弹窗汇总（该供应商**本次** run）：勾了协议模式才返回，且只数真有协议结论的模型。
 *
 * `failed` 里的取消不算"不通"（那是用户停的，不是协议不支持）。
 */
export function protocolRunSummary(
  run: ModelDetectionRun | undefined
): { models: number; failed: number } | undefined {
  if (!run || !run.modes.includes('protocol')) return undefined
  let models = 0
  let failed = 0
  for (const result of Object.values(run.results)) {
    const summary = protocolOutcomeSummary(result)
    if (!summary) continue
    models += 1
    failed += summary.failed.filter((entry) => entry.reasonCode !== 'cancelled').length
  }
  if (models === 0) return undefined
  return { models, failed }
}

/** 本次检测里**厂商声明过却失败**的协议（交集；为空 ⇒ 不标红）。 */
/**
 * 本次 run 里**没通**的协议（不落库，只用于行内提示）。
 *
 * 与 `failedDeclaredProtocols` 的分工：那个负责"厂商声明过却失败 ⇒ 标红"；
 * 这个负责"历史上通过/按端点推断过、本次却没通 ⇒ 给一个黄色小点"，
 * 免得行内两个 chip + 行尾「协议 1/2」看起来自相矛盾。
 */
export function thisRunFailedProtocolReasons(
  result: ModelDetectionResult | undefined
): ReadonlyMap<ModelChatProtocol, ModelDetectionReasonCode> {
  const failed = new Map<ModelChatProtocol, ModelDetectionReasonCode>()
  for (const entry of result?.protocols ?? []) {
    if (entry.ok) continue
    failed.set(entry.protocol, entry.reasonCode ?? 'unknown')
  }
  return failed
}

export function failedDeclaredProtocols(
  model: Pick<ModelDefinition, 'declaredProtocols'>,
  result: ModelDetectionResult | undefined
): ModelChatProtocol[] {
  const failed = new Set(result?.declaredProtocolFailures ?? [])
  if (failed.size === 0) return []
  return (model.declaredProtocols ?? []).filter((protocol) => failed.has(protocol))
}
