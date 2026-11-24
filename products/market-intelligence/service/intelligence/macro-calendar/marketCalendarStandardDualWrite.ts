import type { DatabaseSync } from 'node:sqlite'

import { narwhalCanonicalIdentityKey, toAlpha2Country } from './marketCalendarMetricIdentity'
import { eventCodeBySourceType } from './marketCalendarEventCodeTable'
import { nameForMetricKey } from './marketCalendarCodeNames'

/** 事件型身份的第二段：不是指标码，`evt.*` 映射还没接。 */
const EVENT_KINDS: readonly string[] = ['central-bank-activity', 'financial-event']
import { calendarStandardTablePolicy, findCalendarStandardRowBySource, promoteCalendarStandardRowToCode,
  recordCalendarSourceId, recordCalendarUnmapped, upsertCalendarStandardRow,
  CalendarValueShapeError, type CalendarIdentityKind, type CalendarReleaseStatus,
  type CalendarUnmappedReason } from './marketCalendarStandardTable'
import { logSourceIdOverwriteSummary, type SourceIdOverwritePayload } from './marketCalendarSourceIdAudit'
import { hashIncomingValues, recordCalendarValueRevision, type CalendarMergeDecision,
  type CalendarValueField } from './marketCalendarValueRevisionAudit'

/**
 * 观测行 → 标准行的**双写**（S1：只写不读，读取路径一个字节不动）。
 *
 * 三条边界：
 * 1. 身份解析成功 → upsert 标准行（`values_json` 覆盖，首发布两列与 `first_seen_at` 冻结）；
 * 2. 解析失败 → 写 `unmapped` + `reason`（闭集），**不进日历**；
 * 3. **任何失败都不许拖停采集**：写标准表失败只记日志 + 计数，旧路径照走。
 *
 * 「写标准表失败」与「映射不上」是两件事，分开计数——前者说明代码/存储有问题，
 * 后者说明缺映射，混成一个数就没法判断该修哪边。
 */
export type DualWriteCounts = Readonly<{
  written: number
  unmapped: Readonly<Record<CalendarUnmappedReason, number>>
  failed: number
  /**
   * 同一身份、同一天被**两份不同发布**写进来的次数（源重发）。
   * 不算失败也不算丢行：值取并集（空值不覆盖有值）、两个 `source_event_id` 都留在映射表里。
   * 但**必须数出来**——今天能合，明天换个期次就可能露出来。
   */
  mergedSameDay: number
  /**
   * **无法判别的旧行**（`source_release_id` 为 NULL）：这次写入撞上了「同身份、不同排期、旧行没有判别器」，
   * 只能按老行为（新日期新行）。**必须计数、不许静默**——它是这套修法唯一的退化口。
   */
  legacyUnjudged: number
  /**
   * 这一批**第一次**写入失败的码（闭集）：没有失败就不带这个键，不写 `null`。
   * 只作上报用——**不改来源健康状态**（写入失败不是来源失败）。
   */
  firstErrorCode?: 'standard-write-failed' | 'value-shape-rejected'
}>

/**
 * **按 measure 拆行**的写入（S1 正式路径）：一次发布里的每个 measure 各一行，身份各算各的。
 * （旧形状回放那条 `dualWriteObservationBatch` 已删除：全仓 0 个生产调用者、且没有零值判据，
 * 留着就是绕过零值规则的第二个写入入口。）
 */
