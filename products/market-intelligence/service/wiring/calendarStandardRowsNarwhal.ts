import type { DatabaseSync } from 'node:sqlite'

import type { createNarwhalCalendarAssembly } from '../intelligence/macro-calendar/narwhal-calendar/narwhalCalendarAssembly'
import { calendarStandardConservation } from '../intelligence/macro-calendar/marketCalendarStandardConservation'
import { dualWriteMeasureRows } from '../intelligence/macro-calendar/marketCalendarStandardDualWrite'
import { readFredObservationForPeriod } from '../intelligence/macro-calendar/fredIndicatorYoY'
import { ensureCalendarStandardTables, recordCalendarUnmapped } from '../intelligence/macro-calendar/marketCalendarStandardTable'
import { promoteSourceIdentities } from '../intelligence/macro-calendar/marketCalendarSourcePromotion'
import { recomputeUnmappedReasons } from '../intelligence/macro-calendar/marketCalendarUnmappedReasonBackfill'
import { syncOfficialStandardRowsAtStartup } from './calendarStandardRows'

/**
 * 日历标准行的两条接线：启动时同步官方发布、采集时写标准行。
 *
 * 从 `bootstrap.ts` 原样搬出（2026-11-18，体积门禁：bootstrap 只许变小）：
 * - **顺序契约不变**：先转正存量身份，再重算未映射原因——转正会删掉清单里的过期条目，
 *   先重算会把「已转正」算成缺码；
 * - **日志不变**：每一步仍是 `console.warn` 的原文；
 * - **失败行为不变**：标准行写入整段吞错并留一行「接线异常（已忽略）」，不阻断采集与启动。
 *
 * `startCalendarStandardRows` 只负责把惰性的 `readLatest` 闭包建在这里，启动同步与历史
 * 补值的吞错语义仍归 `wiring/calendarStandardRows.ts`。
 */
export type NarwhalStandardRowsAppend = NonNullable<
  Parameters<typeof createNarwhalCalendarAssembly>[0]['appendStandardRows']
>

