import { inferModelCapabilities } from '../modelCapabilityInference'
import { buildModelSupportedProtocols } from '../modelChatProtocol'
import type { ModelChatProtocol } from '../modelProviderTypes'
import { normalizeModelCapabilities } from '../modelCapabilities'
import type { ModelCapabilities, ModelDefinition, ModelPricing } from '../modelProviderTypes'
import {
  CAPABILITY_BY_SEMANTIC,
  type CapabilitySemantic,
  type FieldSource,
  type LifecycleRule,
  type ModelListShape,
  type ModelSemantic
} from './modelListShape'
import {
  readBooleanField,
  readFirstString,
  readKindValues,
  readNumberField,
  readPath,
  readStringField,
  type FieldRead
} from './remoteModelFields'

/**
 * kind 观测值 → 能力位。
 * **没有槽位的 kind（evaluation / realtime / Router / 3DGeneration / 空串）不在表里**：
 * 它们不置任何位，也不会写 `chat:false`（`resolveModelCapabilities()` 会按 id 重推 chat）。
 */
const KIND_CAPABILITIES: Readonly<Record<string, readonly CapabilitySemantic[]>> = Object.freeze({
  image_generation: ['cap.imageGeneration'],
  image: ['cap.imageGeneration'],
  imagegeneration: ['cap.imageGeneration'],
  speech_model: ['cap.speech'],
  speech: ['cap.speech'],
  '1003': ['cap.speech'],
  transcription: ['cap.transcription'],
  stt: ['cap.transcription'],
  speechtotext: ['cap.transcription'],
  // AIHubMix 等家的 `types` 里用 `ocr` 表示 OCR（图片 → 文本），与转写是两件事。
  ocr: ['cap.ocr'],
  // TTS 是"语音合成"，与 speech 同一个槽位（aihubmix 的 `types: "tts"`）。
  tts: ['cap.speech'],
  // 厂商用 task_type 描述"这个模型能做什么"（豆包 `["TextToImage","ImageToImage"]`）。
  texttoimage: ['cap.imageGeneration'],
  imagetoimage: ['cap.imageGeneration'],
  embedding: ['cap.embedding'],
  embedcontent: ['cap.embedding'],
  // `reranking` 是其他厂商的字面值；aihubmix 用 `rerank`，两者同义。
  rerank: ['cap.rerank'],
  reranking: ['cap.rerank'],
  video: ['cap.videoGeneration'],
  '1002': ['cap.videoGeneration'],
  videogeneration: ['cap.videoGeneration'],
  texttovideo: ['cap.videoGeneration'],
  imagetovideo: ['cap.videoGeneration']
})

/** 只有这四个**字面字段**取到布尔值时才算"上游声明了能力"（见设计 D7）。 */
const PROVIDER_DECLARED_PATHS = [
  'supports_tools',
  'supports_vision',
  'supports_reasoning',
  'supports_anthropic'
] as const

function isRetired(item: unknown, rule: LifecycleRule | null): boolean {
  if (rule === null) return false
  const raw = readPath(item, rule.path)
  if (rule.kind === 'string-in-set') {
    if (typeof raw !== 'string') return false
    const value = raw.trim()
    return value.length > 0 && rule.values.some((entry) => entry.toLowerCase() === value.toLowerCase())
  }
  if (rule.kind === 'presence') {
    if (raw === undefined || raw === null) return false
    return typeof raw !== 'string' || raw.trim().length > 0
  }
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : Number.NaN
  return Number.isFinite(parsed) && parsed === 0
}

function isProviderDeclared(item: unknown): boolean {
  return PROVIDER_DECLARED_PATHS.some((path) => typeof readPath(item, path) === 'boolean')
}

/** 旧实现：先按 `/` 取族，再按 `-` 取前缀；与今天 `inferModelGroup` 一致。 */
function inferModelGroup(modelId: string): string | undefined {
  if (modelId.includes('/')) return modelId.split('/')[0]
  if (modelId.includes('-')) return modelId.split('-')[0]
  return undefined
}

/** Gemini 的模型族前缀：`gemini-3.5-flash` → `gemini-3.5`；与今天 `geminiModelGroup` 一致。 */
function geminiModelGroup(modelId: string): string | undefined {
  const segments = modelId.split('-').filter(Boolean)
  if (segments.length >= 2) return `${segments[0]}-${segments[1]}`
  return segments[0]
}

