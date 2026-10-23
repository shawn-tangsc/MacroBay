/**
 * PLAT-61：把底层传输/HTTP 失败映射成**可判定原因**，并从上游响应体里提取可读 message。
 * 从 `providerConnection` 抽出（单文件 <300 行）；连接检查、模型同步、代理自检共用这一套。
 * 安全：只读 message 文本，绝不返回请求体/Key/响应头；message 脱敏、去换行、≤200 字符。
 */
/**
 * PLAT-61 诊断可用性：失败的**可判定原因**。渲染层只负责把 code 翻成一句人话；
 * 原始技术信息仍放在 `message`（安全、已去敏）里作为 detail。
 */
export type ProviderConnectionFailureCode =
  | 'missing_api_key'
  | 'model_not_found'
  | 'invalid_response'
  | 'network_dns'
  | 'network_refused'
  | 'network_timeout'
  | 'tls_error'
  | 'proxy_error'
  | 'http_401'
  | 'http_403'
  | 'http_404'
  | 'http_5xx'
  /** PLAT-62：限流/过载（HTTP 429 或上游 overloaded / rate limit / 1305）。 */
  | 'rate_limited'
  /** PLAT-62 追加：该模型/渠道不支持 Anthropic Messages 协议。 */
  | 'protocol_unsupported'
  | 'account_balance_insufficient'
  /** PLAT-66：模型生命周期——上游已停止提供该模型（has been retired / 已下线）。 */
  | 'model_retired'
  /** PLAT-66：模型生命周期——当前没有可用渠道（渠道故障；区别于「未开通/需购买量包」）。 */
  | 'model_unavailable'
  /** PLAT-66：Gemini 原生端点没配（配置缺项，不是上游失败，不发请求）。 */
  | 'gemini_native_endpoint_missing'
  | 'model_not_activated'
  | 'unknown'
  /* 兼容旧报告里已经持久化的 code（不新增写入）。 */
  | 'unauthorized'
  | 'dns_error'
  | 'connection_refused'
  | 'timeout'
  | `http_${number}`

export const ProviderConnectionFailurePolicy = {
  message: 'Connection failed.'
} as const

/**
 * 非 2xx 的可判定原因。**优先**看限流/过载（429 / overloaded / 1305），再看余额不足、模型生命周期
 * （已下线 / 无可用渠道 / 未开通），然后看状态码：401/403、404（模型）、协议不支持、5xx，其余 `http_<status>`。
 */
export function classifyHttpFailure(
  status: number,
  upstreamMessage: string | null,
  upstreamHints: string | null = null
): ProviderConnectionFailureCode {
  const text = [upstreamMessage, upstreamHints].filter(Boolean).join(' ')
  // OpenAI 用 **429** 表达"额度用尽"（`insufficient_quota` / `credit_balance_exhausted`：
  // 「You have no credits remaining」）。这不是限流：先按文案里的余额特征判，
  // 否则用户只会看到「限流」去重试，永远想不到要充值。
  if (status === 429 && isBalanceMessageWithoutRateLimit(upstreamMessage)) {
    return 'account_balance_insufficient'
  }
  if (isRateLimitedFailure(status, text)) return 'rate_limited'
  if (isAccountBalanceFailure(status, upstreamMessage)) return 'account_balance_insufficient'
  // PLAT-66：模型生命周期优先于状态码，否则 502 +「has been retired」只会显示成「HTTP 5xx」。
  if (isModelRetiredFailure(text)) return 'model_retired'
  if (isModelUnavailableFailure(text)) return 'model_unavailable'
  if (isModelNotActivatedFailure(text)) return 'model_not_activated'
  if (status === 401) return 'http_401'
  if (status === 403) return 'http_403'
  if (status === 404) {
    const body = upstreamMessage ?? ''
    if (/model/i.test(body) && /(not found|does not exist|no such|unknown model|invalid model)/i.test(body)) {
      return 'model_not_found'
    }
    return 'http_404'
  }
  // 协议不支持：优先于泛化 5xx（AIOnly 的 500 + 「无渠道支持messages协议」）。
  if (isProtocolUnsupportedFailure(status, text)) return 'protocol_unsupported'
  if (status >= 500 && status <= 599) return 'http_5xx'
  return `http_${status}`
}

