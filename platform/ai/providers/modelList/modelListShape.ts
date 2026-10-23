import type { ModelCapabilities } from '../modelProviderTypes'

/**
 * 模型列表取值的**语义**。没有列出的上游字段一律不读（明确降级，而不是误读）。
 */
export type ModelSemantic =
  | 'contextWindow'
  | 'maxOutput'
  | 'price.prompt'
  | 'price.completion'
  | 'price.cacheRead'
  | 'price.currency'
  | 'price.hasDiscount'
  | 'cap.tools'
  | 'cap.vision'
  | 'cap.reasoning'
  | 'cap.embedding'
  | 'cap.rerank'
  | 'cap.imageGeneration'
  | 'cap.videoGeneration'
  | 'cap.speech'
  | 'cap.transcription'
  | 'cap.ocr'
  | 'messages.anthropic'
  | 'messages.responses'
  /** 是否声明支持 OpenAI `chat/completions` 端点路径（如 LANYUN 的 `x_lanyun.api_paths`）。 */
  | 'chat.completions'
  /** 是否声明支持 Gemini 原生 `:generateContent` 端点（如 BurnCloud 的 `supported_endpoint_types`）。 */
  | 'messages.gemini'

export type CapabilitySemantic = Extract<ModelSemantic, `cap.${string}`>

/** 语义 → ModelCapabilities 的槽位（只覆盖有槽位的语义）。 */
export const CAPABILITY_BY_SEMANTIC: Readonly<Record<CapabilitySemantic, keyof ModelCapabilities>> = Object.freeze({
  'cap.tools': 'tools',
  'cap.vision': 'vision',
  'cap.reasoning': 'reasoning',
  'cap.embedding': 'embedding',
  'cap.rerank': 'rerank',
  'cap.imageGeneration': 'imageGeneration',
  'cap.videoGeneration': 'videoGeneration',
  'cap.speech': 'speech',
  'cap.transcription': 'transcription',
  'cap.ocr': 'ocr'
})

/**
 * 一个语义的取值来源。path 支持 `a.b.c` 嵌套。
 * - `value`：标量；`scale` 用于单位换算（如 per-token × 1e6）。
 * - `includes`：目标是数组，判断是否含 token（返回布尔，含 false 也算"已声明"）。
 * - `split-includes`：目标是**逗号分隔字符串**（如 `"chat_completions,responses"`），
 *   按 `,` 切分后 trim、不区分大小写比较是否含 token（同样返回布尔，含 false 也算"已声明"）。
 *   值不是字符串 ⇒ 未声明。
 * - `non-empty`：对象/数组/字符串非空（返回布尔）。
 * - `match`：`path` 指向数组，取第一项满足 `item[where.path] === where.equals`
 *   （trim 后不区分大小写）的条目，再读它的 `valuePath`；`scale` 同样生效。
 *   用途：价格是 `prices[0].prices[{ type, price }]` 这种"按 type 命中的数组"，
 *   不能靠固定下标读（顺序不保证）。
 */
export type FieldSource =
  | { readonly path: string; readonly read?: 'value'; readonly scale?: number }
  | { readonly path: string; readonly read: 'includes'; readonly token: string }
  | { readonly path: string; readonly read: 'split-includes'; readonly token: string }
  | { readonly path: string; readonly read: 'non-empty' }
  | {
      readonly path: string
      readonly read: 'match'
      readonly where: { readonly path: string; readonly equals: string }
      readonly valuePath: string
      readonly scale?: number
    }

/** kind 的读法：单值字段、"这个数组里出现了哪些已知值"，或逗号分隔字符串里的每一项。 */
export type KindSource =
  | { readonly path: string; readonly read: 'value' }
  | { readonly path: string; readonly read: 'includes' }
  | { readonly path: string; readonly read: 'split-includes' }

export type LifecycleRule =
  /** 值命中集合即视为下线（大小写不敏感、trim 后比较）。 */
  | { readonly kind: 'string-in-set'; readonly path: string; readonly values: readonly string[] }
  /** 字段存在且非空即视为下线。 */
  | { readonly kind: 'presence'; readonly path: string }
  /** 字段等于 0 即视为下线。 */
  | { readonly kind: 'zero'; readonly path: string }

/** 整数页码分页（与 token 分页互不影响）。 */
export type ModelListEnrichmentPages = {
  /** 页码参数名，如 'page_no'。 */
  readonly pageParam: string
  /** 每页条数参数名，如 'page_size'。 */
  readonly sizeParam: string
  readonly size: number
  /** 兜底上限，避免上游永远返回非空页时死循环。 */
  readonly maxPages: number
}

/**
 * 补充元数据源：不新增模型，只按 id 给已有条目补字段。
 *
 * 存在的理由：百炼的 compatible-mode 列表是"哪些模型能用"的权威来源，但只有 4 个字段；
 * 原生 `/api/v1/models` 才有价格/上下文，且两边的 id 集合互不包含。
 * 所以主列表决定模型集合，补充源只按 id 合并声明过的语义。
 *
 * 请求地址规则见 `remoteModelList.ts`：`path` 是**主机根相对路径**（如 '/api/v1/models'），
 * 不是相对 `provider.baseUrl` 的路径。
 */
export type ModelListEnrichment = {
  /** 相对主机根的路径，如 '/api/v1/models'。 */
  readonly path: string
  /** 条目数组位置，如 'output.models'（支持 `a.b.c`）。 */
  readonly itemsPath: string
  /** 补充源条目的唯一 id，如 'model'；与主列表 id 精确匹配。 */
  readonly idPath: string
  readonly pages: ModelListEnrichmentPages
  /** 只允许补充这些语义；未声明的语义不会被补充源影响。 */
  readonly aliases: Partial<Record<ModelSemantic, readonly FieldSource[]>>
}

