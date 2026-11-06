import type { WebSearchResponse, WebSearchSearchKeywordsRequest } from '@platform/ai/web-search'

import type { BriefingMacroValueEvent } from './dailyBriefingMacroValueLookup'

/**
 * 第二级取值：联网（`02` v2.127）。
 *
 * 第一级回查日历源拿不到的，才轮到这一层。它只做一件事——**把平台搜索的原文读成"实际值 = 一个数"**，
 * 读不出来就没有值。四条门槛都在这里：
 *
 * 1. **开关在发请求前判，且每个事件重判**：关掉/没授权时一次都不发（次数由编排层数）；
 * 2. **只认原文明确写了 actual / 实际值 / 公布值 = 数字**；模型转述、推断的一律不算；
 * 3. 值必须带**来源链接 + 抓取时刻 + 原文片段**才返回，供复核与正文标注；
 * 4. **两个来源说两个数不选**：返回冲突，由编排记下来、这一条仍算没有值。
 *
 * 它不把密钥或整份响应写进日志，也不碰设置——开关与授权由编排层翻译成 `enabled`。
 */

export type BriefingMacroWebValue = Readonly<{
  eventKey: string
  actual: string
  sourceUrl: string
  capturedAt: string
  excerpt: string
  kind: 'official' | 'media'
}>

export type BriefingMacroWebReadResult = Readonly<{
  values: readonly BriefingMacroWebValue[]
  conflicts: readonly Readonly<{ eventKey: string; values: readonly string[] }>[]
  /** 实际发出去的搜索次数（每个事件一次；被闸门挡掉的不计）。 */
  calls: number
}>

export type BriefingMacroWebRead = (
  events: readonly BriefingMacroValueEvent[]
) => Promise<BriefingMacroWebReadResult>

export function createBriefingMacroWebRead(input: Readonly<{
  /** 开关 + 授权 + 供应商就绪，三样合成一个判断，由编排层提供。 */
  enabled: () => Promise<boolean>
  searchKeywords: (request: WebSearchSearchKeywordsRequest) => Promise<Pick<WebSearchResponse, 'results'>>
  now?: () => string
}>): BriefingMacroWebRead {
  return async (events) => {
    const values: BriefingMacroWebValue[] = []
    const conflicts: { eventKey: string; values: readonly string[] }[] = []
    let calls = 0
    for (const event of events) {
      // 每个事件都重判：长跑里开关可能被关掉，关掉后连一条都不该发。
      if (!(await input.enabled())) break
      calls += 1
      const hits = await readEvent(input, event).catch(() => [] as BriefingMacroWebValue[])
      const distinct = [...new Set(hits.map((hit) => hit.actual))]
      if (distinct.length > 1) {
        conflicts.push({ eventKey: event.eventKey, values: distinct })
        continue
      }
      const hit = hits[0]
      if (hit !== undefined) values.push(hit)
    }
    return Object.freeze({ values: Object.freeze(values), conflicts: Object.freeze(conflicts), calls })
  }
}

async function readEvent(
  input: Readonly<{
    searchKeywords: (request: WebSearchSearchKeywordsRequest) => Promise<Pick<WebSearchResponse, 'results'>>
    now?: () => string
  }>,
  event: BriefingMacroValueEvent
): Promise<BriefingMacroWebValue[]> {
  // 检索词由编排确定性生成：事件名 + 日期。不是模型自由检索。
  const keyword = `${event.eventKey.split('.').pop() ?? event.eventKey} ${event.scheduledAt.slice(0, 10)} actual 实际值`
  const response = await input.searchKeywords({ keywords: [keyword] })
  const capturedAt = input.now?.() ?? new Date().toISOString()
  const hits: BriefingMacroWebValue[] = []
  for (const result of response.results ?? []) {
    const stated = readStatedActual(result.content)
    if (stated === undefined) continue
    hits.push(Object.freeze({
      eventKey: event.eventKey,
      actual: stated,
      sourceUrl: result.url,
      capturedAt,
      excerpt: excerptAround(result.content, stated),
      kind: isOfficialHost(result.url) ? 'official' as const : 'media' as const
    }))
  }
  // 官方优先只是排序；都带值且不一致时，各自成为冲突里的一个（不替读者选）。
  return hits.sort((left, right) => (left.kind === right.kind ? 0 : left.kind === 'official' ? -1 : 1))
}

/** 原文里"实际值 = 一个数"的写法；匹配不到就返回空——不做推理、不取最近的那个数。 */
export function readStatedActual(content: string): string | undefined {
  const trimmed = content.replace(/\s+/g, ' ').trim()
  if (trimmed === '') return undefined
  const match = /(?:actual(?: value)?|实际值|实际|公布值)\s*[:：=]?\s*([-+]?\d+(?:[.,]\d+)?\s*(?:%|K|M|B|千|万|亿|pp)?)/i.exec(trimmed)
  if (match === null) return undefined
  const value = match[1]?.trim()
  return value === undefined || value === '' ? undefined : value
}

function excerptAround(content: string, value: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim()
  const at = normalized.indexOf(value)
  if (at < 0) return normalized.slice(0, 160)
  return normalized.slice(Math.max(0, at - 80), Math.max(0, at - 80) + 160).trim()
}

function isOfficialHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return /(?:^|\.)(?:gov|gov\.[a-z]{2}|europa\.eu|imf\.org|oecd\.org)$/.test(host)
  } catch {
    return false
  }
}
