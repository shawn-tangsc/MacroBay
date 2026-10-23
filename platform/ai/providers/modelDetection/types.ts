import type { ModelChatProtocol } from '../modelProviderTypes'
import type { ProviderConnectionFailureCode } from '../providerFailureMapping'

/**
 * 「检测模型」的两种模式（可多选）：
 *  - `connectivity`：模型能不能用（全部文本模型，含 embedding / rerank）；
 *  - `protocol`：只测**已配置**的聊天协议端点（仅 chat 模型）。
 *
 * 结果只存内存：这些类型不落到 provider / model 记录上。
 */
export type ModelDetectionMode = 'connectivity' | 'protocol'

export type ModelDetectionStatus = 'pending' | 'running' | 'ok' | 'failed' | 'skipped' | 'cancelled'

export type ModelDetectionReasonCode =
  | ProviderConnectionFailureCode
  | 'endpoint_unsupported'
  | 'endpoint_missing'
  | 'cancelled'
  | 'network_error'

export type ModelDetectionSkipReasonCode =
  | 'non_text_generation'
  | 'provider_disabled'
  | 'not_chat_model'
  | 'protocol_not_configured'

export type ModelConnectivityOutcome =
  | { status: 'ok' }
  | { status: 'failed'; reasonCode: ModelDetectionReasonCode; detail?: string }
  | { status: 'skipped'; reasonCode: ModelDetectionSkipReasonCode }
  | { status: 'cancelled' }

export type ModelProtocolProbeOutcome = {
  protocol: ModelChatProtocol
  ok: boolean
  reasonCode?: ModelDetectionReasonCode
  /**
   * 该结论**复用了同模型联通性探测**（`url + body` 完全相同，没有再发一次请求）。
   *
   * 复用 ≠ 没测：供应商只有一个端点时（最常见：只配 chat/completions），协议项与联通性
   * 请求逐字相同，结论照常落地并打上这个标记，好让 UI 说清"这条协议是复用来的"。
   */
  reused?: boolean
}

export type ModelDetectionResult = {
  runId: string
  modelId: string
  /** 汇总状态：多模式时任一 failed ⇒ failed；否则 skipped 优先于 ok。 */
  status: Exclude<ModelDetectionStatus, 'pending' | 'running'>
  reasonCode?: ModelDetectionReasonCode
  connectivity?: ModelConnectivityOutcome
  protocols?: ModelProtocolProbeOutcome[]
  protocolSkipReason?: ModelDetectionSkipReasonCode | 'missing_api_key'
  declaredProtocolFailures?: ModelChatProtocol[]
}

export type ModelDetectionOutcome = {
  results: ModelDetectionResult[]
  cancelled: boolean
}

export const MODEL_DETECTION_CONCURRENCY = 5
export const MODEL_DETECTION_TIMEOUT_MS = 15_000

/** 图片 / 视频 / 语音 / 转写：会产生媒体、消耗不可控，联通性检测直接跳过。 */
export function isNonTextGenerationModel(capabilities: {
  imageGeneration?: boolean
  videoGeneration?: boolean
  speech?: boolean
  transcription?: boolean
}): boolean {
  return Boolean(
    capabilities.imageGeneration
    || capabilities.videoGeneration
    || capabilities.speech
    || capabilities.transcription
  )
}