export function dualWriteMeasureRows(
  database: DatabaseSync,
  input: Readonly<{ providerId: string; parserVersion: string; observedAt: string
    rows: readonly Readonly<{ countryCode: string; metricKey: string; periodKey: string
      scheduledDate: string
      /** 源没给时刻就**不写**（`time_precision = 'date'`）——绝不推算一个「惯例的 8:30」。 */
      scheduledAt?: string
      sourceEventId: string
      timePrecision?: 'minute' | 'date'
      /**
       * **数据自身的观测时刻**：来源说了这条值是什么时候看到的（官方 revision 的 `detected_at`、
       * 观测行的 `last_seen_at`）。覆盖门按它比，不按写入时刻；不传才退化成 `observedAt`。
       */
      dataObservedAt?: string
      rowKind?: 'release' | 'estimate'
      identityKind?: CalendarIdentityKind
      /** `source` 身份行要带源原文名（标准码去名表查，源内 id 查不到）。 */
      sourceLabel?: string
      /** 源的 series_id（转正时重算身份用）。 */
      seriesId?: string
      /** 源给的重要性；没有就不写（读侧显示「未分级」）。 */
      importance?: 'high' | 'medium' | 'low'
      /** 行已存在时保留来源两列（回放补值专用，见 `CalendarStandardRow.preserveProvenance`）。 */
      preserveProvenance?: boolean
      /** 源内发布 id：判别「同一发布改排期」与「同期第二次真实发布」（架构师 2026-11-21 批 (b)）。 */
      sourceReleaseId?: string
      status?: CalendarReleaseStatus
      /** 由值自己算出来：有 actual/previous/consensus 之一即 present。 */
      valueState?: 'present' | 'missing'
      /** 源适配器解析好的 numeric_json（架构师方案 §2）；写入口只校验、不解析。 */
      numericJson?: string
      previous?: string; consensus?: string; actual?: string }>[] }>,
  options?: Readonly<{ onError?: (message: string) => void }>
): DualWriteCounts {
  const reasons = emptyReasons()
  let written = 0
  let failed = 0
  let mergedSameDay = 0
  let legacyUnjudged = 0
  let firstErrorCode: 'standard-write-failed' | 'value-shape-rejected' | undefined
  // 「真的把行上的发布 id 改掉了」的次数：**每轮汇总一行**，不逐行打（启动日志一分钟 1190 条就是逐行打出来的）。
  const sourceIdOverwrites: SourceIdOverwritePayload[] = []
  for (const incoming of input.rows) {
    try {
      let row = incoming
      // 源内身份的行没有标准码可查：它是「源里确实有这次发布」，不是缺映射。
      const isSourceIdentity = row.identityKind === 'source'
      const isEventCode = row.metricKey.startsWith('evt.')
      // **与读侧同一把尺**（Chief 2026-11-19）：用 `nameForMetricKey`（含「族名+测度」兜底），
      // 只看显式名表会把靠族名合成名字的码误判成 `unknown-measure`——今晚 78 行就是这么被挡回去的。
      if (!isSourceIdentity && !isEventCode && nameForMetricKey(row.metricKey) === undefined) {
        reasons['unknown-measure'] += 1
        recordCalendarUnmapped(database, { providerId: input.providerId, sourceKey: row.sourceEventId,
          detectedAt: input.observedAt, rawJson: JSON.stringify({ metricKey: row.metricKey }), reason: 'unknown-measure' })
        continue
      }
      /**
       * **同一发布改了排期 → 仍是同一行**（架构师 2026-11-21 批 (b)，方案 §2.4）。
       *
       * 判别器只有源内 `release_id`：身份改成四段后，日期变了 id 就变，只按 id 找不到旧行。
       * 找到同一 `release_id` 的行 → **沿用它的 `first_scheduled_date`（冻结）**，
       * 身份按冻结的日期重算；显示用的 `scheduled_date` 照常更新成最新排期（两个日期各管一件事）。
       *
       * 旧行（`source_release_id` 为 NULL）**无法判别**：按老行为（新日期新行），并计数，
       * 不许静默——这套修法唯一的退化口就是它。
       */
      const frozen = resolveFrozenRow(database, input.providerId, row)
      if (frozen !== undefined) {
        // **复用旧行自己的 id**：这里不重算编码——本函数是 provider 无关的，重算会把 narwhal 的
        // 编码形状套到别家（下一个传 release id 的来源会写出 narwhal 形状的 id，台账当场全成孤儿）。
        row = { ...row, sourceEventId: frozen.sourceEventId }
      } else if (legacyUnjudgedBy(database, row)) {
        legacyUnjudged += 1
      }
      const existing = findCalendarStandardRowBySource(database, {
        sourceProviderId: input.providerId, sourceEventId: row.sourceEventId
      })
      // 同身份同日的**另一份发布**：先数出来再写（值取并集、两个 id 都留痕）。
      if (existing === undefined) {
        const collision = database.prepare(`select source_event_id from ${calendarStandardTablePolicy.eventsTable}
          where country_code = ? and metric_key = ? and period_key = ? and first_scheduled_date = ?
            and source_event_id <> ? limit 1`)
          .get(toAlpha2Country(row.countryCode), row.metricKey, row.periodKey, row.scheduledDate, row.sourceEventId) as
          { source_event_id: string } | undefined
        if (collision !== undefined) mergedSameDay += 1
      }
      /**
       * **空值不写、占位 0 当缺失、真 0 照写**（用户口径 2026-11-15）。
       *
       * 判据必须落在这一处：字段缺席 / 空串 → 不写（不清空已有值）；值是 0 且该来源这一行还没发布
       * （`status !== 'published'`）→ 当成占位，不写；**已发布行的 0 是合法值**（新增就业 0K、
       * 环比 0.0%），照常写入——否则真实的零增长永远显示成「未提供」。
       */
      /**
       * **旧值必须在 upsert 之前取**（用户 2026-11-20，Chief 钉死）：upsert 之后再从表里读，
       * 拿到的就是刚写进去的新值，`value_before === value_after` 恒成立，按「值变了才写」的规则
       * 一条审计都不会写，而系统看起来完全正常——最难发现的空转。
       */
      const existingValues = existing === undefined ? {} : readValuesJson(database, existing)
      /**
       * **审计用的旧值按「目标身份」取，不是按源内发布 id**（用户 2026-11-20）：
       * 不同来源写同一格时 `findCalendarStandardRowBySource` 找不到（sourceEventId 不同），
       * 但库里那一格已经有值——按 id 取会把 before 记成 null，审计就说了假话。
       */
      const priorValues = readValuesJson(database, {
        countryCode: toAlpha2Country(row.countryCode), metricKey: row.metricKey, periodKey: row.periodKey,
        firstScheduledDate: existing?.firstScheduledDate ?? row.scheduledDate
      })
      /** 字段级判定：值与 decision 同一处产出，不许「算一次值、再猜一次为什么没写」。 */
      const decisions = {
        actual: decideMerge('actual', row.actual, existingValues.actual, row.status),
        previous: decideMerge('previous', row.previous, existingValues.previous, undefined),
        consensus: decideMerge('consensus', row.consensus, existingValues.consensus, undefined)
      }
      const writable = {
        // 状态门只作用于 `actual`：只有「这一行还没发布却带了实际值」才是占位。
        // `previous` / `consensus` 在未发布行上是**已知真值**（上一期 0K、预期 0.0%），
        // 把它们也塞进状态门，会把「预期 0.0%」这种最常见的情况丢掉。
        actual: decisions.actual.value,
        previous: decisions.previous.value,
        consensus: decisions.consensus.value
      }
      // **原地转正**：原来用源内 id 撑着的那一行，现在有标准码了 → 改这一行的码，不新增行。
      if (existing !== undefined && existing.identityKind === 'source' && row.identityKind !== 'source'
        && existing.metricKey !== row.metricKey) {
        promoteCalendarStandardRowToCode(database, { sourceProviderId: input.providerId,
          sourceEventId: row.sourceEventId, metricKey: row.metricKey })
      }
      const placed = upsertCalendarStandardRow(database, {
        countryCode: row.countryCode, metricKey: row.metricKey, periodKey: row.periodKey,
        scheduledDate: row.scheduledDate,
        ...(row.scheduledAt === undefined ? {} : { scheduledAt: row.scheduledAt }),
        ...(frozen === undefined && existing === undefined
          ? {}
          : { firstScheduledDate: frozen?.firstScheduledDate ?? existing!.firstScheduledDate }),
        ...(row.sourceReleaseId === undefined ? {} : { sourceReleaseId: row.sourceReleaseId }),
        timePrecision: row.timePrecision ?? (row.scheduledAt === undefined || row.scheduledAt.endsWith('T00:00:00.000Z') ? 'date' : 'minute'),
        ...(row.rowKind === undefined ? {} : { rowKind: row.rowKind }),
        ...(row.status === undefined ? {} : { status: row.status }),
        ...(row.identityKind === undefined ? {} : { identityKind: row.identityKind }),
        ...(row.sourceLabel === undefined ? {} : { sourceLabel: row.sourceLabel }),
        ...(row.seriesId === undefined ? {} : { seriesId: row.seriesId }),
        ...(row.numericJson === undefined ? {} : { numericJson: row.numericJson }),
        ...(row.importance === undefined ? {} : { importance: row.importance }),
        ...(row.preserveProvenance === undefined ? {} : { preserveProvenance: row.preserveProvenance }),
        /**
         * **只有拿到这一期的实际值才算「有值」**（用户 2026-11-19 定，Chief 复核）：
         * 只有 `previous` 或 `consensus` 一律 `missing`。
         *
         * 旧定义是「三者有一个就算 present」，于是某期只有前值时读者看到的是「有值」，而界面上根本没数——
         * 全库 496 行（占 present 的 19%）就是这么来的。**空串与 null 也算没值**（比缺失更糟：
         * 看起来像「有值但是空的」）。
         */
        valueState: writable.actual === undefined ? 'missing' as const : 'present' as const,
        valuesJson: JSON.stringify({
          ...(writable.consensus === undefined ? {} : { consensus: writable.consensus }),
          ...(writable.previous === undefined ? {} : { previous: writable.previous }),
          ...(writable.actual === undefined ? {} : { actual: writable.actual })
        }),
        sourceProviderId: input.providerId, sourceEventId: row.sourceEventId,
        parserVersion: input.parserVersion, observedAt: input.observedAt, firstSeenAt: input.observedAt,
        ...(row.dataObservedAt === undefined ? {} : { dataObservedAt: row.dataObservedAt }),
        ...(row.actual === undefined ? {} : { firstPublishedActual: row.actual }),
        ...(row.previous === undefined ? {} : { firstPublishedPrevious: row.previous })
      })
      // 记下「这次发布落到了哪一行」：同一行被源重发时前一个 id 会被覆盖，
      // 但溯源清单要能查到每一次发布。**身份取 upsert 真正写进去的那一组**：中英两条会被认回到
      // 同一行（迁移 18），写这一笔带来的 id 会让台账指向一个不存在的身份。
      if (placed.sourceIdOverwrite !== undefined) sourceIdOverwrites.push(placed.sourceIdOverwrite)
      /**
       * **来源审计**（31 号文档 §3）：值真的变了或拒绝覆盖才写一行。**自己 catch 自己**——
       * 审计写失败不许把已经成功的标准行写入变成失败；反过来也不写行就没有审计。
       */
      try {
        const incomingHash = hashIncomingValues({ actual: row.actual, previous: row.previous, consensus: row.consensus })
        for (const field of ['actual', 'previous', 'consensus'] as const) {
          const decision = decisions[field]
          if (decision.decision === 'keep:absent-in-source' && existingValues[field] === undefined) continue
          recordCalendarValueRevision(database, {
            countryCode: toAlpha2Country(row.countryCode), metricKey: placed.metricKey, periodKey: row.periodKey,
            firstScheduledDate: placed.firstScheduledDate, field,
            valueBefore: priorValues[field] ?? null,
            valueAfter: decision.decision === 'write' ? (decision.value ?? null) : null,
            decision: decision.decision, providerId: input.providerId, sourceEventId: row.sourceEventId,
            parserVersion: input.parserVersion, observedAt: input.observedAt, incomingHash
          })
        }
      } catch (error) {
        options?.onError?.(`价值修订审计写入失败：${(error as Error)?.message ?? 'unknown'}`)
      }
      recordCalendarSourceId(database, { providerId: input.providerId, sourceEventId: row.sourceEventId,
        countryCode: placed.countryCode, metricKey: placed.metricKey, periodKey: placed.periodKey,
        firstScheduledDate: placed.firstScheduledDate, observedAt: input.observedAt })
      written += 1
    } catch (error) {
      failed += 1
      // 第一个失败码就是上报的那个：行不合格与库写不进去要分开（架构师 2026-11-19）。
      if (firstErrorCode === undefined) {
        firstErrorCode = error instanceof CalendarValueShapeError ? 'value-shape-rejected' : 'standard-write-failed'
      }
      options?.onError?.((error as Error)?.message ?? 'unknown')
    }
  }
  logSourceIdOverwriteSummary(sourceIdOverwrites)
  // 无法判别的旧行：一轮一行，不静默（它是「改排期冻结」唯一的退化口）。
  if (legacyUnjudged > 0) {
    console.warn(`[macro-calendar] 旧行无判别器 ${legacyUnjudged} 笔：同身份不同排期但 source_release_id 为 NULL，按老行为新建行`)
  }
  return { written, unmapped: reasons, failed, mergedSameDay, legacyUnjudged,
    ...(firstErrorCode === undefined ? {} : { firstErrorCode }) }
}

