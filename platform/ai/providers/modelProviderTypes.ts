export type ModelCapabilities = {
  chat: boolean
  /** PLAT-62：以下能力均为可选；**没有真实信息就不写**（UI 不显示假 chip）。 */
  tools?: boolean
  vision?: boolean
  reasoning?: boolean
  embedding?: boolean
  /** PLAT-76：重排（rerank），与 embedding 分开计。 */
  rerank?: boolean
  imageGeneration?: boolean
  videoGeneration?: boolean
  /** PLAT-76：语音合成（TTS）；旧 `audio: true` 在加载期迁移到这里。 */
  speech?: boolean
  /** PLAT-76：语音转写（ASR）。 */
  transcription?: boolean
  /**
   * OCR（图片 → 文本）专长标记。与 `vision`（能读图）分开计：
   * OCR 模型通常仍走 chat/completions（VLM），只是输入被限定为图片。
   */
  ocr?: boolean
  /** 旧字段：只在读取老数据时出现，归一化时映射为 `speech`。 */
  audio?: boolean
  /** PLAT-62：用户显式编辑过能力后，加载时不再按 id 自动纠正。 */
  capabilitiesEdited?: boolean
  /**
   * 旧标记：早期「智能体」开关。加载期会被 `normalizeModelCapabilities` 归一成
   * `agentRuntimes.claudeCode`；这里保留类型是为了让未归一的运行时读值也类型安全。
   */
  agent?: boolean
  agentRuntimes?: {
    claudeCode?: boolean
    openaiAgents?: boolean
  }
}

export type ModelMessagesSupport = 'yes' | 'no' | 'unknown'

/**
 * 协议声明的来源。
 * `provider_list` = 该模型的 messages/responses 声明来自厂商模型列表（`supports_anthropic`
 * / `supports_responses` / `x_lanyun.api_paths` 等布尔或路径声明）。
 * 供应商默认端点快照（`chatProtocol`）**不**产生它。
 */
export type ModelDeclarationSource = 'provider_list'

export type ModelProbeStatus = 'passed' | 'failed' | 'unsupported'

/**
 * 模型可用性结论：`ok` = 最近一次联通性检测通过，`failed` = 未通过（带原因短码）。
 *
 * 只由主进程写（`providerStore.recordModelAvailability`）；渲染层读 `status` / `reasonCode` /
 * `checkedAt`，并用同一份指纹函数判断是否已过期。
 */
export type ModelAvailability = {
  status: 'ok' | 'failed'
  reasonCode?: string
  /** ISO 时间戳。 */
  checkedAt: string
  /** 写入时的配置指纹；与当前配置不一致 ⇒ 结论过期。 */
  fingerprint: string
}

export type ModelPricing = {
  currency: string
  promptPerMillion: number
  completionPerMillion: number
  cacheReadPerMillion?: number
  hasDiscount?: boolean
  /**
   * 价格的小数位（缺省 2）。给"单价极低"的厂商用：OpenRouter 上一堆
   * `0.049 / 0.375` 每百万的模型，两位小数会全被四舍五入成 `0`。
   * 由 `ModelListShape.pricePrecision` 写入，**不是**按 providerId 判断。
   */
  displayPrecision?: number
}

/**
 * 归一后的价格档位（唯一枚举）：
 * - `free`：免费（0 价或用户手动标记）；
 * - `discount`：有折扣但仍收费；
 * - `paid`：标准付费。
 *
 * 各厂商暴露价格/免费信息的方式不同（per-token / per-1K / 0 价 / 折扣标记），
 * 由模型列表解析层先归一到 `pricing`，再在 `deriveModelPriceTag` 收敛成这一个枚举。
 */
export type ModelPriceTag = 'free' | 'discount' | 'paid'

