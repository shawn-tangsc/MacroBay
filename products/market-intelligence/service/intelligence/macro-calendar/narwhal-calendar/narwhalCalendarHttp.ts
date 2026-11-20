import type { NarwhalPageResponse } from './narwhalCalendarCollector'

/**
 * Narwhal 日历页的 HTTP 适配层：**只管把响应翻译成采集循环认识的那几种结果**。
 *
 * 真正发请求的函数由装配处注入（平台 `platformFetch`，过代理、带密钥）；这里不直接碰网络，
 * 也不碰密钥——密钥只出现在调用方那一层，不经过本文件，也不会进日志。
 *
 * 限速头的读法来自实测：`x-ratelimit-remaining` 与 `x-ratelimit-reset`，
 * 后者是「还有多少秒复位」而不是时间戳（实测每次只前移约 1 秒）。
 */

export type NarwhalHttpResult = Readonly<{
  status: number
  headers: Readonly<Record<string, string | undefined>>
  /** 已解析的 JSON；解析失败或响应体不是 JSON 时传原始文本。 */
  body: unknown
}>

export type NarwhalRequest = (input: Readonly<{
  url: string
  headers: Readonly<Record<string, string>>
}>) => Promise<NarwhalHttpResult>

const baseUrl = 'https://api.narwhalapi.com/v1/economics/calendar'

export function narwhalCalendarUrl(input: Readonly<{
  startDate: string
  endDate: string
  countries: readonly string[]
  cursor?: string
  limit?: number
}>): string {
  const params = new URLSearchParams({ start_date: input.startDate, end_date: input.endDate, limit: String(input.limit ?? 100) })
  // 多国是**重复参数**，不是逗号分隔——逗号会被当成一个国家。
  for (const country of input.countries) params.append('countries', country)
  // 响应体里的字段叫 `next_cursor`，但**请求参数**是 `cursor`（见响应里的 next_url）——
  // 按响应字段名回传会拿到 400/空页，实测踩过。
  if (input.cursor !== undefined) params.append('cursor', input.cursor)
  return `${baseUrl}?${params.toString()}`
}

/** 把一次 HTTP 结果翻译成采集循环的输入；401/402/429 保持状态码，由循环决定语义。 */
export function toPageResponse(result: NarwhalHttpResult): NarwhalPageResponse {
  if (result.status === 401 || result.status === 402 || result.status === 429) {
    const retryAfterMs = secondsOf(result.headers['retry-after'])
    return { state: 'http', status: result.status, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) }
  }
  if (result.status < 200 || result.status >= 300) return { state: 'http', status: result.status }
  const remaining = countOf(result.headers['x-ratelimit-remaining'])
  const resetInMs = secondsOf(result.headers['x-ratelimit-reset'])
  return {
    state: 'page', body: result.body,
    ...(remaining === undefined ? {} : { remaining }),
    ...(resetInMs === undefined ? {} : { resetInMs })
  }
}

export function createNarwhalPageFetcher(request: NarwhalRequest, readApiKey: () => string | undefined) {
  return async (input: Readonly<{ cursor?: string; startDate: string; endDate: string; countries: readonly string[] }>): Promise<NarwhalPageResponse> => {
    const key = readApiKey()
    // 没配 key 不发请求：API 层「没配」与「配错」都是 401，分不出来。
    if (key === undefined) return { state: 'http', status: 401 }
    try {
      const result = await request({
        url: narwhalCalendarUrl(input),
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }
      })
      return toPageResponse(result)
    } catch {
      return { state: 'transport' }
    }
  }
}

/** 响应头是字符串数组形态时也认；负数与 NaN 一律当没读到。 */
function secondsOf(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const value = Number(raw.trim())
  return Number.isFinite(value) && value >= 0 ? value * 1_000 : undefined
}

function countOf(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const value = Number(raw.trim())
  return Number.isInteger(value) && value >= 0 ? value : undefined
}