/**
 * 一格的合并判定（值 + 为什么）。规则与原 `writableActual`/`writableValue` **逐条一致**：
 * 源没给/空串 → `keep:absent-in-source`；实际值 0 且未发布 → `keep:placeholder-zero`；
 * 0 且已有非空值 → `keep:zero-does-not-overwrite`；其余 → `write`。
 */
function decideMerge(field: CalendarValueField, incoming: string | undefined, existing: string | undefined,
  status: CalendarReleaseStatus | undefined): Readonly<{ value?: string; decision: CalendarMergeDecision }> {
  if (incoming === undefined || incoming.trim() === '') return { decision: 'keep:absent-in-source' }
  if (field === 'actual' && isZeroValue(incoming) && status !== undefined
    && status !== 'published' && status !== 'unknown') return { decision: 'keep:placeholder-zero' }
  if (isZeroValue(incoming) && existing !== undefined && existing.trim() !== '') {
    return { decision: 'keep:zero-does-not-overwrite' }
  }
  return { value: incoming, decision: 'write' }
}

/** 观测行的最小形状（draft 与已落库行都能满足）。 */
type ObservationLike = Readonly<{
  marketFactKey: string
  kind?: string
  displayName?: string
  countryCode?: string
  scheduledAt?: string
  scheduledDate?: string
  consensus?: Readonly<{ displayValue: string }>
  providerPrevious?: Readonly<{ displayValue: string }>
  providerActual?: Readonly<{ displayValue: string }>
}>