export type ModelDefinition = {
  /** 来自预设清单（用于「预设变更后清理旧预设模型」；同步/手加模型不得置 true）。 */
  presetModel?: boolean
  id: string
  name: string
  group?: string
  provider?: string
  contextLength?: number
  maxCompletionTokens?: number
  pricing?: ModelPricing
  /**
   * 用户手动标记为免费（只影响选择器筛选与列表徽章，**不修改价格**）。
   * 缺省 = 按价格自动判定；`true` = 视为免费。只持久化 `true`，关闭即删除字段。
   */
  freeOverride?: boolean
  /**
   * 归一后的价格档位。由保存/同步/加载边界统一写入（`deriveModelPriceTag`），
   * 选择器筛选与模型列表图标只读这个字段，不再各自推导。
   */
  priceTag?: ModelPriceTag
  capabilities: ModelCapabilities
  /** PLAT-62：实测的 Anthropic messages 支持情况（持久化；缺省时用前缀规则推断）。 */
  messagesSupport?: ModelMessagesSupport
  /** PLAT-77：OpenAI Responses 协议支持情况（持久化；`yes`/`no` 来自上游声明）。 */
  responsesSupport?: ModelMessagesSupport
  /** PLAT-82：该模型的协议声明来自厂商列表（仅 `messagesSupport`/`responsesSupport` 命中时写）。 */
  declarationSource?: ModelDeclarationSource
  /** PLAT-62：最近一次协议检测时间（ISO）。 */
  protocolProbedAt?: string
  /** PLAT-62：探测结果（passed/unsupported/failed；缺省=从未探测）。 */
  probeStatus?: ModelProbeStatus
  /** PLAT-62：失败原因短码（timeout/http_401/http_429/account_balance_insufficient/...）。 */
  probeReason?: string
  /**
   * 「这个模型上次能不能用」的结论（服务端写入，渲染层只读）。
   *
   * 由检测 run 的联通性结果落库：只写 `ok` / `failed`，跳过与取消不写；
   * `fingerprint` 是写入时的配置指纹（端点 + Key 掩码 + 模型 id / 协议 / 能力），
   * 读取方用 `isModelAvailabilityStale` 判断结论是否还适用于当前配置。
   * 与上面的 `probeStatus` 不同：那三个字段是历史协议探测列，已停止写入。
   */
  availability?: ModelAvailability
  /** PLAT-62：该模型的探测结果来自供应商 /v1/models 声明（同步写入）。 */
  providerDeclared?: boolean
  /**
   * PLAT-63 C：旧预设模型（`presetModel: true`）已不在当前预设清单里。
   * 加载期**只归档不删除**：数据保留、计数/列表/探测候选排除，删除只能由用户在
   * 「获取模型列表」预览的「本地多余（预设已变更）」组里确认。
   */
  presetStale?: boolean
  /**
   * T4/T5：该模型声明的聊天请求协议（厂商模型列表声明或用户显式选择）。
   * **缺省 = 跟随供应商的默认端点（`endpoints[0]`）**（运行时解析，不落默认值）。
   */
  chatProtocol?: ModelChatProtocol
  /**
   * 该模型**支持**的聊天协议集合 = 厂商逐条声明（如 LANYUN `x_lanyun.api_paths`、
   * TokenRhythm `supports_anthropic`/`supports_responses`）∪ 供应商实际可用协议
   * （模型快照的 `chatProtocol` / 供应商默认端点协议）。
   *
   * 与 `chatProtocol` 分工：`chatProtocol` 是**发请求走哪条**，`supportedProtocols` 是
   * **能走哪些**（协议 pill 计数、声明协议失败标红都读它）。
   */
  supportedProtocols?: ModelChatProtocol[]
  /**
   * 厂商**逐条声明**的协议集合（LANYUN `api_paths`、TokenRhythm 布尔、DeepSeek
   * `api_capabilities` 等）。**只有**厂商列表声明会进来，供应商默认端点**绝不**产生它。
   *
   * 分工：`supportedProtocols` = 能走哪些（含默认端点，用于筛选/计数）；
   * `declaredProtocols` = 厂商说支持哪些（用于「声明协议实测失败」标红）。
   */
  declaredProtocols?: ModelChatProtocol[]
  /**
   * **检测证据**：本次/历史检测里**实测通过**的协议集合（持久化，只增不减）。
   *
   * 与另外两个集合的分工：
   *  - `declaredProtocols` = 厂商怎么说（声明）；
   *  - `supportedProtocols` = 能走哪些（声明 ∪ 默认端点 ∪ 实测通过，检测通过后会并进来）；
   *  - `probedProtocols` = 哪几条是**我们自己测出来**的（行内 chip 的「实测通过」来源）。
   *
   * **失败不写**：实测不通过既不删除已声明协议，也不写"不支持"的负结论 ——
   * 失败只体现在本会话的内存状态文案里。
   */
  probedProtocols?: ModelChatProtocol[]
}