function resolveGroup(item: unknown, shape: ModelListShape, modelId: string): string | undefined {
  if (shape.grouping === 'geminiFamily') return geminiModelGroup(modelId)
  const ownedBy = readPath(item, 'owned_by')
  if (typeof ownedBy === 'string' && ownedBy.trim()) return ownedBy.trim()
  return inferModelGroup(modelId)
}

/**
 * 读一个语义：**先读本条 item，未声明才读补充源里同 id 的条目**。
 *
 * 补充源只允许提供 `shape.enrichment.aliases` 里声明的语义：回退时只把那一份来源列表
 * 交给取值器，**不会**把本家/默认别名套到补充源条目上（否则同名字段会被误读）。
 */
function readSemantic<T>(
  item: unknown,
  enrichmentItem: unknown,
  shape: ModelListShape,
  semantic: ModelSemantic,
  read: (target: unknown, sources: readonly FieldSource[] | undefined) => FieldRead<T>
): FieldRead<T> {
  const own = read(item, shape.aliases[semantic])
  if (own.declared || enrichmentItem === undefined) return own
  return read(enrichmentItem, shape.enrichment?.aliases[semantic])
}

function resolvePricing(item: unknown, enrichmentItem: unknown, shape: ModelListShape): ModelPricing | undefined {
  const prompt = readSemantic(item, enrichmentItem, shape, 'price.prompt', readNumberField)
  const completion = readSemantic(item, enrichmentItem, shape, 'price.completion', readNumberField)
  if (!prompt.declared || !completion.declared) return undefined
  const currency = readSemantic(item, enrichmentItem, shape, 'price.currency', readStringField)
  const cacheRead = readSemantic(item, enrichmentItem, shape, 'price.cacheRead', readNumberField)
  const hasDiscount = readSemantic(item, enrichmentItem, shape, 'price.hasDiscount', readBooleanField)
  return {
    currency: currency.declared ? currency.value : (shape.defaultCurrency ?? 'USD'),
    promptPerMillion: prompt.value,
    completionPerMillion: completion.value,
    ...(cacheRead.declared ? { cacheReadPerMillion: cacheRead.value } : {}),
    ...(hasDiscount.declared && hasDiscount.value ? { hasDiscount: true } : {}),
    ...(shape.pricePrecision === undefined ? {} : { displayPrecision: shape.pricePrecision })
  }
}

function resolveCapabilityValues(
  item: unknown,
  enrichmentItem: unknown,
  shape: ModelListShape
): Partial<ModelCapabilities> {
  const values: Partial<ModelCapabilities> = {}
  for (const [semantic, key] of Object.entries(CAPABILITY_BY_SEMANTIC) as Array<[CapabilitySemantic, keyof ModelCapabilities]>) {
    const result = readSemantic(item, enrichmentItem, shape, semantic, readBooleanField)
    if (result.declared) values[key] = result.value
  }
  return values
}

type KindOutcome = {
  readonly capabilities: Partial<ModelCapabilities>
  readonly typeValue: string | undefined
  /** 权威 kind 下"既非 chat 也非 embedding"的条目返回 null（丢弃）。 */
  readonly drop: boolean
}

function resolveKind(item: unknown, shape: ModelListShape): KindOutcome {
  const reading = readKindValues(item, shape.kindSources)
  const capabilities: Partial<ModelCapabilities> = {}
  for (const value of reading.values) {
    // 本家覆盖优先（同名不同义），没命中才回到全局表；两边都没有 ⇒ 该 kind 不置任何位。
    const semantics = shape.kindOverrides?.[value] ?? KIND_CAPABILITIES[value] ?? []
    for (const semantic of semantics) {
      capabilities[CAPABILITY_BY_SEMANTIC[semantic]] = true
    }
  }
  if (!shape.kindAuthoritative) {
    return { capabilities, typeValue: reading.typeValue, drop: false }
  }
  const chat = reading.values.includes('generatecontent')
  const embedding = reading.values.includes('embedcontent')
  if (!chat && !embedding) return { capabilities, typeValue: reading.typeValue, drop: true }
  if (chat) capabilities.chat = true
  if (embedding) capabilities.embedding = true
  return { capabilities, typeValue: reading.typeValue, drop: false }
}