/**
 * 字段缺席 / 空串 → 不写；**零值不覆盖已有的非空值**。
 *
 * 用户口径原话是「空值、零值不覆盖实际有的值」，而「真实的 0 是合法值」（新增就业 0K、环比 0.0%）：
 * 两者合起来就是——**没有既有值时，真 0 照写；已经有非空值时，0 不许把它盖掉**。
 * 来源的 `status` 只用来判「这一行还没发布」：未发布却带 0 的，按占位处理，不写。
 */
/** 非实际值字段（`previous` / `consensus`）：缺席与空串不写；零值不许盖掉已有非空值。 */
function writableValue(value: string | undefined, existing: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined
  if (!isZeroValue(value)) return value
  return existing === undefined || existing.trim() === '' ? value : undefined
}

/** 实际值：在上一行规则之外，**未发布行的 0 视为占位**（这一行还没有实际值可言）。 */
function writableActual(value: string | undefined, status: CalendarReleaseStatus | undefined,
  existing: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined
  if (isZeroValue(value) && status !== undefined && status !== 'published' && status !== 'unknown') return undefined
  return writableValue(value, existing)
}

/** 已有行里的值（逐字段合并前用来判断「零值会不会盖掉真值」）。 */
function readValuesJson(database: DatabaseSync, existing: Readonly<{ countryCode: string; metricKey: string
  periodKey: string; firstScheduledDate: string }>): Readonly<Record<string, string | undefined>> {
  try {
    const row = database.prepare(`select values_json from ${calendarStandardTablePolicy.eventsTable}
      where country_code = ? and metric_key = ? and period_key = ? and first_scheduled_date = ? limit 1`)
      .get(existing.countryCode, existing.metricKey, existing.periodKey, existing.firstScheduledDate) as
      { values_json: string } | undefined
    return row === undefined ? {} : JSON.parse(row.values_json) as Record<string, string | undefined>
  } catch { return {} }
}

