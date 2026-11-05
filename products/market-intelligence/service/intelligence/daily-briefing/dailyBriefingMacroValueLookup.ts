import type { DailyBriefingCalendarEvent } from './dailyBriefingFactPacket'

/**
 * 宏观事件缺实际值时，去网上取一次——**取值的门槛**（`02` `A0.12`，用户 2026-11-06 定）。
 *
 * 这个模块只回答三件事：哪些事件该去取（上限 5、顺序固定、同一事件不重复）、取回来的东西
 * 凭什么算"一个可以写进正文的值"、以及取不到/超时/冲突时怎么办（什么都不写，不抛错）。
 *
 * 它**不联网**：真正发请求的人由调用方注入（`fetcher`）。这样"发了几次请求"是可数的，
 * WebSearch 关掉时是 0 次，也不是靠读代码猜。写进正文之前还有一道：值必须带来源链接、
 * 抓取时刻和原文片段；模型转述出来的数字不在这条路上。
 */

/** 一个事件值不值得去取：调用方给，本模块不猜加密相关性。 */
export type BriefingMacroValueCandidate = Readonly<{
  eventKey: string
  title: string
  importance: DailyBriefingCalendarEvent['importance']
  scheduledAt: string
  /** 越高越相关（0–100）。缺省按 0 排，绝不当成"很相关"。 */
  relevance?: number
}>

/**
 * 一次取值的原料。`excerpt` 是原文里能复核的那一小段；没有它就不算结构化取值（第二条判据），
 * 因为"模型从一段话里总结出来的数"无法核对。
 */
export type BriefingMacroValueHit = Readonly<{
  value: string
  sourceUrl: string
  capturedAt: string
  excerpt: string
  /** 官方发布方优先于财经媒体；两者冲突时**不选**，记冲突。 */
  kind: 'official' | 'media'
}>

export type BriefingMacroValueFetcher = (
  input: Readonly<{ candidate: BriefingMacroValueCandidate }>
) => Promise<readonly BriefingMacroValueHit[]>

/** 取到了、可以进正文的一个值：带来源与抓取时刻，读者能核对。 */
export type BriefingMacroValue = Readonly<{
  eventKey: string
  value: string
  sourceUrl: string
  capturedAt: string
  excerpt: string
}>

/** 两个来源说了两个数：不替读者选，留一条冲突记录（第 3、4 条判据）。 */
export type BriefingMacroValueConflict = Readonly<{
  eventKey: string
  values: readonly string[]
}>

export type BriefingMacroValueLookupResult = Readonly<{
  values: readonly BriefingMacroValue[]
  conflicts: readonly BriefingMacroValueConflict[]
  /** 实际发出去的请求次数——用例数的是它，不是"看起来发了"。 */
  calls: number
  /** 想取但因为上限没轮到的事件：留在内部记录里，版面不呈现。 */
  skipped: readonly string[]
}>

const DEFAULT_LIMIT = 5

/** 一版的取值上限（`02` 定的 5）。 */
export const BRIEFING_MACRO_VALUE_LIMIT = DEFAULT_LIMIT

/**
 * 该去取哪几条：**缺值**的高影响事件，按 重要性 → 距截止近 → 相关性 排，最多 5 条，同一事件一次。
 *
 * 有值的事件压根不进队列：库里有值还去联网，既浪费额度，也可能拿网页值去顶库内值（第 4 条
 * 判据禁止覆盖）。低影响事件也不进队列——上限只有 5 条，要留给最可能改变判断的那几条。
 */
export function selectMacroValueCandidates(
  input: Readonly<{
    events: readonly (BriefingMacroValueCandidate & { hasValue: boolean })[]
    cutoff: string
    limit?: number
  }>
): Readonly<{ queue: readonly BriefingMacroValueCandidate[]; skipped: readonly string[] }> {
  const cutoff = Date.parse(input.cutoff)
  const limit = input.limit ?? BRIEFING_MACRO_VALUE_LIMIT
  const seen = new Set<string>()
  const eligible = input.events
    .filter((event) => event.importance === 'high' && !event.hasValue)
    .filter((event) => {
      // 同一事件每年只取一次：事件键相同的重复行不许发两次请求。
      if (seen.has(event.eventKey)) return false
      seen.add(event.eventKey)
      return true
    })
    .map((event) => ({ event, relevance: event.relevance ?? 0, distance: Math.abs(Date.parse(event.scheduledAt) - cutoff) }))
    .sort((left, right) =>
      // 重要性相同（都是 high）→ 越贴近截止越优先 → 相关性高者优先 → 最后按事件键稳定排序。
      left.distance - right.distance ||
      right.relevance - left.relevance ||
      left.event.eventKey.localeCompare(right.event.eventKey))
  const queue = eligible.slice(0, Math.max(0, limit)).map((entry) => entry.event)
  const skipped = eligible.slice(Math.max(0, limit)).map((entry) => entry.event.eventKey)
  return Object.freeze({ queue: Object.freeze(queue), skipped: Object.freeze(skipped) })
}