export type NormalizeOptions = {
  /**
   * 供应商当前的默认端点协议：厂商没有逐模型声明时，把它**快照**成模型的 `chatProtocol`
   * （之后改默认端点不会影响已同步的模型）。
   */
  readonly providerDefaultProtocol?: ModelChatProtocol
  /**
   * 补充源条目索引（id → 原始条目）。只在主列表条目**未声明**某个语义时回退读取，
   * 且只对 `shape.enrichment.aliases` 声明的语义生效；**绝不新增模型**。
   */
  readonly enrichmentById?: ReadonlyMap<string, unknown>
  /**
   * 该供应商**所有模型**都支持的协议（网关型：OpenRouter 把 chat / messages / responses
   * 三种格式互相转换，实测任取模型三路都通）。给定时直接并入 `declaredProtocols` ——
   * 于是同步完模型就自带这三个标签，不用再去「检测模型」。
   */
  readonly allProtocols?: readonly ModelChatProtocol[]
}

/**
 * PLAT-77：一条厂商 payload 的 `items[]` → `ModelDefinition[]`。
 *
 * 关键约束（对应设计的 3.4 节）：
 * 1. 显式 `false` 也是声明，必须一路传进能力推断（压制 id 正则）；
 * 2. `kind` 只置有槽位的能力，未识别的 kind 不写 `chat:false`；
 * 3. `lifecycle` 命中的条目不作为新增导入；`Retiring` 不在此列（由 shape 决定）；
 * 4. `providerDeclared` 只认四个字面字段，不随"某个语义解析成功"而放宽。
 * 5. T4/T5：聊天模型**自带协议** —— 厂商逐模型声明（messages / responses）优先，
 *    否则快照供应商当时的默认端点；非聊天模型不写协议。
 * 6. 补充源只按 id 补 `shape.enrichment.aliases` 声明的字段，不新增模型；
 *    两侧都有值时以本条 item 为准。
 */