/**
 * T4/T5/PLAT-69：聊天请求协议。四种协议平权，没有"内建默认"：
 * 模型没声明时用供应商的默认端点协议，两者都没有 ⇒ 拒绝发送。
 */
export type ModelChatProtocol = 'chat-completions' | 'responses' | 'gemini' | 'messages'

export type ProviderWebsiteLinks = {
  official?: string
  apiKey?: string
  docs?: string
  models?: string
}

export type ProviderSecretConnectionStatus = 'unverified' | 'ready' | 'unavailable'

/**
 * 一个**聊天端点**：某条聊天协议 + 它的端点 base。
 *
 * 端点 base 已去首尾空白与尾斜杠；**空串 = 已声明但还没配置地址**（UI 里"加了一行但没填"），
 * 与"没有这个端点"（数组里没有该协议）是两件事：前者保持行存在，后者表示不支持。
 */
export type ProviderChatEndpoint = {
  readonly protocol: ModelChatProtocol
  /** 该端点的 base（已去尾斜杠）；空串 = 已声明但未配置地址。 */
  readonly baseUrl: string
}

/** 图片端点不是聊天协议（走 OpenAI 兼容的 `/images/*`），单独放；缺省 = 未配置。 */
export type ProviderImageEndpoints = {
  generation?: string
  edit?: string
}

export type ProviderCustomHeader = {
  name: string
  value: string
}

export type SafeProviderCustomHeader = {
  name: string
  value: string
  hasValue: boolean
}

export type ModelProvider = {
  /**
   * 用户显式删除过的**预设模型 id**。预设合并时会跳过它们，避免重启后"又被加回来"；
   * 只记预设来源的 id（同步/手加模型删除后不会被预设重新注入，无需墓碑）。
   */
  removedPresetModelIds?: string[]
  id: string
  name: string
  /**
   * **供应商的聊天端点清单**（唯一事实源）：`[0]` 就是**默认端点**（模型没声明 `chatProtocol`
   * 时跟随它），空数组 = 该供应商还没有任何可用端点。
   *
   * 归属用户库：预设只在缺失时补，绝不覆盖。端点 base 只能通过
   * `providerChatEndpoints.resolveProviderChatBase()` 读取。
   */
  endpoints: ProviderChatEndpoint[]
  /**
   * 用户**手动删除**过的端点协议。预设合并时跳过这些协议，
   * 避免"每重启一次就把删掉的端点加回来"。用户重新添加即清除。
   *
   * 由存储层的唯一写入点按端点清单差分算出（见 `diffRemovedEndpointProtocols`），
   * UI 与 `ModelProviderInput` 都不接受该字段。
   */
  removedEndpointProtocols?: ModelChatProtocol[]
  /** 图片端点（生成 / 编辑）；缺省 = 未配置。 */
  imageEndpoints?: ProviderImageEndpoints
  enabled: boolean
  /**
   * 供应商主地址：**由端点清单派生**（`resolveProviderPrimaryBase`：chat/completions 端点优先，
   * 否则默认端点），不独立写入。登录/连接就绪判断与按主机名取形态的地方读它。
   */
  baseUrl: string
  /** PLAT-62：自定义请求头；注入所有出站请求（禁止覆盖鉴权/主机/长度头）。 */
  customHeaders?: ProviderCustomHeader[]
  /** Main-process runtime key. Never persist this field. */
  apiKey?: string
  /** Main-process secret metadata. Never expose this field to renderer code. */
  apiKeyRef?: string
  /** Main-process-only vault status. Never persist or expose this field to renderer code. */
  apiKeyAvailability?: 'unverified' | 'available' | 'unavailable'
  apiKeyPreview?: string
  apiKeyMigrationState?: 'vault-backed'
  apiKeyStorageVersion?: 1
  isSystem?: boolean
  websites?: ProviderWebsiteLinks
  models: ModelDefinition[]
  defaultChatModelId?: string
}

