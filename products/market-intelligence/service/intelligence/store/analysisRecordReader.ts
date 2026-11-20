import type { DatabaseSync } from 'node:sqlite'

import type { AnalysisRun, AnalysisSummary } from '../../../contracts/marketAnalysisContracts'
import { analysisKindOf, type AnalysisKind } from '../../../contracts/analysisKinds'
import { fromRun, type StoredRow } from './marketAnalysisRepositoryRows'
import { createAnalysisFailedRunRepository } from './marketAnalysisFailedRunRepository'

/**
 * 读侧唯一的类别过滤入口（R39 §5）。
 *
 * 两张表（`mi_analysis_runs` / `mi_analysis_summaries`）的 `analysis_kind` 谓词只写在这个文件里：
 * 别处再写一遍 `where analysis_kind = ?`，就会出现第一处「读的时候忘了过滤」——新闻解读混进
 * 市场时间轴、冒充「最近一次尝试」，而这正是拆线的目的。
 *
 * 读侧的 `null → market` 只兜两类没有回填机会的行：旧归档还原回来的行、回退后由旧版写入的行。
 * 回填（迁移第 3 步）才是主路径。**写路径不调用这里**：新写入缺类别必须失败。
 *
 * 返回对象自带 `analysisKind`，但界面不得再判——每个面只调自己那一个函数。
 */
export type AnalysisRecord = Readonly<{
  run: AnalysisRun
  /** 这次运行产出的正文；跑失败或没产出时为 undefined。 */
  summary: AnalysisSummary | undefined
}>

export type AnalysisRecordReader = Readonly<{
  kindOf: (recordOrRow: Readonly<{ analysisKind?: unknown; analysis_kind?: unknown }> | null | undefined) => AnalysisKind
  listRuns: (input: Readonly<{ analysisKind: AnalysisKind; eventGroupId?: string; since?: string; limit?: number }>) => readonly AnalysisRun[]
  /**
   * 失败运行分页（读者要「失败页能看到所有失败」）。
   *
   * 与时间轴分页**分开**：时间轴游标是已发布行的 `(occurred_at, id)`，失败运行只能按
   * `mi_analysis_runs` 的 `(queued_at, id)`；混用会出现两种游标语义。这里的游标编码最后一行、
   * 无状态、可重放（同一游标重复调用返回同一页）。
   */
  listFailedRuns: (input: Readonly<{ analysisKind: AnalysisKind; cursor?: string | null; limit?: number }>) => Readonly<{ items: readonly AnalysisRun[]; nextCursor: string | null }>
  getRecordForRun: (input: Readonly<{ analysisKind: AnalysisKind; runId: string }>) => AnalysisRecord | undefined
  latestForItem: (input: Readonly<{ analysisKind: AnalysisKind; itemId: string }>) => AnalysisRecord | undefined
  latestAttempt: (input: Readonly<{ analysisKind: AnalysisKind }>) => AnalysisRun | undefined
}>

/**
 * One kind predicate over a run or summary table.
 *
 * Written as a pair of bound values instead of SQL `coalesce` on purpose: the column is the storage
 * fact, and `null` only means "written before the column existed" — which the market line owned for
 * every row of that era. A non-market kind never matches a null row.
 */
function kindWhere(table: string, analysisKind: AnalysisKind): readonly [string, readonly string[]] {
  return [
    `(${table}.analysis_kind = ? or (${table}.analysis_kind is null and ? = 'market'))`,
    [analysisKind, analysisKind]
  ]
}

function summaryFromRow(row: StoredRow): AnalysisSummary {
  const payload = JSON.parse(String(row.payload_json)) as AnalysisSummary
  // 列是存储事实；归档记录只有载荷里的字段，退回它；两者都没有才是旧的 market 行。
  return { ...payload, analysisKind: analysisKindOf({ ...payload, analysis_kind: row.analysis_kind }) }
}

