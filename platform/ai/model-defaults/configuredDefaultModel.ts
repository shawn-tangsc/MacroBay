import type {
  ModelDefinition,
  ModelProvider,
  SafeModelProvider
} from '../providers/modelProviderTypes'

/**
 * 「模型服务 → 默认模型」的唯一解析器。
 *
 * 设置里存的是 `providerId:modelId`（空串 = 未选择）；这里只回答一个问题：
 * **这个值现在能不能真的拿来发请求**。能力判据由调用方注入（助手 = chat，
 * 智能体 = claude-code 兼容），解析器不复制任何领域规则。
 */
export type ConfiguredModelRef = {
  providerId: string
  modelId: string
}

export type ConfiguredModelUnavailableReason =
  | 'unset'
  | 'unparsable'
  | 'provider-missing'
  | 'provider-disabled'
  | 'provider-not-ready'
  | 'model-missing'
  | 'model-incompatible'

export type ConfiguredModelResolution =
  | {
      ok: true
      ref: ConfiguredModelRef
      providerName: string
      modelName: string
    }
  | { ok: false; reason: ConfiguredModelUnavailableReason }

/** 主进程持有运行时 Key（`ModelProvider`），渲染层只有脱敏 DTO（`SafeModelProvider`）。 */
export type ResolvableProvider = ModelProvider | SafeModelProvider

export type ResolveConfiguredModelInput = {
  /** 设置里的值：`providerId:modelId`，空串 / null = 未选择。 */
  value: string | null | undefined
  providers: readonly ResolvableProvider[]
  /** 领域判据（例如 `model.capabilities.chat`、智能体兼容性）；缺省 = 不额外限制。 */
  isModelAcceptable?: (provider: ResolvableProvider, model: ModelDefinition) => boolean
}

/** `providerId:modelId` → 引用；格式不对返回 null（空串也算 null）。 */
export function parseConfiguredModelRef(value: string | null | undefined): ConfiguredModelRef | null {
  const trimmed = value?.trim() ?? ''
  const separatorIndex = trimmed.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) return null
  return {
    providerId: trimmed.slice(0, separatorIndex),
    modelId: trimmed.slice(separatorIndex + 1)
  }
}

/**
 * 「能不能拿来发请求」的**凭据**判据（不要求跑过连接检查）。
 *
 * 主进程状态里的 vault 供应商没有明文 `apiKey`（只有 `apiKeyRef`），
 * 渲染层只有 `hasApiKey` / `connectionStatus`；两边必须用同一条规则，
 * 否则"设置里选了默认模型、运行期却当作不可用"。
 */
export function isConfiguredModelProviderReady(provider: ResolvableProvider): boolean {
  if (!provider.enabled) return false
  if (!provider.baseUrl?.trim()) return false
  return 'hasApiKey' in provider
    ? provider.hasApiKey && provider.connectionStatus !== 'unavailable'
    : Boolean(provider.apiKey?.trim() || provider.apiKeyRef)
}

export function resolveConfiguredModel(input: ResolveConfiguredModelInput): ConfiguredModelResolution {
  const ref = parseConfiguredModelRef(input.value)
  if (!ref) return { ok: false, reason: (input.value ?? '').trim() ? 'unparsable' : 'unset' }

  const provider = input.providers.find((entry) => entry.id === ref.providerId)
  if (!provider) return { ok: false, reason: 'provider-missing' }
  if (!provider.enabled) return { ok: false, reason: 'provider-disabled' }
  if (!isConfiguredModelProviderReady(provider)) return { ok: false, reason: 'provider-not-ready' }

  const model = provider.models.find((entry) => entry.id === ref.modelId)
  if (!model) return { ok: false, reason: 'model-missing' }
  if (input.isModelAcceptable && !input.isModelAcceptable(provider, model)) {
    return { ok: false, reason: 'model-incompatible' }
  }

  return {
    ok: true,
    ref,
    providerName: provider.name,
    modelName: model.name
  }
}

/** 解析成功时的 `providerId:modelId`；失败返回 null（调用方自行决定回退或报错）。 */
export function resolveConfiguredModelId(input: ResolveConfiguredModelInput): string | null {
  const resolved = resolveConfiguredModel(input)
  return resolved.ok ? `${resolved.ref.providerId}:${resolved.ref.modelId}` : null
}
