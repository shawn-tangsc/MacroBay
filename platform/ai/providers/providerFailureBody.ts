import {
  findMessageField,
  isRateLimitedFailure,
  sanitizeUpstreamMessage
} from './providerFailureMapping'

/**
 * PLAT-62：把上游失败响应体压成**一行可读 detail**（不渲染原始 JSON）。
 * 与 `providerFailureMapping` 的分工：那边负责 code 归类，这里负责 body 解析与展示文本。
 */

/** 解析后的上游失败字段（全部脱敏；非 JSON 只保留纯文本 message）。 */
export type UpstreamFailureDetails = {
  message: string | null
  type: string | null
  code: string | null
  requestId: string | null
  /** 分类用的附加文本（type + code），已脱敏。 */
  hints: string | null
}

/**
 * 解析响应体：JSON 只取 `error.message`（或 `message`）+ `error.type` / `error.code` + `request_id`；
 * 非 JSON 当纯文本（去标签/折叠空白/≤200）。绝不返回整段原始 JSON。
 */
export function parseUpstreamFailureDetails(rawBody: string, apiKey = ''): UpstreamFailureDetails {
  const fields = readUpstreamFields(rawBody)
  const message = sanitizeField(fields.message, apiKey)
  const type = sanitizeField(fields.type, apiKey)
  const code = sanitizeField(fields.code, apiKey)
  const requestId = sanitizeField(fields.requestId, apiKey)
  const hints = [type, code].filter((entry): entry is string => entry !== null).join(' ')
  return { message, type, code, requestId, hints: hints.length > 0 ? hints : null }
}

/** 读取响应体并解析（只返回脱敏后的字段，不返回原始 JSON）。 */
export async function readUpstreamFailureDetails(
  response: Response,
  apiKey: string
): Promise<UpstreamFailureDetails> {
  const raw = await response.text().catch(() => '')
  return parseUpstreamFailureDetails(raw, apiKey)
}

/**
 * 兼容性检查的一行 detail：`HTTP 429 · overloaded_error (1305) · message · request_id x`
 * （脱敏、去换行、≤200）。解析失败时退化为 `HTTP <status> · 纯文本`，绝不渲染原始 JSON。
 */
export type UpstreamFailureSummary = {
  detail: string
  rateLimited: boolean
}

export function summarizeUpstreamFailureBody(
  rawBody: string,
  status: number,
  apiKey = ''
): UpstreamFailureSummary {
  const details = parseUpstreamFailureDetails(rawBody, apiKey)
  const rateLimited = isRateLimitedFailure(
    status,
    [details.type, details.code, details.message].filter((entry): entry is string => entry !== null).join(' ')
  )
  const typeCode =
    details.type === null
      ? details.code
      : details.code === null
        ? details.type
        : `${details.type} (${details.code})`
  const parts = [`HTTP ${status}`]
  if (typeCode !== null) parts.push(typeCode)
  if (details.message !== null) parts.push(details.message)
  if (details.requestId !== null) parts.push(`request_id ${details.requestId}`)
  return { detail: parts.join(' · ').slice(0, 200), rateLimited }
}

function readUpstreamFields(rawBody: string): {
  message: string | null
  type: string | null
  code: string | null
  requestId: string | null
} {
  const text = rawBody.trim()
  if (!text) return { message: null, type: null, code: null, requestId: null }
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text) as unknown
      const record = asRecord(parsed)
      const error = asRecord(record?.error)
      return {
        message: findMessageField(parsed),
        type: asText(error?.type),
        code: asText(error?.code),
        requestId:
          asText(record?.request_id) ??
          asText(record?.requestId) ??
          asText(error?.request_id) ??
          asText(error?.requestId)
      }
    } catch {
      // 以 JSON 开头但解析失败 ⇒ 不把半截 JSON 当 message。
      return { message: null, type: null, code: null, requestId: null }
    }
  }
  return {
    message: text.replace(/<[^>]+>/g, ' ').trim() || null,
    type: null,
    code: null,
    requestId: null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function asText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function sanitizeField(value: string | null, apiKey: string): string | null {
  return value === null ? null : sanitizeUpstreamMessage(value, apiKey)
}