export type ProviderState = {
  providers: ModelProvider[]
}

/** Stable renderer-safe failure identifiers for a provider runtime. */
export const ProviderRuntimeFailurePolicy = {
  owner: 'platform/ai/providers',
  source: 'main-process provider runtime',
  configurationRequired: 'provider-configuration-required',
  requestFailed: 'provider-request-failed',
  /** PLAT-74：上游已停止提供该模型（retired / no longer available）⇒「该模型已下线」。 */
  modelRetired: 'provider-model-retired',
  /** PLAT-74：模型未开通（model_not_activated）⇒「该模型未开通」。 */
  modelNotActivated: 'provider-model-not-activated',
  /** PLAT-74：404 / 模型不存在 ⇒「该模型不存在或已下线」。 */
  modelNotFound: 'provider-model-not-found'
} as const

export type ProviderRuntimeFailureCode = typeof ProviderRuntimeFailurePolicy.configurationRequired
  | typeof ProviderRuntimeFailurePolicy.requestFailed
  | typeof ProviderRuntimeFailurePolicy.modelRetired
  | typeof ProviderRuntimeFailurePolicy.modelNotActivated
  | typeof ProviderRuntimeFailurePolicy.modelNotFound

export class ProviderRuntimeFailureError extends Error {
  constructor(readonly code: ProviderRuntimeFailureCode) {
    super(code)
    this.name = 'ProviderRuntimeFailureError'
  }
}

export function toProviderRuntimeFailureCode(error: unknown): ProviderRuntimeFailureCode {
  return error instanceof ProviderRuntimeFailureError
    ? error.code
    : ProviderRuntimeFailurePolicy.requestFailed
}

/** Main-process-only resolver for a single provider's runtime secret. */
export type ProviderRuntimeResolver = (providerId: string) => Promise<ModelProvider | null>

/** Metadata state accessor with an optional main-process-only runtime resolver. */
export type ProviderStateAccessor = (() => Promise<ProviderState>) & {
  resolveRuntimeProvider?: ProviderRuntimeResolver
}

export type PersistedModelProvider = Omit<ModelProvider, 'apiKey' | 'apiKeyAvailability'>

/** Provider-owned cleanup record for an unreachable encrypted generation. */
export type ProviderSecretOrphan = {
  providerId: string
  ref: string
}

export type PersistedProviderState = {
  providers: PersistedModelProvider[]
  secretOrphans?: ProviderSecretOrphan[]
}

/**
 * 供应商写入入参。`baseUrl` 由端点清单派生（见 `resolveProviderPrimaryBase`），因此**不接受**
 * 外部传入；`endpoints` 是整份有序清单（`[0]` = 默认端点），缺省 = 沿用已存值。
 */
export type ModelProviderInput = Omit<
  ModelProvider,
  'models' | 'baseUrl' | 'endpoints' | 'removedEndpointProtocols' | 'apiKeyRef' | 'apiKeyAvailability' | 'apiKeyPreview' | 'apiKeyMigrationState' | 'apiKeyStorageVersion'
> & {
  models?: ModelDefinition[]
  /** 整份有序端点清单（`[0]` = 默认端点）；缺省 = 沿用已存值，`[]` = 删光端点。 */
  endpoints?: ProviderChatEndpoint[]
}

export type SafeModelProvider = Omit<
  ModelProvider,
  'apiKey' | 'apiKeyRef' | 'apiKeyAvailability' | 'apiKeyPreview' | 'apiKeyMigrationState' | 'apiKeyStorageVersion' | 'customHeaders'
> & {
  hasApiKey: boolean
  apiKeyPreview: string
  connectionStatus?: ProviderSecretConnectionStatus
  /** 值已掩码；明文只能显式读取。 */
  customHeaders?: SafeProviderCustomHeader[]
}
