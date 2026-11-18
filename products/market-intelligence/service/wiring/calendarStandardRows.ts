import type { DatabaseSync } from 'node:sqlite'

import { ensureCalendarStandardTables } from '../intelligence/macro-calendar/marketCalendarStandardTable'
import { syncOfficialStandardRows } from '../intelligence/macro-calendar/marketCalendarOfficialSourceRows'
import { ensureOfficialHistoryReplayed } from '../intelligence/macro-calendar/marketCalendarOfficialHistoryReplay'
import { mergeMPeriodStandardRows } from '../intelligence/macro-calendar/marketCalendarPeriodKeyMerge'
import { normalizeCalendarCountryCodes } from '../intelligence/macro-calendar/marketCalendarCountryNormalization'
import { normalizeObservationCountryAliases } from '../intelligence/macro-calendar/marketCalendarObservationCountryAliasNormalization'
import { promoteSourceIdentities } from '../intelligence/macro-calendar/marketCalendarSourcePromotion'
import { recomputeUnmappedReasons } from '../intelligence/macro-calendar/marketCalendarUnmappedReasonBackfill'
import { normalizeSourcePeriods, normalizeSourcePeriodsByShape } from '../intelligence/macro-calendar/marketCalendarSourcePeriodMigration'
import { backfillObservationCountries } from '../intelligence/macro-calendar/marketCalendarObservationCountryBackfill'
import { fillObservationCountriesByName } from '../intelligence/macro-calendar/marketCalendarObservationCountryNameFill'
import { backfillCalendarEventTypes } from '../intelligence/macro-calendar/marketCalendarEventTypeBackfill'
import { mergeCrossSourceCalendarRows } from '../intelligence/macro-calendar/marketCalendarCrossSourceMerge'
import { mergeSameSourceNameRows } from '../intelligence/macro-calendar/marketCalendarSameIdentityMerge'
import { fixCalendarEventCountries } from '../intelligence/macro-calendar/marketCalendarEventCountryFix'
import { fixFomcEventTypes } from '../intelligence/macro-calendar/marketCalendarFomcEventTypeFix'
import { ensureReleaseStatusCheckExtended } from '../intelligence/macro-calendar/marketCalendarReleaseStatusMigration'
import { reconcileExpiredReleaseStatuses } from '../intelligence/macro-calendar/marketCalendarReleaseStatusReconcile'
import { ensureHistoricalValuesFilled } from '../intelligence/macro-calendar/marketCalendarHistoricalValueFill'

/**
 * **一次性历史补值**的接线（管欠账，管未来的是采集作业末尾那次扫描）。
 *
 * 两件事必须分清楚：
 * - `after` 是**模块的启动完成信号**（`intelligenceModule.startupReady`），不是微任务：
 *   `registerServices` 里 FRED fetcher 的创建晚于启动同步，裸 `queueMicrotask` 会被中途任何
 *   一个 `await` 边界提前冲刷，于是补值跑在 fetcher 之前、报错又被启动链的吞错吃掉——
 *   表现和「没接线」一模一样，且最难查。
 * - `readLatest` 是**惰性 getter 的结果**：真正取值发生在 `after` 兑现之后，那时 fetcher 已建好。
 *
 * 失败不阻断启动：`ensureHistoricalValuesFilled` 自己吞错并留一行日志，这里再兜一层
 * （信号本身被拒时也一样），启动链永远不因补值失败而失败。
 */
export function scheduleHistoricalValueFill(input: Readonly<{
  database: DatabaseSync
  /** 启动完成信号；补值只在它兑现之后开始。 */
  after: Promise<unknown>
  readLatest: (metricKey: string, periodKey: string) => Promise<Readonly<{ period: string; value: string }> | undefined>
}>): void {
  void input.after
    .then(() => ensureHistoricalValuesFilled(input.database, {
      today: new Date().toISOString().slice(0, 10),
      nowMs: Date.now(),
      readLatest: input.readLatest
    }))
    .catch((error: unknown) => console.warn(`[macro-calendar] 历史补值调度失败（已忽略）：${(error as Error)?.message ?? 'unknown'}`))
}

/**
 * 启动时把**本月与下月**的官方发布写进标准表。
 *
 * 不写进去，切读侧那天 CPI、非农、FOMC 会从日历上消失；官方行按「发布键 → 标准码」写，
 * 拼不出码的落源内身份（照样显示）。
 *
 * **失败不阻断启动**（红线 1）：整段包在 `try/catch` 里、catch 只打日志不抛——一个源不可用
 * 不许把整个产品拖起来不了。搬家时这两条日志逐字保留（`console.warn` 是这条链唯一的现场）。
 */