/** 限流/过载特征：HTTP 429，或上游文本含 overloaded / rate limit / too many requests / 1305。 */
const RATE_LIMIT_PATTERN = /overloaded|rate[\s_-]?limit|too many requests|1305|\b429\b/i

export function isRateLimitedFailure(status: number | null, upstreamText: string | null): boolean {
  if (status === 429) return true
  return upstreamText !== null && RATE_LIMIT_PATTERN.test(upstreamText)
}

/**
 * PLAT-66：模型已被供应商下线。实测（七牛云）：
 * `Model deepseek-v3 has been retired on 2026-10-09 and is no longer available.`
 */
const MODEL_RETIRED_PATTERN = /has been retired|no longer available|已下线|不再可用|已停止服务/i

/** PLAT-66：当前没有可用渠道（渠道故障），与「未开通 / 需购买量包」分开。 */
const MODEL_UNAVAILABLE_PATTERN = /no available channels?|无可用渠道|没有可用渠道/i

export function isModelRetiredFailure(upstreamText: string | null): boolean {
  return upstreamText !== null && MODEL_RETIRED_PATTERN.test(upstreamText)
}

export function isModelUnavailableFailure(upstreamText: string | null): boolean {
  return upstreamText !== null && MODEL_UNAVAILABLE_PATTERN.test(upstreamText)
}

/** 模型未对当前账号开通（AIOnly 常见：模型不可用 / 开通模型 / 购买量包）。 */
export function isModelNotActivatedFailure(upstreamText: string | null): boolean {
  if (upstreamText === null) return false
  const text = upstreamText.toLowerCase()
  return /模型不可用|开通模型|购买量包|not\s*activated/.test(text)
}

/** Anthropic Messages 协议不支持的特征（中英文上游文案都覆盖）。 */
export function isProtocolUnsupportedFailure(status: number | null, upstreamText: string | null): boolean {
  if (upstreamText === null) return false
  const text = upstreamText.toLowerCase()
  if (!text.trim()) return false
  if (/messages\s*协议/.test(text)) return true
  const mentionsProtocol = /协议|protocol/.test(text)
  if (mentionsProtocol && /(not support|not supported|unsupported|不支持|无渠道)/.test(text)) return true
  if (/protocol/.test(text)) return true
  return (status === 400 || status === 500) && /messages/.test(text)
}

/**
 * 429 里"其实是没钱"的文案特征：命中余额词、且**没有**限流词。
 *
 * 反例（仍算限流）：`Rate limit reached ... please check your plan and billing details.`
 * —— 提到 billing，但主语是限流。
 */
function isBalanceMessageWithoutRateLimit(upstreamMessage: string | null): boolean {
  if (upstreamMessage === null) return false
  if (/rate[\s_-]?limit|too many requests|overloaded/i.test(upstreamMessage)) return false
  return /no credits?\b|insufficient_quota|credit_balance|balance|recharge|exceeded your current quota|quota exceeded/i.test(upstreamMessage)
}

export function isAccountBalanceFailure(status: number, upstreamMessage: string | null): boolean {
  if (status === 402) return true
  return upstreamMessage !== null && /balance|insufficient|recharge|quota|credit/i.test(upstreamMessage)
}

/** `HTTP 402 · {上游 message}`：detail 保留状态码与上游原文（含 tid）。 */
export function buildHttpDetail(status: number, upstreamMessage: string | null): string {
  return upstreamMessage === null ? `HTTP ${status}` : `HTTP ${status} · ${upstreamMessage}`
}

/**
 * 从响应体里提取上游错误 message（JSON: error.message / message / detail / error 字符串，
 * 纯文本直接用）。脱敏：抹掉 Key（含 URL-encoded）、去换行、折叠空白、≤200 字符。
 * 只返回 message 文本 —— 绝不返回请求体、Key 或响应头。
 */
export async function readUpstreamErrorMessage(response: Response, apiKey: string): Promise<string | null> {
  const raw = await response.text().catch(() => '')
  if (!raw) return null
  const message = extractMessageFromBody(raw.slice(0, 4096))
  if (message === null) return null
  return sanitizeUpstreamMessage(message, apiKey)
}