/** PLAT-77：一家厂商的模型列表形状。未收录的厂商走 DEFAULT_MODEL_LIST_SHAPE。 */
export type ModelListShape = {
  /** items 数组位置：'data' → payload.data；'models' → payload.models。 */
  readonly envelope: 'data' | 'models'
  /** 唯一 id 的字段名（任意字段名）；字面值 'name' 表示需剥掉 `models/` 前缀（gemini）。 */
  readonly idPath: string
  /**
   * 相对 **origin**（`provider.baseUrl` 的源站）的列表路径，如 '/api/v1/models'。
   *
   * 缺省 ⇒ 走 `buildModelsUrl(baseUrl)`（版本段探测，55 家预设的既有行为）。
   * 存在 ⇒ 请求 `origin + listPath`，用于"富列表在主机根、与 chat base 的版本段无关"的厂商。
   */
  readonly listPath?: string
  /** 显示名候选字段，按顺序取第一个非空。 */
  readonly displayNamePaths: readonly string[]
  /** 'ownedBy' = owned_by ?? id 前缀；'geminiFamily' = 模型族前缀。 */
  readonly grouping: 'ownedBy' | 'geminiFamily'
  /** 写进 ModelDefinition.provider。 */
  readonly modelProviderTag: string
  readonly auth: 'bearer' | 'x-goog-api-key'
  /** null = 单次取全；非 null 时跟随 token 翻页（不带 pageSize，URL 形状不变）。 */
  readonly pagination: { readonly tokenParam: string; readonly maxPages: number } | null
  readonly nextTokenPath: string | null
  /** kind 无法映射到任何能力位时是否丢弃该条目。 */
  readonly kindAuthoritative: boolean
  readonly lifecycle: LifecycleRule | null
  readonly aliases: Partial<Record<ModelSemantic, readonly FieldSource[]>>
  readonly kindSources: readonly KindSource[]
  /**
   * 补充元数据源。**默认形状不带**：只有显式声明的厂商才会多打一次列表请求，
   * 其余厂商的请求数与归一结果完全不变。
   */
  readonly enrichment?: ModelListEnrichment
  /**
   * 逐家 kind 覆盖：键 = 归一化（trim+小写）后的 kind 值，值 = 要置的能力位。
   *
   * 存在的理由：同一个 kind 字面量在不同厂商含义不同（某家的 `video` 其实指多模态输入）。
   * 引擎**先查本家覆盖、没命中才查全局 `KIND_CAPABILITIES`**；全局表继续负责常见值。
   * 键与值都是数据，不在引擎里写 `if (providerId === ...)`。
   */
  readonly kindOverrides?: Readonly<Record<string, readonly CapabilitySemantic[]>>
  /** 只用于诊断，当前无 UI 消费者。 */
  readonly publicList: boolean
  /**
   * 该家价目表默认币种（ISO 4217）。价格本身由 `price.*` 语义读，币种未必有字段
   * （如 LANYUN 的 price_rules 不带 currency）⇒ 缺省按 USD。
   */
  readonly defaultCurrency?: string
  /**
   * 价格展示的小数位（缺省 2）。只给"单价极低"的厂商显式声明 —— 例如 OpenRouter 的
   * `prompt: 0.000000049` 换算成每百万是 `0.049`，两位小数会显示成 `$0`。
   */
  readonly pricePrecision?: number
}

/**
 * 默认形状 = 今天通用实现实际读取的字段：
 * `id` / `name` / `owned_by` / `status`（下线）/ `context_length` / `max_completion_tokens` /
 * `effective_pricing`·`pricing` / `supports_tools`·`supports_vision`·`supports_reasoning`·`supports_anthropic`。
 * 这些不是"某家特有"，而是历史上对所有厂商都生效的约定；逐家差异只在覆盖它们之外的部分。
 */
export const DEFAULT_MODEL_LIST_SHAPE: ModelListShape = Object.freeze({
  envelope: 'data',
  idPath: 'id',
  displayNamePaths: Object.freeze(['name']),
  grouping: 'ownedBy',
  modelProviderTag: 'remote',
  auth: 'bearer',
  pagination: null,
  nextTokenPath: null,
  kindAuthoritative: false,
  lifecycle: Object.freeze({
    kind: 'string-in-set',
    path: 'status',
    values: Object.freeze(['shutdown', 'retired', 'deprecated', 'offline'])
  }),
  aliases: Object.freeze({
    contextWindow: Object.freeze([{ path: 'context_length' }]),
    maxOutput: Object.freeze([{ path: 'max_completion_tokens' }, { path: 'max_tokens' }]),
    'price.prompt': Object.freeze([{ path: 'effective_pricing.prompt' }, { path: 'pricing.prompt' }]),
    'price.completion': Object.freeze([{ path: 'effective_pricing.completion' }, { path: 'pricing.completion' }]),
    'price.cacheRead': Object.freeze([{ path: 'effective_pricing.cache_read' }, { path: 'pricing.cache_read' }]),
    'price.currency': Object.freeze([{ path: 'effective_pricing.currency' }, { path: 'pricing.currency' }]),
    'price.hasDiscount': Object.freeze([{ path: 'has_discount' }]),
    'cap.tools': Object.freeze([{ path: 'supports_tools' }]),
    'cap.vision': Object.freeze([{ path: 'supports_vision' }]),
    'cap.reasoning': Object.freeze([{ path: 'supports_reasoning' }]),
    'messages.anthropic': Object.freeze([{ path: 'supports_anthropic' }]),
    'messages.responses': Object.freeze([{ path: 'supports_responses' }])
  }),
  kindSources: Object.freeze([]),
  publicList: false
}) as ModelListShape