export function syncOfficialStandardRowsAtStartup(input: Readonly<{
  database: DatabaseSync
  listEffectiveMonthAsOf: Parameters<typeof syncOfficialStandardRows>[1]['listEffectiveMonthAsOf']
  /** 测试可注入的时钟；生产不传，用当前时刻。 */
  now?: () => Date
  /**
   * 模块启动完成信号。给了才跑**一次性历史补值**（管欠账的那一笔）；没给就只做同步与回放。
   *
   * 为什么必须是信号而不是微任务：FRED fetcher 建在 `registerServices` 靠后的位置，裸微任务会被
   * 中途任何 `await` 边界提前冲刷，补值于是跑在 fetcher 之前、报错又被启动链的吞错吃掉——
   * 表现和「没接线」一模一样。
   */
  after?: Promise<unknown>
  /** 历史补值的读数口（惰性：真正取值在 `after` 兑现之后）。 */
  readLatest?: (metricKey: string, periodKey: string) => Promise<Readonly<{ period: string; value: string }> | undefined>
  /**
   * 产品日志口（`deps.log`）。**没有它这些告警只落在 `console.warn`**，而主进程的 stdout
   * 不写进 `app.log`——2026-11-18 排查「启动迁移一条日志都没有」时才发现：整份 3.3 MB 的
   * `app.log` 里 `[macro-calendar]` 出现 **0 次**，连那行无条件打印的「官方发布入标准表」都没有。
   * 于是「没日志」被误读成「没执行」。给了这个口子，每一步迁移都能在 `app.log` 里查到。
   */
  log?: (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void
}>): void {
  // 一条消息走两个口：产品日志（可查）+ 控制台（开发时看）。两者都要，缺一个就有人读错现场。
  const report = (message: string): void => {
    input.log?.('warn', 'macro-calendar.startup-migration', { message })
    console.warn(message)
  }
  try {
    const database = input.database
    ensureCalendarStandardTables(database)
    const now = (input.now ?? (() => new Date()))()
    const months = [now.toISOString().slice(0, 7),
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 7)]
    const synced = syncOfficialStandardRows(database, {
      listEffectiveMonthAsOf: input.listEffectiveMonthAsOf,
      months, asOf: now.toISOString(), parserVersion: 'official-standard-rows-v1',
      onError: (message: string) => report(`[macro-calendar] 官方标准行写入失败：${message}`)
    })
    report(`[macro-calendar] 官方发布入标准表：${months.join('/')} 读到 ${synced.revisions} 条、写入 ${synced.written} 条、失败 ${synced.failed} 条`)
    // **官方历史回放（S1）挂在这里**：同一个启动点、同一套「失败不阻断启动」的语义。
    // 带版本标记（迁移 12），跑过一次就跳过；bootstrap 一行都不用新增。
    try {
      // 状态 CHECK 四值 → 五值（重建表、旧表留作回滚点、视图显式重建）。与回放同一点、同事务语义。
      ensureReleaseStatusCheckExtended(database)
      // 过期却还挂着 `scheduled` 的行按五态规则对账（幂等：状态由日期+有没有值推导，跑两遍一致）。
      const reconciled = reconcileExpiredReleaseStatuses(database,
        { today: now.toISOString().slice(0, 10), nowMs: now.getTime() })
      // **对账要留下「往哪个方向翻」**：只说「改写 N 行」看不出是 published→backfilling 还是反过来。
      // 用户 2026-11-16 的验收样本就靠这一行：narwhal 那行 published→待补值、0xrouter 两行 backfilling→已发布。
      if (reconciled.updated > 0) {
        const delta = Object.fromEntries([...new Set([...Object.keys(reconciled.before), ...Object.keys(reconciled.after)])]
          .map((status) => [status, (reconciled.after[status] ?? 0) - (reconciled.before[status] ?? 0)])
          .filter(([, change]) => change !== 0))
        report(`[macro-calendar] 过期发布状态对账：扫描 ${reconciled.scanned} 行、改写 ${reconciled.updated} 行`
          + `、方向 ${JSON.stringify(delta)}、现状 ${JSON.stringify(reconciled.after)}`)
      }
      ensureOfficialHistoryReplayed(database)
      // 「这一行是什么」与重要性回填（迁移 16）：以前没存，读侧只能靠前缀猜（423 行被猜成经济指标）。
      // 跨源同名合并（迁移 17）：同一次发布两家各报一份不该是两行；值冲突的那组两条都留。
      const crossSource = mergeCrossSourceCalendarRows(database)
      if (crossSource.mergedGroups > 0) {
        report(`[macro-calendar] 跨源合并：${crossSource.groups} 组里合并 ${crossSource.mergedGroups} 组、`
          + `删 ${crossSource.removedRows} 行；值冲突保留 ${crossSource.conflictedGroups} 组`)
      }
      // 事件国家按机构归属（迁移 19）：威廉姆斯归 USA、拉加德/连恩归 EMU——按机构，不按开会地点。
      const countryFixed = fixCalendarEventCountries(database)
      if (countryFixed.updated > 0) {
        report(`[macro-calendar] 事件国家修正：扫描 ${countryFixed.scanned} 条规则、改写 ${countryFixed.updated} 行`)
      }
      // FOMC 各次会议被标成「经济指标」（迁移 20）：身份不变，只把类别改回事件。
      const fomcFixed = fixFomcEventTypes(database)
      if (fomcFixed.updated > 0) {
        report(`[macro-calendar] FOMC 类别修正：识别 ${fomcFixed.scanned} 行、改写 ${fomcFixed.updated} 行`)
      }
      // 同源中英两条合并（迁移 18）：源对同一件事发了中文名、英文名两条，身份第一段相同，库里是两行。
      // 合并后中文名做显示、英文原文进 `source_label_en` 仍可搜；台账改指到留下的那一行。
      const sameSourceNames = mergeSameSourceNameRows(database)
      if (sameSourceNames.mergedGroups > 0) {
        report(`[macro-calendar] 同源中英合并：${sameSourceNames.groups} 组里合并 `
          + `${sameSourceNames.mergedGroups} 组、删 ${sameSourceNames.removedRows} 行、`
          + `留下英文原文名 ${sameSourceNames.englishNameStored} 行、台账改指 ${sameSourceNames.ledgerRewritten} 条、`
          + `同月改期未合并 ${sameSourceNames.rescheduledKept} 组（两次排期记录，不是重复）`)
      }
      const eventTypes = backfillCalendarEventTypes(database)
      if (eventTypes.eventTypeFilled > 0 || eventTypes.importanceFilled > 0) {
        report(`[macro-calendar] 事件类型回填：待补 ${eventTypes.pending} 行、写入类型 `
          + `${eventTypes.eventTypeFilled} 行、写入重要性 ${eventTypes.importanceFilled} 行`)
      }
      // 期次归一（迁移 14）：历史上按 BLS 写法落成 `YYYY-MNN` 的行并回 `YYYY-MM`，幂等、有备份。
      const mergedPeriods = mergeMPeriodStandardRows(database)
      // **期次归一（迁移 21）：按身份重算**；迁移 22：**按形状**重算（`period_key` 含发布时刻的一律重算，
      // 不吃「按名单筛、名单漏了」那个亏）。22 必须在 21 之后：21 只覆盖数组身份行，22 收剩下的码身份行。
      const periodByName = normalizeSourcePeriods(database)
      if (periodByName.rewritten > 0) {
        report(`[macro-calendar] 期次归一：重算 ${periodByName.rewritten} 行、缺失 ${periodByName.unknown} 行、`
          + `撞行 ${periodByName.mergedGroups} 组、删 ${periodByName.droppedRows} 行`)
      }
      const periodByShape = normalizeSourcePeriodsByShape(database)
      if (periodByShape.rewritten > 0) {
        report(`[macro-calendar] 期次按形状归一：重算 ${periodByShape.rewritten} 行、缺失 ${periodByShape.unknown} 行、`
          + `撞行 ${periodByShape.mergedGroups} 组、删 ${periodByShape.droppedRows} 行`)
      }
      // **按源给的国家名补 country_code（迁移 25）**：源一直给了名字，我们只是没做名字→码。
      // 必须先于「按 indicatorId 继承」跑——名字是源的一手事实，继承只是二手补法。
      const byName = fillObservationCountriesByName(database)
      if (byName.updated > 0 || byName.unknownNames > 0) {
        report(`[macro-calendar] 观测国家按名补齐：补 ${byName.updated} 条`
          + `、名字不在表里 ${byName.unknownNames} 条（不猜，需登记写法）`)
      }
      // **按 indicatorId 补观测的国家（迁移 24）**：同一个 id 就是同一个序列，它在别的观测里带过国家，
      // 这一条就该是那个国家——这是事实不是猜。必须先于国家码归一跑，否则补进来的三位写法当场又不规范。
      const observationCountries = backfillObservationCountries(database)
      if (observationCountries.updated > 0) {
        report(`[macro-calendar] 观测国家补齐：补 ${observationCountries.updated} 条`
          + `（${observationCountries.indicatorIds} 个 indicatorId）、补不了 ${observationCountries.unresolvable} 条`)
      }
      // **观测表国家码归一（迁移 26）**：UK/JPN/FRA… 这些别名与三位写法归成两位（Chief 2026-11-18）。
      // 幂等、跑前备份；`EMU` 不动。放在标准表国家归一之前：观测是上游，先把它洗干净。
      const observationAliases = normalizeObservationCountryAliases(database)
      if (observationAliases.renamed > 0) {
        report(`[macro-calendar] 观测国家码归一：扫描 ${observationAliases.scanned} 行、改写 ${observationAliases.renamed} 行`)
      }
      // 国家码归一（迁移 15）：`USA` 这类历史写法并回 alpha-2，撞行合并、台账同归一，幂等、有备份。
      const normalizedCountries = normalizeCalendarCountryCodes(database)
      if (normalizedCountries.renamed > 0 || normalizedCountries.merged > 0) {
        report(`[macro-calendar] 国家码归一：待归一 ${normalizedCountries.pending} 行、改名 `
          + `${normalizedCountries.renamed} 行、合并 ${normalizedCountries.merged} 行、台账改写 `
          + `${normalizedCountries.ledgerRewritten} 条`)
      }
      if (mergedPeriods.merged > 0 || mergedPeriods.renamed > 0) {
        report(`[macro-calendar] 期次归一：合并 ${mergedPeriods.merged} 行、改名 ${mergedPeriods.renamed} 行`
          + `、台账改写 ${mergedPeriods.ledgerRewritten} 条 / 删重 ${mergedPeriods.ledgerDropped} 条`)
      }
    } catch (error) {
      report(`[macro-calendar] 官方历史回放失败（已忽略，下次启动重试）：${(error as Error)?.message ?? 'unknown'}`)
    }
    // **这两步写在上一段的 `try` 之外**（2026-11-18）：那一整段是一条 try，中间任何一步抛错
    // （实测 `mergeCrossSourceCalendarRows` 在缺 `mi_macro_calendar_migrations` 的库上会抛）
    // 都会让后面的步骤**一条都不跑**，而异常被 catch 吞掉——「写了但不会跑」就是这么来的。
    // 转正与原因重算是读者能看见结果的那两步，必须有自己的一次机会。
    try {
      /**
       * **源内身份转正**（把算得出身份的 `identity_kind='source'` 行就地改码）与**未映射原因重算**。
       *
       * 这两步原来接在 narwhal 的采集回调里，而 narwhal 观测表 2026-11-14 起停写——**那个回调
       * 永远不会触发**，所以映射补了 700 多条、转正数一直是 0，读者那边照旧显示未映射。
       * 接到启动链上：每次启动先转正、再重算，顺序不能反（转正会删掉清单里的过期条目，
       * 先重算会把「已转正」算成缺码）。
       */
      const promotion = promoteSourceIdentities(database)
      if (promotion.scanned > 0) {
        report(`[macro-calendar] 源内身份转正：扫描 ${promotion.scanned} / 转正 ${promotion.promoted}`
          + ` / 仍无身份 ${promotion.stillSource}`)
      }
      const reasons = recomputeUnmappedReasons(database)
      if (reasons.scanned > 0) {
        report(`[macro-calendar] 未映射原因重算：扫描 ${reasons.scanned} 条、改写 ${reasons.updated} 条、`
          + `删除 ${reasons.deleted} 条、现状 ${JSON.stringify(reasons.counts)}`)
      }
    } catch (error) {
      report(`[macro-calendar] 转正/原因重算失败（已忽略，下次启动重试）：${(error as Error)?.message ?? 'unknown'}`)
    }
  } catch (error) {
    report(`[macro-calendar] 官方发布入标准表失败（已忽略）：${(error as Error)?.message ?? 'unknown'}`)
  }
  // 补值排在上面全部之后：同步、回放、状态对账都落完，欠账那批才按「这一期有没有官方观测」补。
  if (input.after !== undefined && input.readLatest !== undefined) {
    scheduleHistoricalValueFill({ database: input.database, after: input.after, readLatest: input.readLatest })
  }
}