export function createAnalysisRecordReader(database: DatabaseSync): AnalysisRecordReader {
  // 失败运行分页的实现抽在 `marketAnalysisFailedRunRepository`；类别谓词仍只在这里定义，
  // 作为函数传进去——全仓只有这一处写 `analysis_kind` 过滤。
  const failedRuns = createAnalysisFailedRunRepository(database, kindWhere)
  function recordForRun(runId: string): AnalysisRecord | undefined {
    const runRow = database.prepare('select * from mi_analysis_runs where id = ?').get(runId) as StoredRow | undefined
    if (!runRow) return undefined
    const summaryRow = database.prepare('select * from mi_analysis_summaries where analysis_run_id = ?').get(runId) as StoredRow | undefined
    return { run: fromRun(runRow), summary: summaryRow ? summaryFromRow(summaryRow) : undefined }
  }

  return {
    kindOf: analysisKindOf,

    listRuns(input) {
      const [kindClause, kindParameters] = kindWhere('mi_analysis_runs', input.analysisKind)
      const filters = [kindClause]
      const parameters: (string | number)[] = [...kindParameters]
      if (input.eventGroupId !== undefined) { filters.push('mi_analysis_runs.event_group_id = ?'); parameters.push(input.eventGroupId) }
      if (input.since !== undefined) { filters.push('mi_analysis_runs.queued_at >= ?'); parameters.push(input.since) }
      const limit = input.limit !== undefined ? ' limit ?' : ''
      if (input.limit !== undefined) parameters.push(input.limit)
      const rows = database.prepare(`select * from mi_analysis_runs where ${filters.join(' and ')} order by queued_at desc, id desc${limit}`).all(...parameters) as StoredRow[]
      return rows.map(fromRun)
    },

    getRecordForRun(input) {
      const [kindClause, kindParameters] = kindWhere('mi_analysis_runs', input.analysisKind)
      const run = database.prepare(`select id from mi_analysis_runs where ${kindClause} and id = ?`).get(...kindParameters, input.runId) as StoredRow | undefined
      // 不匹配是「没有」，不是错误：每个面拿不到自己的那条记录时就是空态，不该让页面报错。
      return run ? recordForRun(input.runId) : undefined
    },

    latestForItem(input) {
      const [kindClause, kindParameters] = kindWhere('mi_analysis_runs', input.analysisKind)
      // 匹配键是**原始 `itemId`**，不是带前缀的标识：`mi_analysis_event_groups.event_refs_json`
      // 存的是 `resolveChange` 里的 `change.eventRef = item.itemId`（`eventGroupService.create`
      // 写 `eventRefs: [change.eventRef]`，合并时追加同一个值）。`triggered-news:<itemId>` 只是
      // 冻结快照里 fact 的 `factId` 前缀，不在 `event_refs` 里；既有 R37 读法同样是
      // `eventRefs.includes(itemId)`。因此这里按 `json_each` 的键值精确匹配，不做前后缀匹配，
      // 否则 A 条目的抽屉会读出 B 条目的解读。
      // 沿用「每条新闻一个组」的既有做法，不给组加类别列；正文再按 run 取。
      const row = database.prepare(`select mi_analysis_runs.* from mi_analysis_runs join mi_analysis_event_groups on mi_analysis_event_groups.id = mi_analysis_runs.event_group_id
        where ${kindClause} and exists (select 1 from json_each(mi_analysis_event_groups.event_refs_json) as event_ref where event_ref.value = ?)
        order by mi_analysis_runs.queued_at desc, mi_analysis_runs.id desc limit 1`).get(...kindParameters, input.itemId) as StoredRow | undefined
      return row ? recordForRun(String(row.id)) : undefined
    },

    listFailedRuns: failedRuns.list,

    latestAttempt(input) {
      const [kindClause, kindParameters] = kindWhere('mi_analysis_runs', input.analysisKind)
      const row = database.prepare(`select * from mi_analysis_runs where ${kindClause} order by queued_at desc, id desc limit 1`).get(...kindParameters) as StoredRow | undefined
      return row ? fromRun(row) : undefined
    }
  }
}
