import { parseNarwhalCalendarPage, type NarwhalParsedRelease } from './narwhalCalendarParser'

/**
 * 采集循环：**只有这一层管节流与失败**。解析是纯函数，入库是仓库的事。
 *
 * 判据都来自实测：
 * - 限速头是 `x-ratelimit-remaining`（实测 `limit=8`，短窗口），**不是等 429**——等它说明已经打穿；
 * - 相邻两页至少 150ms，`remaining <= 2` 就等到 `reset`；
 * - 单轮页数上限 30：翻不完就报错并留下"读到第几页"，**不许死循环**；
 * - `401/402/429` 分别映射 `credential-invalid` / `credits-exhausted` / 按 `Retry-After` 退避一次；
 * - **没配 key 一个请求都不发**——API 层「没配」和「配错」都是 401，靠状态码分不出来。
 */

export type NarwhalCollectorFailure =
  | 'credential-not-configured' | 'credential-invalid' | 'credits-exhausted'
  | 'rate-limited' | 'response-unavailable' | 'response-shape-invalid' | 'page-budget-exhausted'

export type NarwhalPageResponse =
  | Readonly<{ state: 'page'; body: unknown; remaining?: number; resetInMs?: number }>
  | Readonly<{ state: 'http'; status: number; retryAfterMs?: number }>
  | Readonly<{ state: 'transport' }>

export type NarwhalCalendarCollectorDeps = Readonly<{
  /** 有没有 key：本地先判，没配就不发请求。 */
  readApiKey: () => string | undefined
  fetchPage: (input: Readonly<{ cursor?: string; startDate: string; endDate: string; countries: readonly string[] }>) => Promise<NarwhalPageResponse>
  /** 每页解析出的发布逐条交给调用方（入库、首发布快照都在那里）。 */
  onReleases: (releases: readonly NarwhalParsedRelease[], page: number) => void
  sleep: (milliseconds: number) => Promise<void>
  now?: () => number
}>

export type NarwhalCollectorResult =
  | Readonly<{ state: 'completed'; pages: number; releases: number }>
  | Readonly<{ state: 'failed'; failureCode: NarwhalCollectorFailure; pagesRead: number; releases: number }>

const policy = Object.freeze({
  /** 实测是短窗口桶；到 2 就等，别等 0。 */
  remainingFloor: 2,
  /** 相邻两页的最小间隔。 */
  pageGapMs: 150,
  /** 单轮页数上限：翻不完就是错，不是"再试一次"。 */
  maximumPages: 30
})

export async function collectNarwhalCalendar(input: Readonly<{
  startDate: string
  endDate: string
  countries: readonly string[]
}>, deps: NarwhalCalendarCollectorDeps): Promise<NarwhalCollectorResult> {
  if (deps.readApiKey() === undefined) {
    return { state: 'failed', failureCode: 'credential-not-configured', pagesRead: 0, releases: 0 }
  }

  let cursor: string | undefined
  let pages = 0
  let releases = 0
  let rateLimitedRetried = false

  for (;;) {
    if (pages >= policy.maximumPages) {
      return { state: 'failed', failureCode: 'page-budget-exhausted', pagesRead: pages, releases }
    }
    const response = await deps.fetchPage({
      ...(cursor === undefined ? {} : { cursor }),
      startDate: input.startDate, endDate: input.endDate, countries: input.countries
    })

    if (response.state === 'transport') {
      return { state: 'failed', failureCode: 'response-unavailable', pagesRead: pages, releases }
    }
    if (response.state === 'http') {
      if (response.status === 401) return { state: 'failed', failureCode: 'credential-invalid', pagesRead: pages, releases }
      if (response.status === 402) return { state: 'failed', failureCode: 'credits-exhausted', pagesRead: pages, releases }
      if (response.status === 429) {
        // 只退避一次：反复重试就是死循环，而这个桶是短窗口，等一次足够。
        if (rateLimitedRetried) return { state: 'failed', failureCode: 'rate-limited', pagesRead: pages, releases }
        rateLimitedRetried = true
        await deps.sleep(response.retryAfterMs ?? 1_000)
        continue
      }
      return { state: 'failed', failureCode: 'response-unavailable', pagesRead: pages, releases }
    }

    pages += 1
    const parsed = parseNarwhalCalendarPage(response.body, { asOf: new Date(deps.now?.() ?? Date.now()).toISOString() })
    if (parsed.state === 'failed') {
      return { state: 'failed', failureCode: 'response-shape-invalid', pagesRead: pages, releases }
    }
    deps.onReleases(parsed.releases, pages)
    releases += parsed.releases.length

    // 翻完最后一页：`next_cursor` 为空就是到底，它的返回顺序不是时间序，不能靠条数判断。
    if (parsed.nextCursor === undefined) return { state: 'completed', pages, releases }
    cursor = parsed.nextCursor

    if ((response.remaining ?? policy.remainingFloor) <= policy.remainingFloor) {
      await deps.sleep(Math.max(policy.pageGapMs, response.resetInMs ?? 1_000))
      continue
    }
    await deps.sleep(policy.pageGapMs)
  }
}
