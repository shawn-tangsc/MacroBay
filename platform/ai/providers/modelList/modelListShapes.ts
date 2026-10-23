import type { ModelProvider } from '../modelProviderTypes'
import {
  DEFAULT_MODEL_LIST_SHAPE,
  type FieldSource,
  type ModelListShape,
  type ModelSemantic
} from './modelListShape'

/**
 * 按 provider 逐家声明"与默认不同"的地方。
 *
 * 默认形状已经包含历史上对所有厂商都生效的字段（见 `modelListShape.ts`），
 * 这里只写**覆盖或补充**：
 * - provider 自己的候选路径排在默认路径**前面**（更具体优先）；
 * - 没写的字段直接继承默认。
 *
 * 字段证据来自 provider integration notes。
 */

function defineShape(overrides: Partial<ModelListShape>): ModelListShape {
  const aliases: Partial<Record<ModelSemantic, readonly FieldSource[]>> = { ...DEFAULT_MODEL_LIST_SHAPE.aliases }
  for (const [semantic, sources] of Object.entries(overrides.aliases ?? {}) as Array<[ModelSemantic, readonly FieldSource[]]>) {
    aliases[semantic] = [...sources, ...(DEFAULT_MODEL_LIST_SHAPE.aliases[semantic] ?? [])]
  }
  return { ...DEFAULT_MODEL_LIST_SHAPE, ...overrides, aliases }
}

