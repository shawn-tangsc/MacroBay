/**
 * Narwhal 日历页的解析器：**纯函数**，不碰网络、不碰库、不排序。
 *
 * 三条边界来自实测，不是推测：
 * 1. **形状严**：顶层必须是 `{ releases: [] , next_cursor?: string }`，否则整页判
 *    `response-shape-invalid`——宁可报错，也不把半页数据当全量。
 * 2. **语义宽**：认不出的 `series_id` / `family` **保留事件**。我们不认识的指标是"我们没登记"，
 *    不是"这条不存在"；丢掉它会在换源后表现为"这个国家没有这条发布"。
 * 3. `values: []` **不是错误**（实测 62/141 条如此）：这类行照样是「一次发布」，
 *    只是这一期还没有任何 measure。
 */

export type NarwhalParseFailure = 'response-shape-invalid'

export type NarwhalParsedValue = Readonly<{
  measure: string
  concept?: string
  unit?: string
  transformation?: string
  previous?: string
  consensus?: string
  actual?: string
}>

export type NarwhalParsedRelease = Readonly<{
  releaseId: string
  /** 来源给的发布时刻（UTC）。`dateBasis !== 'indicative'` 才允许显示到分钟。 */
  at: string
  timezone: string
  seriesId: string
  name: string
  country: string
  status: string
  dateBasis: 'exact' | 'indicative'
  /** 读者时区里的发布日；渲染层用它分组，时刻另用 `at`。 */
  eventDate: string
  /** 来源给的题材（`policy_communication` 这类），用于事件型分型。 */
  topic?: string
  /** 来源给的参照期（`2026-10` / `2026-Q3` / `2026-11-07`）。**直接用它，不按发布月反推。** */
  period?: string
  values: readonly NarwhalParsedValue[]
}>

export type NarwhalPageParseResult =
  | Readonly<{ state: 'succeeded'; releases: readonly NarwhalParsedRelease[]; nextCursor?: string }>
  | Readonly<{ state: 'failed'; failureCode: NarwhalParseFailure }>

export function parseNarwhalCalendarPage(
  raw: unknown,
  options: Readonly<{ asOf: string; timeZone?: string }>
): NarwhalPageParseResult {
  const frame = bodyOf(raw)
  if (frame === undefined) return { state: 'failed', failureCode: 'response-shape-invalid' }

  const releases: NarwhalParsedRelease[] = []
  for (const entry of frame.releases) {
    const release = releaseOf(entry, options)
    // 单条坏数据不该让整页失败：形状严是对**页**说的，条目级的缺字段跳过并计数由调用方看条数差。
    if (release !== undefined) releases.push(release)
  }
  return {
    state: 'succeeded',
    releases,
    ...(frame.nextCursor === undefined ? {} : { nextCursor: frame.nextCursor })
  }
}

function bodyOf(raw: unknown): Readonly<{ releases: readonly unknown[]; nextCursor?: string }> | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const record = raw as Record<string, unknown>
  const releases = record.releases
  if (!Array.isArray(releases)) return undefined
  const cursor = record.next_cursor
  // **最后一页给的是 `null`，不是缺字段**（实测）：把 null 当「到底」，不是坏形状。
  if (cursor !== undefined && cursor !== null && typeof cursor !== 'string') return undefined
  return { releases, ...(typeof cursor === 'string' && cursor !== '' ? { nextCursor: cursor } : {}) }
}

function releaseOf(entry: unknown, options: Readonly<{ asOf: string; timeZone?: string }>): NarwhalParsedRelease | undefined {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return undefined
  const record = entry as Record<string, unknown>
  const releaseId = text(record.release_id)
  // 来源给的是 `2026-11-18T13:30:00Z`（无毫秒）。存储层只认带毫秒的规范时刻，且秒级截断
  // 会让「同一发布」在库里出现两个时刻，所以在这里一次性归一。
  const rawAt = text(record.at)
  const at = rawAt === undefined ? undefined : canonicalInstantOf(rawAt)
  const timezone = text(record.timezone)
  const seriesId = text(record.series_id)
  const name = text(record.name)
  const country = text(record.country)
  const status = text(record.status)
  // 必需字段缺一，这一条就不是「一次发布」——跳过它，而不是猜。
  if ([releaseId, at, timezone, seriesId, name, country, status].some(value => value === undefined)) return undefined
  const values = valuesOf(record.values)
  if (values === undefined) return undefined
  const dateBasis = basisOf(record.date_basis)
  return {
    releaseId: releaseId!, at: at!, timezone: timezone!, seriesId: seriesId!, name: name!,
    country: country!, status: status!, dateBasis,
    eventDate: localDate(at!, options.timeZone ?? 'UTC'),
    ...(text(record.topic) === undefined ? {} : { topic: text(record.topic)! }),
    ...(text(record.period) === undefined ? {} : { period: text(record.period)! }),
    values
  }
}

function canonicalInstantOf(value: string): string | undefined {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined
}

function valuesOf(raw: unknown): readonly NarwhalParsedValue[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const values: NarwhalParsedValue[] = []
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const measure = text(record.measure)
    if (measure === undefined) continue
    values.push({
      measure,
      ...optional('concept', text(record.concept)), ...optional('unit', text(record.unit)),
      ...optional('transformation', text(record.transformation)),
      ...optional('previous', text(record.previous)), ...optional('consensus', text(record.consensus)),
      ...optional('actual', text(record.actual))
    })
  }
  return values
}

/** 只有 `indicative` 与缺省两种形态（实测 1,987 条）；其它值一律按缺省，不新造一档。 */
function basisOf(raw: unknown): NarwhalParsedRelease['dateBasis'] {
  return raw === 'indicative' ? 'indicative' : 'exact'
}

/** `at` 换算到读者时区的那一天；时刻本身仍用 `at`，不在这里截断。 */
function localDate(at: string, timeZone: string): string {
  const parsed = Date.parse(at)
  if (!Number.isFinite(parsed)) return at.slice(0, 10)
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(parsed))
    const pick = (type: string) => parts.find(part => part.type === type)?.value ?? ''
    return `${pick('year')}-${pick('month')}-${pick('day')}`
  } catch { return at.slice(0, 10) }
}

function text(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined
}

function optional<Key extends string>(key: Key, value: string | undefined): Readonly<Record<Key, string>> | Readonly<Record<never, never>> {
  return value === undefined ? {} : { [key]: value } as Readonly<Record<Key, string>>
}
