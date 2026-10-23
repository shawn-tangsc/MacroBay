/**
 * **端点 URL 的拼接规则**（唯一一份）。
 *
 * 端点 base 本身由供应商的 `endpoints[]` 声明（读它请走 `providerChatEndpoints`）；
 * 本模块只负责"base + 叶子路径"：
 *  - OpenAI 兼容 base：客户端自己补 `/v1/chat/completions`，base 可以是 `https://api.openai.com`；
 *  - Responses：客户端补 `/v1/responses`，base 由预设声明（如 `https://api.openai.com/v1`）；
 *  - Anthropic Messages：客户端补 `/v1/messages`，base 原样保留（`.../anthropic` 这类前缀不能动）；
 *  - Gemini 原生：客户端固定拼 `/v1beta/models/{id}:generateContent`，base 是主机名。
 *
 * 归一规则（`/v\d+/` 版本段探测、去尾斜杠）与既有实现逐字一致，因此不改变任何请求地址。
 */
export function normalizeEndpointBase(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '')
}

const VERSION_SEGMENT_PATTERN = /\/v\d+(?:beta|alpha)?(?:$|\/)/i

function hasVersionSegment(base: string): boolean {
  return VERSION_SEGMENT_PATTERN.test(normalizeEndpointBase(base))
}

/** Gemini 原生端点的规范 base：去掉尾部版本段（`.../v1`、`.../v1beta` ⇒ 主机名）。 */
function geminiHostBase(base: string): string {
  return normalizeEndpointBase(base).replace(/\/v\d+(?:beta|alpha)?$/i, '')
}

/**
 * 各协议的**请求 URL**（全平台唯一实现）。
 *
 * 版本段规则（收敛后不再按文件各写一份）：
 *  - base 已带 `/v1`、`/v1beta`、`/v3` 等版本段 ⇒ 只补叶子路径；
 *  - 其余 ⇒ 先补 `/v1` 再补叶子路径。
 *
 * 注意没有"`/openai` 结尾就跳过 `/v1`"的特例：Groq / LongCat / PPIO 的 base 就是
 * `.../openai`，它们的请求地址是 `.../openai/v1/chat/completions`；而 Gemini 的
 * `/v1beta/openai` 已带版本段，本来就走第一条规则。
 */
function versionedPrefix(baseUrl: string): string {
  const normalized = normalizeEndpointBase(baseUrl)
  if (!normalized) return '/v1'
  return hasVersionSegment(normalized) ? normalized : `${normalized}/v1`
}

/** 幂等：base 已经是完整端点地址时原样返回（网关/中转会把整条 URL 当 base 传进来）。 */
function withLeaf(baseUrl: string, leaf: string): string {
  const normalized = normalizeEndpointBase(baseUrl)
  if (normalized.toLowerCase().endsWith(leaf)) return normalized
  return `${versionedPrefix(baseUrl)}${leaf}`
}

/** OpenAI 兼容 `chat/completions`。 */
export function buildChatCompletionsUrl(baseUrl: string): string {
  return withLeaf(baseUrl, '/chat/completions')
}

/** OpenAI `responses`。 */
export function buildResponsesUrl(baseUrl: string): string {
  return withLeaf(baseUrl, '/responses')
}

/** Anthropic `messages`。 */
export function buildMessagesUrl(baseUrl: string): string {
  return withLeaf(baseUrl, '/messages')
}

/** OpenAI 兼容图像生成 `/images/generations`。 */
export function buildImageGenerationUrl(baseUrl: string): string {
  return withLeaf(baseUrl, '/images/generations')
}

/** OpenAI 兼容图像编辑 `/images/edits`。 */
export function buildImageEditUrl(baseUrl: string): string {
  return withLeaf(baseUrl, '/images/edits')
}

/** Gemini 原生 `generateContent`（模型 id 的 `models/` 前缀会被剥掉）。 */
export function buildGeminiGenerateUrl(baseUrl: string, modelId: string): string {
  const model = modelId.trim().replace(/^models\//i, '')
  return `${geminiHostBase(baseUrl)}/v1beta/models/${model}:generateContent`
}