/** 采集时的标准行写入：同一份 `appendStandardRows` 回调，行为逐字未改。 */
export function createNarwhalStandardRowsWriter(
  input: Readonly<{ database: () => DatabaseSync }>
): NarwhalStandardRowsAppend {
  return (rows, unmapped, sourceTotals) => {
    try {
      // 与搬家前一致：每次回调都现取当前库句柄，而不是在装配时固化。
      const database = input.database()
      ensureCalendarStandardTables(database)
      const observedAt = new Date().toISOString()
      // **启动/采集前先转正存量**：补映射之前写进去的 `source` 行，现在算得出身份的就地改码。
      // 只报三个数、不上界面；dryRun 的入口给补完映射后先看数用。
      const promotion = promoteSourceIdentities(database)
      if (promotion.scanned > 0) {
        console.warn(`[macro-calendar] 源内身份转正：扫描 ${promotion.scanned} / 转正 ${promotion.promoted} / 仍无身份 ${promotion.stillSource}`)
      }
      // **原因也要自己保持正确**（2026-11-18 用户定）：`missing-country` 是写入那一刻的原因，
      // 国家后来补上、码后来建出来，那一行却还挂着旧原因，盘点读到的永远是假数。转正之后再重算，
      // 顺序不能反：转正会删掉清单里的过期条目，先重算会把「已转正」算成缺码。幂等，跑前备份。
      const reasons = recomputeUnmappedReasons(database)
      if (reasons.deleted > 0 || reasons.updated > 0) {
        const detail = Object.entries(reasons.counts).map(([reason, count]) => `${reason} ${count}`).join(' / ')
        console.warn(`[macro-calendar] 未映射原因重算：扫描 ${reasons.scanned} / 删过期 ${reasons.deleted} / 改判 ${reasons.updated}（${detail}）`)
      }
      for (const item of unmapped) {
        // `reason` **原样落库**：这里曾用三段白名单映射，任何新原因都会被悄悄改写成
        // `unknown-event-type`（`no-values` 就会以「未知事件类型」的样子出现，指向错误的修法）。
        recordCalendarUnmapped(database, { providerId: 'narwhal', sourceKey: item.sourceKey,
          detectedAt: observedAt, rawJson: JSON.stringify({ name: item.name, measureKeys: item.measureKeys ?? [] }),
          reason: item.reason })
      }
      const counts = dualWriteMeasureRows(database, {
        providerId: 'narwhal', parserVersion: 'narwhal-calendar-mc1-v3', observedAt, rows
      }, { onError: (message) => console.warn(`[macro-calendar] 标准表写入失败：${message}`) })
      // 算式只有一份实现（`calendarStandardConservation`，带能跑红的用例）：写在这里的
      // 闭包里没人能测，而它已经错过两版（恒平、恒红）。
      const conservation = calendarStandardConservation({ sourceTotals, rows, unmapped, failed: counts.failed })
      const { releaseDiff, measureDiff } = conservation
      console.warn(`[macro-calendar] 标准行一批：发布层 输入 ${sourceTotals.releases} = 认领 ${conservation.creditedReleases}（落表∪未映射，按 id 去重）+ 失败 ${counts.failed}（差 ${releaseDiff}）；测度层 输入 ${sourceTotals.measures} = 指标行 ${conservation.landedMeasures} + 未映射 measure ${conservation.unmappedMeasures} + 事件型随行 ${conservation.excludedMeasures}（差 ${measureDiff}）`)
      if (releaseDiff !== 0) console.warn(`[macro-calendar] 发布层守恒式不成立：${releaseDiff} 条既没落表也没记未映射`)
      if (measureDiff !== 0) console.warn(`[macro-calendar] 测度层守恒式不成立：${measureDiff} 个 measure 没对上`)
      if (counts.failed > 0) console.warn(`[macro-calendar] 标准行写入失败 ${counts.failed} 条（已计入守恒式）`)
      // 三种「没有值」必须分开数：源标了已发布却没值（真缺口）、还没到发布日（排期先行）、
      // 以及**按源内身份显示**的行。混成一个数就会报出一个假缺口——今天已经数错过两次。
      const publishedNoValue = rows.filter((row) => row.status === 'published' && row.fromMeasure !== true).length
      const scheduledAhead = rows.filter((row) => row.status === 'scheduled' && row.fromMeasure !== true).length
      const sourceIdentityRows = rows.filter((row) => row.identityKind === 'source').length
      console.warn(`[macro-calendar] 身份：标准码 ${rows.length - sourceIdentityRows} 行 / 源内 ${sourceIdentityRows} 行（源内不参与跨源合并）；无值：已发布 ${publishedNoValue} 行 / 排期 ${scheduledAhead} 行；工作清单 ${unmapped.length} 条`)
    } catch (error) {
      console.warn(`[macro-calendar] 标准行接线异常（已忽略）：${(error as Error)?.message ?? 'unknown'}`)
    }
  }
}

/**
 * 启动同步官方发布 + 一次性历史补值。
 *
 * `readLatest` 是惰性闭包：真正取值发生在 `after`（模块启动完成信号）兑现之后，那时 FRED
 * fetcher 已建好。两件事都不是微任务，理由见 `calendarStandardRows.ts` 顶部。
 */
export function startCalendarStandardRows(input: Readonly<{
  database: DatabaseSync
  listEffectiveMonthAsOf: Parameters<typeof syncOfficialStandardRowsAtStartup>[0]['listEffectiveMonthAsOf']
  after: Promise<unknown>
  readFredObservationForPeriod: typeof readFredObservationForPeriod
  /** 惰性：`fredObservations` 在 `after` 兑现前的启动段里还没建好，取值必须推迟到 `readLatest` 里。 */
  fredObservations: () => Parameters<typeof readFredObservationForPeriod>[2]
  log?: (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void
  /** 来源健康记录：写库失败记在它上面（不改 `status`）。 */
  health?: Parameters<typeof syncOfficialStandardRowsAtStartup>[0]['health']
}>): void {
  syncOfficialStandardRowsAtStartup({
    database: input.database,
    listEffectiveMonthAsOf: input.listEffectiveMonthAsOf,
    after: input.after,
    readLatest: (metricKey, periodKey) =>
      input.readFredObservationForPeriod(metricKey, periodKey, input.fredObservations()),
    ...(input.log === undefined ? {} : { log: input.log }),
    ...(input.health === undefined ? {} : { health: input.health })
  })
}