/**
 * 从一次取值的候选里挑出**唯一一个**可以用的值。
 *
 * 三条都满足才接受：有原文片段（能核对）、来源链接与抓取时刻都在、同一事件只有一种说法。
 * 两个来源说法不同 → 不接受任何一个，记冲突；只有转述没有片段 → 不接受。
 */
export function acceptMacroValue(hits: readonly BriefingMacroValueHit[]): Readonly<{
  value?: BriefingMacroValue['value']
  sourceUrl?: string
  capturedAt?: string
  excerpt?: string
  conflict?: BriefingMacroValueConflict['values']
}> {
  const usable = hits.filter((hit) =>
    hit.value.trim() !== '' && hit.sourceUrl.trim() !== '' && hit.capturedAt.trim() !== '' && hit.excerpt.trim() !== '')
  const distinct = [...new Set(usable.map((hit) => hit.value.trim()))]
  if (distinct.length === 0) return Object.freeze({})
  // 只要两个来源说了**不同的数**就是不选：官方优先只在"同一事件只有一个来源可用"的排序里有意义，
  // 不意味着官方能替另一个来源下结论（第 3 条判据：冲突时不自己选）。
  if (distinct.length > 1) return Object.freeze({ conflict: Object.freeze(distinct) })
  const chosen = usable.find((hit) => hit.value.trim() === distinct[0])!
  return Object.freeze({
    value: chosen.value.trim(),
    sourceUrl: chosen.sourceUrl,
    capturedAt: chosen.capturedAt,
    excerpt: chosen.excerpt
  })
}

/** 一次取的超时：不许因为网页慢把整版生成拖住（失败就留空，不写任何话）。 */
export const BRIEFING_MACRO_VALUE_TIMEOUT_MS = 8_000

/**
 * 取一轮值。**永不抛错**：任何一个事件取失败、超时、回的不是能核对的值，都只是"这一条没有值"。
 *
 * `enabled` 为假（WebSearch 关掉、或没授权）时**一次请求都不发**，这是可数的判据。
 */
export async function lookupMissingMacroValues(input: Readonly<{
  events: readonly (BriefingMacroValueCandidate & { hasValue: boolean })[]
  cutoff: string
  enabled: boolean
  fetcher?: BriefingMacroValueFetcher
  limit?: number
  timeoutMs?: number
  now?: () => string
}>): Promise<BriefingMacroValueLookupResult> {
  const selection = selectMacroValueCandidates({ events: input.events, cutoff: input.cutoff, ...(input.limit === undefined ? {} : { limit: input.limit }) })
  const empty = Object.freeze({
    values: Object.freeze([] as BriefingMacroValue[]),
    conflicts: Object.freeze([] as BriefingMacroValueConflict[]),
    calls: 0,
    skipped: selection.skipped
  })
  if (!input.enabled || input.fetcher === undefined || selection.queue.length === 0) return empty

  const timeoutMs = input.timeoutMs ?? BRIEFING_MACRO_VALUE_TIMEOUT_MS
  const values: BriefingMacroValue[] = []
  const conflicts: BriefingMacroValueConflict[] = []
  let calls = 0
  for (const candidate of selection.queue) {
    calls += 1
    let hits: readonly BriefingMacroValueHit[] = []
    try {
      hits = await withTimeout(input.fetcher({ candidate }), timeoutMs)
    } catch {
      // 超时、网络错、页面打不开：这一条没有值，继续下一条；整个过程不受影响。
      continue
    }
    const accepted = acceptMacroValue(hits)
    if (accepted.conflict !== undefined) {
      conflicts.push(Object.freeze({ eventKey: candidate.eventKey, values: accepted.conflict }))
      continue
    }
    if (accepted.value === undefined) continue
    values.push(Object.freeze({
      eventKey: candidate.eventKey,
      value: accepted.value,
      sourceUrl: accepted.sourceUrl!,
      capturedAt: accepted.capturedAt!,
      excerpt: accepted.excerpt!
    }))
  }
  return Object.freeze({
    values: Object.freeze(values),
    conflicts: Object.freeze(conflicts),
    calls,
    skipped: selection.skipped
  })
}

/** 超时也是一种"没有值"，不是整版失败：到点就当这一条取不到。 */
async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return promise
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('macro-value-timeout')), milliseconds)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
