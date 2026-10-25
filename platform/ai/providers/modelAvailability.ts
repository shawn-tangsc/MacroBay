import type {
  ModelAvailability,
  ModelDefinition,
  ProviderChatEndpoint
} from './modelProviderTypes'

/**
 * 模型可用性结论的**配置指纹**（唯一实现）。
 *
 * 用途：判断「上次检测说这个模型可用」是否仍然适用于当前配置。
 * 指纹只使用渲染层也能拿到的字段（端点清单、Key 掩码、模型 id / 协议 / 能力），
 * 因此主进程写结论与渲染层判过期可以用同一个函数、得到同一个值。
 *
 * 会改变探测请求或探测口径的字段都必须进来：
 *  - 端点机器可判定「请求打到哪」，Key 掩码可判定「换没换 Key」；
 *  - 模型 id / `chatProtocol` / chat·embedding·rerank 能力决定「用哪种请求探」。
 *
 * 不进来：显示名、分组、价格、启用开关 —— 它们不影响探测结论。
 */
export type ModelAvailabilityFingerprintInput = {
  endpoints: ReadonlyArray<Pick<ProviderChatEndpoint, 'protocol' | 'baseUrl'>>
  /** 掩码预览（`sk-a**********wxyz`）；换 Key 时它会变，足以让结论过期。 */
  apiKeyPreview?: string
}

type FingerprintModel = Pick<ModelDefinition, 'id' | 'chatProtocol' | 'capabilities'>

function normalizeBase(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/u, '')
}

function hashText(value: string): string {
  // 与 `providerPresetMerge` 同款 djb2：纯 JS、不依赖 node:crypto，渲染层也能跑。
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0
  }
  return `av1-${(hash >>> 0).toString(36)}-${value.length.toString(36)}`
}

export function modelAvailabilityFingerprint(
  config: ModelAvailabilityFingerprintInput,
  model: FingerprintModel
): string {
  const capabilities = model.capabilities
  const parts = [
    // 端点顺序即优先级（`[0]` = 默认端点），所以按顺序拼接。
    config.endpoints.map((endpoint) => `${endpoint.protocol}|${normalizeBase(endpoint.baseUrl)}`).join('>'),
    (config.apiKeyPreview ?? '').trim(),
    model.id,
    model.chatProtocol ?? '',
    capabilities.chat ? '1' : '0',
    capabilities.embedding ? '1' : '0',
    capabilities.rerank ? '1' : '0'
  ]
  return hashText(parts.join('\u0000'))
}

/** 结论是否已过期（缺结论也算过期，但调用方通常直接判「没有结论」）。 */
export function isModelAvailabilityStale(
  availability: ModelAvailability | undefined,
  config: ModelAvailabilityFingerprintInput,
  model: FingerprintModel
): boolean {
  if (!availability) return true
  return availability.fingerprint !== modelAvailabilityFingerprint(config, model)
}

const MAX_REASON_LENGTH = 64
const MAX_FINGERPRINT_LENGTH = 128

function normalizeReasonCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_REASON_LENGTH) return undefined
  // 原因码只允许短横线分隔的小写短码；脏值直接丢弃（宁可不显示原因）。
  return /^[a-z][a-z0-9_]*$/u.test(trimmed) ? trimmed : undefined
}

/** 持久化/加载边界：脏值整条丢弃，不做半截修补。 */
export function normalizeModelAvailability(value: unknown): ModelAvailability | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<ModelAvailability>
  if (candidate.status !== 'ok' && candidate.status !== 'failed') return undefined
  const checkedAt = typeof candidate.checkedAt === 'string' ? candidate.checkedAt.trim() : ''
  if (!checkedAt || Number.isNaN(Date.parse(checkedAt))) return undefined
  const fingerprint = typeof candidate.fingerprint === 'string' ? candidate.fingerprint.trim() : ''
  if (!fingerprint || fingerprint.length > MAX_FINGERPRINT_LENGTH) return undefined
  const reasonCode = normalizeReasonCode(candidate.reasonCode)
  return {
    status: candidate.status,
    ...(reasonCode ? { reasonCode } : {}),
    checkedAt,
    fingerprint
  }
}

/** 一次检测 run 结束后要写回的结论（只含 `ok` / `failed`）。 */
export type ModelAvailabilityUpdate = {
  modelId: string
  status: 'ok' | 'failed'
  reasonCode?: string
}
