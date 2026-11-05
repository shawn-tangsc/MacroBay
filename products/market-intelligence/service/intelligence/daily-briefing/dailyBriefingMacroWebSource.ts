import type { WebSearchResponse, WebSearchSearchKeywordsRequest } from '@platform/ai/web-search'

import type {
  BriefingMacroValueCandidate,
  BriefingMacroValueFetcher,
  BriefingMacroValueHit
} from './dailyBriefingMacroValueLookup'

/**
 * 平台的联网搜索 → 「一个事件的实际值」的适配器（`02` `A0.12` 第三步）。
 *
 * 三条边界都在这一层收死：
 *
 * 1. **开关在发请求之前判**：关掉（或没授权、供应商没就绪）就一次都不发——`calls=0` 是在这里成立
 *    的，不是只在纯函数里；
 * 2. **只认原文写了"actual/实际值 = 某个数"的片段**：模型能不能从一段话里总结出一个数不重要，
 *    这里只做结构化匹配，匹配不到就没有值（宁可空着，不许编）；
 * 3. **不往日志里写密钥或整份响应**：`search` 由平台封装提供，它自己负责凭据与代理；本适配器只
 *    把结果里的 `url/title/content` 读成一条候选值。
 *
 * 它不判断"哪个数才是对的"——两个来源说两个数时，上游的 `acceptMacroValue` 会拒收并记冲突。
 */
export type BriefingMacroWebSourceSearch = (
  input: WebSearchSearchKeywordsRequest
) => Promise<Pick<WebSearchResponse, 'results'>>

export type BriefingMacroWebSource = Readonly<{
  /** 只有开关打开、且供应商可用时才发请求；返回 `false` 时一次都不发。 */
  enabled: () => Promise<boolean>
  search: BriefingMacroWebSourceSearch
  now?: () => string
}>

export function createBriefingMacroWebSource(input: BriefingMacroWebSource): BriefingMacroValueFetcher {
  return async ({ candidate }) => {
    // 一次事件一次判定：开关在两次取值之间被关掉，也不能再发下一条。
    if (!(await input.enabled())) return []
    const query = `${candidate.title} ${candidate.scheduledAt.slice(0, 10)} actual 实际值`
    const response = await input.search({ keywords: [query] })
    const capturedAt = input.now?.() ?? new Date().toISOString()
    const hits: BriefingMacroValueHit[] = []
    for (const result of response.results ?? []) {
      const value = readStatedActual(result.content)
      if (value === undefined) continue
      hits.push(Object.freeze({
        value,
        sourceUrl: result.url,
        capturedAt,
        // 片段就是复核用的那一小段原文：取到数字所在的那一句，太长就截断。
        excerpt: readExcerpt(result.content, value),
        // 官方域名（政府/央行/统计机构）优先；其余按财经媒体处理，冲突时上游不会自己选。
        kind: isOfficialHost(result.url) ? 'official' as const : 'media' as const
      }))
    }
    return hits
  }
}

/**
 * 原文里"实际值 = 一个数"的写法。匹配不到就返回 `undefined`——**不做推理、不取最近的那个数**。
 *
 * 只收三种明确写法：`actual: 86.0`、`实际值 86.0`、`公布值：-105.0`，可带百分号或中文量词。
 */
export function readStatedActual(content: string): string | undefined {
  const trimmed = content.replace(/\s+/g, ' ').trim()
  if (trimmed === '') return undefined
  const match = /(?:actual(?: value)?|实际值|实际|公布值)\s*[:：=]?\s*([-+]?\d+(?:[.,]\d+)?\s*(?:%|K|M|B|千|万|亿|pp)?)/i.exec(trimmed)
  if (match === null) return undefined
  const value = match[1]!.trim()
  return value === '' ? undefined : value
}

/** 复核用的那一小段：数字所在的句子，超过 160 字截断（字符数，不是字节）。 */
function readExcerpt(content: string, value: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim()
  const at = normalized.indexOf(value)
  if (at < 0) return normalized.slice(0, 160)
  // 往前找到句首（句号/分号/换行已经压成空格，这里按常见分隔退一步）。
  const startWindow = normalized.slice(Math.max(0, at - 80), at)
  const cut = Math.max(startWindow.lastIndexOf('. '), startWindow.lastIndexOf('。'), startWindow.lastIndexOf('; '), startWindow.lastIndexOf('；'))
  const start = cut >= 0 ? Math.max(0, at - 80) + cut + (startWindow[cut] === '.' ? 2 : 1) : Math.max(0, at - 80)
  return normalized.slice(start, start + 160).trim()
}

/** 官方发布方（政府、央行、统计机构）与财经媒体走两条可信度；只看主机名。 */
function isOfficialHost(url: string): boolean {
  const host = hostOf(url)
  if (host === undefined) return false
  return /(?:^|\.)(?:gov|gov\.[a-z]{2}|europa\.eu|ecb\.europa\.eu|imf\.org|oecd\.org)$/.test(host)
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

/** 组装层用：把平台搜索能力包成 adapter 需要的最小形状（凭据与代理由平台负责）。 */
export function briefingMacroWebSourceFromPlatform(input: Readonly<{
  enabled: () => Promise<boolean>
  searchKeywords: (request: WebSearchSearchKeywordsRequest) => Promise<Pick<WebSearchResponse, 'results'>>
  now?: () => string
}>): BriefingMacroValueFetcher {
  return createBriefingMacroWebSource({
    enabled: input.enabled,
    search: (request) => input.searchKeywords(request),
    ...(input.now === undefined ? {} : { now: input.now })
  })
}

/** 只是让类型定义在 adapter 里也有落点：候选值形状由调用方给，adapter 不重造。 */
export type { BriefingMacroValueCandidate }