function extractMessageFromBody(raw: string): string | null {
  const text = raw.trim()
  if (!text) return null
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text) as unknown
      // PLAT-62：解析不出可读 message 时只返回 null，绝不把 JSON 原样当 message。
      return findMessageField(parsed)
    } catch {
      // 以 JSON 开头但解析失败 ⇒ 同样不把半截 JSON 抛给用户。
      return null
    }
  }
  // HTML/纯文本：去掉标签，保留可读文本。
  return text.replace(/<[^>]+>/g, ' ').trim() || null
}

export function findMessageField(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  for (const key of ['message', 'msg', 'detail', 'error_description']) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate
  }
  const error = record.error
  if (typeof error === 'string' && error.trim()) return error
  if (error && typeof error === 'object') {
    const nested = findMessageField(error)
    if (nested !== null) return nested
  }
  const errors = record.errors
  if (Array.isArray(errors)) {
    for (const entry of errors) {
      const nested = findMessageField(entry)
      if (nested !== null) return nested
    }
  }
  return null
}

export function sanitizeUpstreamMessage(message: string, apiKey: string): string | null {
  let safe = message.replace(/\s+/g, ' ').trim()
  if (apiKey) safe = safe.split(apiKey).join('[redacted]')
  const encodedKey = apiKey ? encodeURIComponent(apiKey) : ''
  if (encodedKey && encodedKey !== apiKey) safe = safe.split(encodedKey).join('[redacted]')
  // 上游 message 里若带 URL（可能含查询串），只保留去掉 query 的部分。
  safe = safe.replace(/(https?:\/\/[^\s?]+)\?[^\s]*/gi, '$1')
  return safe.length === 0 ? null : safe.slice(0, 200)
}

/** 底层传输错误的 code（fetch 的 cause.code 优先），用于给用户可判定的原因。 */
export function classifyProviderTransportFailure(error: unknown): ProviderConnectionFailureCode | undefined {
  const texts = collectErrorTexts(error)
  const joined = texts.join(' ').toLowerCase()
  const codes = collectErrorCodes(error).map((code) => code.toUpperCase())

  if (/proxy|socks|tunnel/.test(joined) || codes.some((code) => code.includes('PROXY'))) return 'proxy_error'
  if (
    codes.some((code) => /CERT|TLS|SSL|VERIFY|EPROTO/.test(code)) ||
    /(tls|ssl)|certificate|self[- ]signed/.test(joined)
  ) {
    return 'tls_error'
  }
  if (
    codes.some((code) => code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EAI_FAIL') ||
    /getaddrinfo|dns|name_not_resolved/.test(joined)
  ) {
    return 'network_dns'
  }
  if (
    codes.some((code) => code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EPIPE') ||
    /connection refused|connection reset/.test(joined)
  ) {
    return 'network_refused'
  }
  if (
    codes.some((code) => code.includes('TIMEOUT') || code === 'ETIMEDOUT') ||
    /timed? ?out|timeout/.test(joined)
  ) {
    return 'network_timeout'
  }
  return undefined
}

function collectErrorCodes(error: unknown): string[] {
  const codes: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown }
    if (typeof candidate.code === 'string' && candidate.code.length > 0) codes.push(candidate.code)
    current = candidate.cause
  }
  return codes
}

function collectErrorTexts(error: unknown): string[] {
  const texts: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const candidate = current as { name?: unknown; message?: unknown; cause?: unknown }
    if (typeof candidate.name === 'string') texts.push(candidate.name)
    if (typeof candidate.message === 'string') texts.push(candidate.message)
    current = candidate.cause
  }
  return texts
}

/**
 * 安全的技术细节：去掉 URL（可能带查询参数）、显式抹掉这把 Key（含 URL-encoded 形式），
 * 不输出堆栈，并截断到可读长度。
 */
export function describeTransportFailure(error: unknown, apiKey: string): string {
  const joined = collectErrorTexts(error).join(' ').replace(/\s+/g, ' ').trim()
  if (!joined) return ProviderConnectionFailurePolicy.message
  let safe = joined
  if (apiKey) safe = safe.split(apiKey).join('[redacted]')
  const encodedKey = encodeURIComponent(apiKey)
  if (apiKey && encodedKey !== apiKey) safe = safe.split(encodedKey).join('[redacted]')
  safe = safe.replace(/https?:\/\/\S+/gi, '[url]').slice(0, 180).trim()
  return safe || ProviderConnectionFailurePolicy.message
}

