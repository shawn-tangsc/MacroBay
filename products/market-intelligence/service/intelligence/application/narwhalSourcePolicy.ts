/**
 * Narwhal：日历换源的目标源。**这一版只验证密钥**，不采集（采集器与解析器还没落）。
 *
 * 数字与判据来自实测口径（Chief 2026-11-13 给的事实，非转述）：
 * - base `https://api.narwhalapi.com`，鉴权 **`Authorization: Bearer <key>`**；
 * - 免费档 5,000 次/月、50 次/分；
 * - `401` = key 无效，`402 insufficient_credits` = 额度用尽，`429` = 限速（带 `Retry-After`）。
 *
 * **402 与「套餐不含」是两件事**：前者是这个月没了、下个月会回来，后者是这条路走不通。
 * 所以它有自己的失败码 `credits-exhausted`，不许折进 `plan-restricted`。
 */
export const narwhalSourcePolicy = Object.freeze({
  providerId: 'narwhal',
  /** 密钥挂在第一条 feed 上：三条都还没采集器，派生不出「哪条能测」，所以这里写明。 */
  sourceId: 'macro-calendar-narwhal-economic-data',
  displayName: 'Narwhal',
  baseUrl: 'https://api.narwhalapi.com',
  /** 探针打的日历接口：一次同时回答「key 有效 + 日历权限在 + 返回是 JSON」。 */
  calendarPath: '/v1/economics/calendar',
  /** 只问一个国家、两天窗口——探针要的是一张收据，不是一个数据集。 */
  probeCountries: 'USA',
  probeWindowDays: 2,
  timeoutMs: 15_000,
  authHeader: 'authorization',
  authScheme: 'Bearer',
  /** 免费档额度，写在这里是为了让「为什么被退避」有出处，不是新的限流实现。 */
  quota: Object.freeze({ monthlyRequests: 5_000, perMinuteRequests: 50 })
})

/** 探针地址：国家与窗口都走查询参数，默认「今天..明天」。 */
export function narwhalCalendarProbeUrl(now: Date = new Date(), policy: typeof narwhalSourcePolicy = narwhalSourcePolicy): string {
  const start = new Date(now.getTime())
  const end = new Date(now.getTime() + (policy.probeWindowDays - 1) * 24 * 60 * 60 * 1_000)
  const query = new URLSearchParams({
    countries: policy.probeCountries,
    start_date: utcDate(start),
    end_date: utcDate(end)
  })
  return `${policy.baseUrl}${policy.calendarPath}?${query.toString()}`
}

function utcDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}