const SHAPES: Readonly<Record<string, ModelListShape>> = Object.freeze({
  /**
   * AiHubMix：`/api/v1/models` 是 `/v1/models` 的**超集**（840 vs 677 条、30 字段 vs 4 字段，
   * 677 个 id 全在其中；信封 `{ data, message, success }`，无分页）。
   * 价格已是 **USD / 每百万 tokens**，不需要 scale。
   * `types` / `endpoints` / `*_modalities` 都是**逗号分隔字符串**（不是数组）⇒ `split-includes`。
   */
  aihubmix: defineShape({
    listPath: '/api/v1/models',
    idPath: 'model_id',
    displayNamePaths: ['model_name'],
    aliases: {
      contextWindow: [{ path: 'context_length' }],
      maxOutput: [{ path: 'max_output' }],
      'price.prompt': [{ path: 'pricing.input' }],
      'price.completion': [{ path: 'pricing.output' }],
      'price.cacheRead': [{ path: 'pricing.cache_read' }],
      'cap.vision': [{ path: 'input_modalities', read: 'split-includes', token: 'image' }],
      'cap.tools': [{ path: 'tool_call' }],
      'cap.reasoning': [{ path: 'reasoning' }],
      // 逐模型端点声明（实测 784 条为空串 ⇒ 声明为空、按供应商默认端点走）。
      'chat.completions': [{ path: 'endpoints', read: 'split-includes', token: 'chat_completions' }],
      'messages.responses': [{ path: 'endpoints', read: 'split-includes', token: 'responses' }],
      'messages.anthropic': [{ path: 'endpoints', read: 'split-includes', token: 'claude_api' }],
      'messages.gemini': [{ path: 'endpoints', read: 'split-includes', token: 'gemini_api' }]
    },
    // 模型类型同上（`"image_generation,llm"` 这类多值）。
    kindSources: [{ path: 'types', read: 'split-includes' }],
    // 实测 active 823 / deprecated 17；deprecated 不进结果。
    lifecycle: {
      kind: 'string-in-set',
      path: 'retire_stage',
      values: ['deprecated', 'retired', 'shutdown', 'offline']
    }
  }),
  aionly: defineShape({
    kindSources: [{ path: 'type', read: 'value' }]
  }),
  cephalon: defineShape({
    publicList: true,
    aliases: {
      contextWindow: [{ path: 'max_context_tokens' }],
      maxOutput: [{ path: 'max_output_tokens' }],
      'cap.vision': [{ path: 'supports_multimodal' }],
      'cap.tools': [{ path: 'supports_function_calling' }, { path: 'supports_tool_choice' }]
    },
    // `model_type` 不够：`qwen3-embedding:latest` 是 `model_type: language` + `mode: embedding`，
    // 只看 model_type 会被当聊天模型。`mode` 排第二（`typeValue` 仍取第一个来源 = model_type）。
    // `picture`（NanoBanana2）在全局表外，用本家覆盖补 imageGeneration（imageGeneration 属于
    // 非聊天位，会让 chat 自动变 false）。
    kindSources: [
      { path: 'model_type', read: 'value' },
      { path: 'mode', read: 'value' }
    ],
    kindOverrides: { picture: ['cap.imageGeneration'] }
  }),
  lanyun: defineShape({
    displayNamePaths: ['display_name', 'title'],
    aliases: {
      contextWindow: [{ path: 'context_size' }, { path: 'x_lanyun.context_max_tokens' }],
      maxOutput: [{ path: 'max_output_tokens' }],
      // 实测：顶层 input/output_token_price_per_m 全部为 null，真价在 x_lanyun.price_rules[0]，
      // 单位是 **CNY / 1K tokens**（glm-5.3 为 0.008 / 0.028 ⇒ ¥8 / ¥28 每百万，与市场价一致）。
      'price.prompt': [{ path: 'x_lanyun.price_rules.0.text_input_token', scale: 1000 }, { path: 'input_token_price_per_m' }],
      'price.completion': [{ path: 'x_lanyun.price_rules.0.text_output_token', scale: 1000 }, { path: 'output_token_price_per_m' }],
      'price.cacheRead': [{ path: 'x_lanyun.price_rules.0.cache_use_token', scale: 1000 }],
      // 逐模型的 API 路径（实测 24/49 条含 /v1/messages ⇒ 该模型支持 Anthropic messages）。
      'chat.completions': [{ path: 'x_lanyun.api_paths', read: 'includes', token: '/v1/chat/completions' }],
      'messages.anthropic': [{ path: 'x_lanyun.api_paths', read: 'includes', token: '/v1/messages' }],
      'messages.responses': [{ path: 'x_lanyun.api_paths', read: 'includes', token: '/v1/responses' }]
    },
    kindSources: [{ path: 'model_type', read: 'value' }],
    lifecycle: { kind: 'zero', path: 'status' },
    defaultCurrency: 'CNY'
  }),
  groq: defineShape({
    // 实测（2026-10-21）：列表在 `/openai/v1/models`。`buildModelsUrl` 对以 `/openai` 结尾的 base
    // 只补 `/models` ⇒ 会派生出 `/openai/models`（404 Unknown request URL），必须显式钉住。
    listPath: '/openai/v1/models'
  }),
  longcat: defineShape({
    // 实测（2026-10-21，带 Key）：列表在 `/openai/models`（2 条），给 `display_name` /
    // `context_window` / `max_output_tokens`；**没有价格、没有协议**。
    displayNamePaths: ['display_name', 'id'],
    aliases: {
      contextWindow: [{ path: 'context_window' }],
      maxOutput: [{ path: 'max_output_tokens' }]
    }
  }),
  tokenhub: defineShape({
    // 文档：`data[]` = id / object / name / created / **status**（online、pre-offline）。
    // `pre-offline`（即将下线）**不算下线** —— 与 OpenRouter 的 expiration_date 同一口径：
    // 还能用的模型不提前隐藏。
    lifecycle: {
      kind: 'string-in-set',
      path: 'status',
      values: ['offline', 'shutdown', 'retired', 'deprecated', 'discontinued']
    }
  }),
  stepfun: defineShape({
    // 实测（2026-10-21，带 Key）：33 条。7 个语言模型带 **`supported_protocols`**
    // （chat / messages / responses 的数组）+ `max_input_tokens` / `enable_vision_input` /
    // `enable_reason`；其余是语音模型，只有 `model_type`（中文）。
    aliases: {
      contextWindow: [{ path: 'max_input_tokens' }],
      'cap.vision': [{ path: 'enable_vision_input' }],
      'cap.reasoning': [{ path: 'enable_reason' }],
      'chat.completions': [{ path: 'supported_protocols', read: 'includes', token: 'chat' }],
      'messages.anthropic': [{ path: 'supported_protocols', read: 'includes', token: 'messages' }],
      'messages.responses': [{ path: 'supported_protocols', read: 'includes', token: 'responses' }]
    },
    // `model_type` 是中文枚举，全局表按英文小写词条匹配，所以在这里逐家用覆盖声明。
    kindSources: [{ path: 'model_type', read: 'value' }],
    kindOverrides: {
      大语言模型: [],
      语音合成: ['cap.speech'],
      语音识别: ['cap.transcription'],
      实时语音: ['cap.speech']
    }
  }),
  baichuan: defineShape({
    // 实测（2026-10-21，带 Key）：`/v1/models` 8 条，id 字段叫 `model`，显示名 `model_show_name`；
    // 给 `max_input_length` / `max_tokens` / `function_call`，**没有价格，也没有协议**。
    idPath: 'model',
    displayNamePaths: ['model_show_name', 'model'],
    aliases: {
      contextWindow: [{ path: 'max_input_length' }],
      maxOutput: [{ path: 'max_tokens' }],
      'cap.tools': [{ path: 'function_call' }]
    }
  }),
  ppio: defineShape({
    // 列表在 `/openai/v1/models`（实测 200，67 条）。不能靠 `buildModelsUrl` 推导：
    // base 以 `/openai` 结尾时那条规则给的是 `/openai/models`（404），所以显式钉死路径。
    listPath: '/openai/v1/models',
    // 实测（2026-10-21，带 Key）：67 条富列表。价格是 **CNY / 每百万**
    // （`price_per_m_decimal`：glm-4.7 = 4/16、glm-4.5-air = 1.2/2，与智谱官方人民币价一致）。
    // `endpoints` 是**逐模型端点声明**：chat/completions、anthropic、responses。
    defaultCurrency: 'CNY',
    aliases: {
      contextWindow: [{ path: 'context_size' }],
      maxOutput: [{ path: 'max_output_tokens' }],
      'price.prompt': [{ path: 'pricing.prompt.price_per_m_decimal' }],
      'price.completion': [{ path: 'pricing.completion.price_per_m_decimal' }],
      'price.cacheRead': [{ path: 'pricing.input_cache_read.price_per_m_decimal' }],
      'cap.vision': [{ path: 'input_modalities', read: 'includes', token: 'image' }],
      'cap.speech': [{ path: 'output_modalities', read: 'includes', token: 'audio' }],
      'cap.tools': [{ path: 'features', read: 'includes', token: 'function-calling' }],
      'cap.reasoning': [{ path: 'features', read: 'includes', token: 'reasoning' }],
      'chat.completions': [{ path: 'endpoints', read: 'includes', token: 'chat/completions' }],
      'messages.anthropic': [{ path: 'endpoints', read: 'includes', token: 'anthropic' }],
      'messages.responses': [{ path: 'endpoints', read: 'includes', token: 'responses' }]
    },
    // `status: 0` 视为下线（实测 67 条全是 1）。
    lifecycle: { kind: 'zero', path: 'status' }
  }),
  openrouter: defineShape({
    // 实测（2026-10-21，带 Key）：468 条 / 19 字段。**价格是 USD per token**
    // （gpt-5 = 0.00000125 ⇒ $1.25/百万），此前走默认形状没乘 1e6，UI 少显示 100 万倍。
    aliases: {
      'price.prompt': [{ path: 'pricing.prompt', scale: 1e6 }],
      'price.completion': [{ path: 'pricing.completion', scale: 1e6 }],
      'price.cacheRead': [{ path: 'pricing.input_cache_read', scale: 1e6 }],
      'cap.vision': [{ path: 'architecture.input_modalities', read: 'includes', token: 'image' }],
      'cap.tools': [{ path: 'supported_parameters', read: 'includes', token: 'tools' }],
      'cap.reasoning': [{ path: 'supported_parameters', read: 'includes', token: 'reasoning' }],
      'cap.imageGeneration': [{ path: 'architecture.output_modalities', read: 'includes', token: 'image' }],
      'cap.videoGeneration': [{ path: 'architecture.output_modalities', read: 'includes', token: 'video' }],
      'cap.speech': [{ path: 'architecture.output_modalities', read: 'includes', token: 'audio' }]
    },
    // 单价极低（`0.000000049`/token ⇒ 0.049/百万）：两位小数会显示成 `$0`，这家单独要 4 位。
    pricePrecision: 4,
    // 不用 `expiration_date` 做 lifecycle：实测 11 条都有**未来**日期（2026-10-31 ~ 12-31），
    // 现在仍然可用；按"即将过期"直接丢掉会像之前 gpt-4 那样提前隐藏还能用的模型。
    lifecycle: null
  }),
  poe: defineShape({
    // 实测（2026-10-21）：323 条 15 字段，匿名与带 Key 逐字节相同。
    // 价格是 **USD / token**（如 0.0000002525 ⇒ $0.2525/百万），故乘 1e6。
    aliases: {
      contextWindow: [{ path: 'context_length' }, { path: 'context_window' }],
      'price.prompt': [{ path: 'pricing.prompt', scale: 1e6 }],
      'price.completion': [{ path: 'pricing.completion', scale: 1e6 }],
      'price.cacheRead': [{ path: 'pricing.input_cache_read', scale: 1e6 }],
      'cap.imageGeneration': [{ path: 'architecture.output_modalities', read: 'includes', token: 'image' }],
      'cap.videoGeneration': [{ path: 'architecture.output_modalities', read: 'includes', token: 'video' }],
      'cap.speech': [{ path: 'architecture.output_modalities', read: 'includes', token: 'audio' }],
      'cap.vision': [{ path: 'architecture.input_modalities', read: 'includes', token: 'image' }],
      // 逐模型协议：只有 57/323 条有该数组，其余为空 ⇒ 声明为空、按供应商默认端点走。
      'chat.completions': [{ path: 'supported_endpoints', read: 'includes', token: '/v1/chat/completions' }],
      'messages.responses': [{ path: 'supported_endpoints', read: 'includes', token: '/v1/responses' }],
      'messages.anthropic': [{ path: 'supported_endpoints', read: 'includes', token: '/v1/messages' }]
    }
  }),
  qiniu: defineShape({ publicList: true }),
  /**
   * 百炼：compatible-mode 列表（`/compatible-mode/v1/models`）决定"有哪些模型"，但只有
   * `id`/`object`/`created`/`owned_by`；价格与上下文必须从原生 `/api/v1/models` 按 id 补充。
   * 两边的 id 互不包含（原生还多出 embedding/rerank/TTS/视频），所以补充源只补字段、不新增模型。
   * 原生价格单位已经是「CNY / 每百万 tokens」，不需要 scale。
   */
  dashscope: defineShape({
    defaultCurrency: 'CNY',
    enrichment: {
      path: '/api/v1/models',
      itemsPath: 'output.models',
      idPath: 'model',
      pages: { pageParam: 'page_no', sizeParam: 'page_size', size: 200, maxPages: 5 },
      aliases: {
        contextWindow: [{ path: 'model_info.context_window' }],
        maxOutput: [{ path: 'model_info.max_output_tokens' }],
        'price.prompt': [{
          path: 'prices.0.prices',
          read: 'match',
          where: { path: 'type', equals: 'input_token' },
          valuePath: 'price'
        }],
        'price.completion': [{
          path: 'prices.0.prices',
          read: 'match',
          where: { path: 'type', equals: 'output_token' },
          valuePath: 'price'
        }],
        'price.cacheRead': [{
          path: 'prices.0.prices',
          read: 'match',
          where: { path: 'type', equals: 'input_token_cache' },
          valuePath: 'price'
        }]
      }
    }
  }),
  deepseek: defineShape({
    aliases: {
      contextWindow: [{ path: 'context_window' }],
      maxOutput: [{ path: 'max_output_tokens' }],
      'cap.vision': [{ path: 'input_modalities', read: 'includes', token: 'image' }],
      'cap.reasoning': [{ path: 'effort', read: 'non-empty' }],
      'messages.anthropic': [{ path: 'api_capabilities.anthropic_messages', read: 'non-empty' }]
    }
  }),
  doubao: defineShape({
    aliases: {
      contextWindow: [{ path: 'token_limits.context_window' }],
      maxOutput: [{ path: 'token_limits.max_output_token_length' }],
      'cap.tools': [{ path: 'features.tools.function_calling' }]
    },
    kindSources: [
      { path: 'domain', read: 'value' },
      { path: 'task_type', read: 'includes' }
    ]
    // lifecycle 沿用默认的 status:shutdown|retired|deprecated|offline（Retiring 保留）。
  }),
  moonshot: defineShape({
    // 实测（2026-10-21）：4 条，字段含 context_length / supports_image_in / supports_video_in /
    // supports_reasoning；**没有价格、没有逐模型协议**（协议只能按供应商三条端点声明）。
    aliases: {
      contextWindow: [{ path: 'context_length' }],
      'cap.vision': [{ path: 'supports_image_in' }, { path: 'supports_video_in' }],
      'cap.reasoning': [{ path: 'supports_reasoning' }]
    }
  }),
  burncloud: defineShape({
    aliases: {
      'cap.imageGeneration': [{ path: 'supported_endpoint_types', read: 'includes', token: 'image-generation' }],
      // `supported_endpoint_types` 是**逐模型端点声明**（实测 108 条全有：openai 108 / gemini 30 /
      // image-generation 2）。这里把它翻成"模型支持哪些协议"——只扩充支持集合，
      // 默认路由仍取供应商默认端点（chat/completions）。
      'chat.completions': [{ path: 'supported_endpoint_types', read: 'includes', token: 'openai' }],
      'messages.gemini': [{ path: 'supported_endpoint_types', read: 'includes', token: 'gemini' }]
    }
  }),
  gateway: defineShape({
    aliases: {
      contextWindow: [{ path: 'context_window' }],
      'price.prompt': [{ path: 'pricing.input', scale: 1e6 }],
      'price.completion': [{ path: 'pricing.output', scale: 1e6 }],
      'cap.tools': [{ path: 'supported_parameters', read: 'includes', token: 'tools' }],
      'cap.vision': [{ path: 'modalities.input', read: 'includes', token: 'image' }],
      'cap.reasoning': [
        { path: 'reasoning_options', read: 'non-empty' },
        { path: 'tags', read: 'includes', token: 'reasoning' }
      ]
    },
    kindSources: [{ path: 'type', read: 'value' }],
    lifecycle: { kind: 'presence', path: 'deprecated_at' }
  }),
  gemini: defineShape({
    envelope: 'models',
    idPath: 'name',
    displayNamePaths: ['displayName'],
    grouping: 'geminiFamily',
    modelProviderTag: 'gemini',
    auth: 'x-goog-api-key',
    pagination: { tokenParam: 'pageToken', maxPages: 5 },
    nextTokenPath: 'nextPageToken',
    kindAuthoritative: true,
    aliases: {
      contextWindow: [{ path: 'inputTokenLimit' }],
      maxOutput: [{ path: 'outputTokenLimit' }],
      'cap.reasoning': [{ path: 'thinking' }]
    },
    kindSources: [{ path: 'supportedGenerationMethods', read: 'includes' }],
    // Gemini 的条目没有 status，默认的 shutdown 规则不会命中；这里显式清空。
    lifecycle: null
  })
})

/**
 * 形状解析：**默认端点优先**（默认端点就是原生 gemini 的 provider 走原生列表），
 * 其次按 provider id 查表，最后回到默认形状。
 */
export function resolveModelListShape(
  provider: Pick<ModelProvider, 'id' | 'endpoints'>
): ModelListShape {
  if (provider.endpoints[0]?.protocol === 'gemini') return SHAPES.gemini ?? DEFAULT_MODEL_LIST_SHAPE
  return SHAPES[provider.id] ?? DEFAULT_MODEL_LIST_SHAPE
}

/** 便于测试与诊断：某 provider 是否声明了差异。 */
export function hasCustomModelListShape(providerId: string): boolean {
  return providerId in SHAPES
}