/** `0` / `0.0` / `-0%` 这类：数值上是零，但要靠发布状态区分真零与占位零。 */
function isZeroValue(value: string): boolean {
  const numeric = Number(value.replace(/[%+,]/g, ''))
  return Number.isFinite(numeric) && numeric === 0
}

const emptyReasons = (): Record<CalendarUnmappedReason, number> =>
  ({ 'unknown-measure': 0, 'unknown-event-type': 0, 'bad-period': 0, 'bad-identity': 0,
    'unknown-release-group': 0, 'ambiguous-same-day': 0, 'no-values': 0, 'missing-country': 0, 'no-code': 0, 'no-standard-row': 0, 'period-unresolved': 0 })

/**
 * 同一发布已有一行时返回**它自己的 `source_event_id` 与冻结的 `first_scheduled_date`**
 * （架构师 2026-11-21 批 (b)）。
 *
 * 判别器只有源内 `release_id`：身份含排期日，日期一变 id 就变，只按 id 找不到旧行。
 * 查询条件带上 `(provider, release_id, metric_key, period_key)`：**多 measure 的发布里
 * 每个指标位各有一行，只按 release_id 取 `limit 1` 是碰巧对**——带上 `metric_key` 才是确定行为。
 *
 * 返回旧行的 id 而不是重算编码：本函数 provider 无关，重算会把某一家的编码形状套给别家。
 * 找不到 → `undefined`，调用方按老行为（新日期新行）。
 */