export function normalizeRemoteModels(
  items: readonly unknown[],
  shape: ModelListShape,
  options: NormalizeOptions = {}
): ModelDefinition[] {
  const seen = new Set<string>()
  const models: ModelDefinition[] = []

  for (const item of items) {
    if (item === null || typeof item !== 'object') continue
    const rawId = readPath(item, shape.idPath)
    if (typeof rawId !== 'string') continue
    const id = (shape.idPath === 'name' ? rawId.trim().replace(/^models\//i, '') : rawId.trim())
    if (!id || seen.has(id)) continue
    if (isRetired(item, shape.lifecycle)) continue

    const kind = resolveKind(item, shape)
    if (kind.drop) continue

    seen.add(id)
    // 主列表没有的 id 不会进入循环 ⇒ 补充源天然无法新增模型。
    const enrichmentItem = options.enrichmentById?.get(id)
    const name = readFirstString(item, shape.displayNamePaths) ?? id
    const capabilityInput: Partial<ModelCapabilities> = {
      ...resolveCapabilityValues(item, enrichmentItem, shape),
      ...kind.capabilities
    }
    const capabilities = inferModelCapabilities({ id, type: kind.typeValue, capabilities: capabilityInput })
    const pricing = resolvePricing(item, enrichmentItem, shape)
    const contextLength = readSemantic(item, enrichmentItem, shape, 'contextWindow', readNumberField)
    const maxCompletionTokens = readSemantic(item, enrichmentItem, shape, 'maxOutput', readNumberField)
    const anthropic = readSemantic(item, enrichmentItem, shape, 'messages.anthropic', readBooleanField)
    const responses = readSemantic(item, enrichmentItem, shape, 'messages.responses', readBooleanField)
    const chatCompletions = readSemantic(item, enrichmentItem, shape, 'chat.completions', readBooleanField)
    const gemini = readSemantic(item, enrichmentItem, shape, 'messages.gemini', readBooleanField)

    const group = resolveGroup(item, shape, id)
    // 默认路由**只跟供应商默认端点**，厂商声明不参与。
    // 声明回答的是"它还支持哪些协议"（进 `supportedProtocols`），不是"默认走哪条"。
    // 反例：DeepSeek 列表声明了 anthropic_messages，若让声明抢默认，同步后所有模型会从
    // `/v1/chat/completions` 悄悄切到 `/anthropic/v1/messages`（工具/流式行为都变）。
    const chatProtocol = capabilities.chat ? options.providerDefaultProtocol : undefined
    // 逐条声明的协议（LANYUN 的 api_paths、TokenRhythm 的 supports_* 布尔等）。
    const declaredProtocols: ModelChatProtocol[] = [
      // 网关的"全部协议"只对聊天模型成立（图片/视频模型不走 chat 协议）。
      ...(capabilities.chat ? options.allProtocols ?? [] : []),
      ...(chatCompletions.declared && chatCompletions.value ? ['chat-completions' as const] : []),
      ...(responses.declared && responses.value ? ['responses' as const] : []),
      ...(gemini.declared && gemini.value ? ['gemini' as const] : []),
      ...(anthropic.declared && anthropic.value ? ['messages' as const] : [])
    ]
    // 支持集合 = 厂商声明 ∪ 供应商实际可用协议（模型协议 + 供应商默认端点协议）。
    // 不用 `chatProtocol` 反推：TokenRhythm 一类"声明了 responses、但默认端点仍是 chat"的模型，
    // 必须同时算作 chat 与 responses。
    const supportedProtocols = buildModelSupportedProtocols([
      ...declaredProtocols,
      chatProtocol,
      // 供应商默认端点只并入聊天模型（媒体模型只保留厂商逐条声明）。
      capabilities.chat ? options.providerDefaultProtocol : undefined
    ])
    // 厂商声明集合：只装逐条声明（默认端点不进来）。
    const declaredProtocolOnly = buildModelSupportedProtocols(declaredProtocols)

    models.push({
      id,
      name,
      ...(group === undefined ? {} : { group }),
      provider: shape.modelProviderTag,
      capabilities: normalizeModelCapabilities(capabilities),
      ...(contextLength.declared ? { contextLength: contextLength.value } : {}),
      ...(maxCompletionTokens.declared ? { maxCompletionTokens: maxCompletionTokens.value } : {}),
      ...(pricing ? { pricing } : {}),
      ...(isProviderDeclared(item) ? { providerDeclared: true } : {}),
      // PLAT-82：只有逐模型布尔/路径声明命中时才写 `declarationSource`；
      // `chatProtocol` 可能是供应商默认端点快照，不产生声明来源。
      ...(anthropic.declared || responses.declared ? { declarationSource: 'provider_list' as const } : {}),
      ...(responses.declared
        ? { responsesSupport: responses.value ? ('yes' as const) : ('no' as const) }
        // 网关型（`allProtocols` 来自 `protocol-agnostic`）：格式由网关互转，这两条支持是网关的事实。
        : capabilities.chat && (options.allProtocols ?? []).includes('responses')
          ? { responsesSupport: 'yes' as const }
          : {}),
      // PLAT-82：同步只记录**厂商声明**，不再产生任何探测结论。
      // `probeStatus` / `probeReason` / `protocolProbedAt` 三个字段停止写入；
      // 历史值由同步链原样 forward（见 providerModelSync 的字段白名单）。
      ...(anthropic.declared
        ? { messagesSupport: anthropic.value ? ('yes' as const) : ('no' as const) }
        // 网关型必须写这一位，否则智能体候选判据（`hasClaudeCodeRuntimeCapability` 读
        // `messagesSupport === 'yes'`）会把网关模型判成 `model-not-enabled` 直接从下拉里消失 ——
        // 只有 `supportedProtocols` 是不够的。
        : capabilities.chat && (options.allProtocols ?? []).includes('messages')
          ? { messagesSupport: 'yes' as const }
          : {}),
      // T4/T5：协议写在模型记录上（厂商声明优先，否则快照供应商当前默认端点）。
      ...(chatProtocol ? { chatProtocol } : {}),
      // PLAT-82：可用集合（pill 计数）与厂商声明集合（标红）分开存。
      ...(supportedProtocols ? { supportedProtocols } : {}),
      ...(declaredProtocolOnly ? { declaredProtocols: declaredProtocolOnly } : {})
    })
  }

  return models
}