function resolveFrozenRow(
  database: DatabaseSync,
  providerId: string,
  row: Readonly<{ sourceReleaseId?: string; identityKind?: string; metricKey: string; periodKey: string }>
): Readonly<{ sourceEventId: string; firstScheduledDate: string }> | undefined {
  if (row.sourceReleaseId === undefined || row.identityKind === 'source' || row.metricKey.startsWith('evt.')) return undefined
  const prior = database.prepare(`select source_event_id, first_scheduled_date
    from ${calendarStandardTablePolicy.eventsTable}
    where source_provider_id = ? and source_release_id = ? and metric_key = ? and period_key = ? limit 1`)
    .get(providerId, row.sourceReleaseId, row.metricKey, row.periodKey) as
    { source_event_id: string; first_scheduled_date: string } | undefined
  return prior === undefined ? undefined : {
    sourceEventId: String(prior.source_event_id), firstScheduledDate: String(prior.first_scheduled_date)
  }
}

/**
 * 这一笔是不是「撞上了没有判别器的旧行」：同身份（国家+码+期）已有行、`source_release_id` 为 NULL、
 * 且排期与本次不同。是 → 只能按老行为新建行，**计数上报**（这套修法唯一的退化口）。
 */
function legacyUnjudgedBy(
  database: DatabaseSync,
  row: Readonly<{ countryCode: string; metricKey: string; periodKey: string; scheduledDate: string
    sourceReleaseId?: string; identityKind?: string }>
): boolean {
  if (row.sourceReleaseId === undefined || row.identityKind === 'source' || row.metricKey.startsWith('evt.')) return false
  const legacy = database.prepare(`select 1 from ${calendarStandardTablePolicy.eventsTable}
    where source_provider_id is not null and country_code = ? and metric_key = ? and period_key = ?
      and source_release_id is null and first_scheduled_date <> ? limit 1`)
    .get(toAlpha2Country(row.countryCode), row.metricKey, row.periodKey, row.scheduledDate)
  return legacy !== undefined
}
