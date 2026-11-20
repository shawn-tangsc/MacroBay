import type { DatabaseSync } from 'node:sqlite'

import type { AnalysisRun } from '../../../contracts/marketAnalysisContracts'
import type { AnalysisKind } from '../../../contracts/analysisKinds'
import { marketAnalysisTimelineLimits } from '../../../contracts/marketAnalysisTimelineLimits'
import { fromRun, type StoredRow } from './marketAnalysisRepositoryRows'

/**
 * 失败运行分页（读者要「失败页能看到所有失败」）。
 *
 * 与时间轴分页**分开**：时间轴游标是已发布行的 `(occurred_at, id)`，失败运行只能按
 * `mi_analysis_runs` 的 `(queued_at, id)`；混用会出现两种游标语义。这里的游标编码最后一行、
 * **无状态、可重放**（同一游标重复调用返回同一页）；解不开的游标是边界错误，绝不静默从第一页
 * 重来——那会让「加载更多」无限循环。
 *
 * 类别谓词不在这里定义：调用方把 `analysisRecordReader` 的唯一一份谓词传进来，保证全仓
 * 只有一处写 `analysis_kind` 过滤。
 */
export type AnalysisKindClause = (table: string, analysisKind: AnalysisKind) => readonly [string, readonly string[]]

export type AnalysisFailedRunPage = Readonly<{ items: readonly AnalysisRun[]; nextCursor: string | null }>

/** 失败运行分页的游标：最后一行 `(queued_at, id)` 的 base64url 编码。 */
function encodeRunCursor(run: Readonly<{ queuedAt: string; id: string }>): string {
  return Buffer.from(JSON.stringify([run.queuedAt, run.id]), 'utf8').toString('base64url')
}

function decodeRunCursor(cursor: string): Readonly<{ queuedAt: string; id: string }> {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown
    if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') throw new Error('bad cursor')
    return { queuedAt: parsed[0], id: parsed[1] }
  } catch {
    // 边界错误：调用方拿到的是一句可诊断的拒绝，而不是「悄悄回到第一页」。
    throw new Error('analysis-invalid-cursor')
  }
}

export function createAnalysisFailedRunRepository(
  database: DatabaseSync,
  kindWhere: AnalysisKindClause
): Readonly<{ list: (input: Readonly<{ analysisKind: AnalysisKind; cursor?: string | null; limit?: number }>) => AnalysisFailedRunPage }> {
  return {
    list(input) {
      // 页大小与时间轴同一档（50），不新增上限；渲染侧一页只认 70，50 条一定收得下。
      const limit = Number.isSafeInteger(input.limit)
        ? Math.max(1, Math.min(marketAnalysisTimelineLimits.pageItems, input.limit!))
        : marketAnalysisTimelineLimits.pageItems
      const [kindClause, kindParameters] = kindWhere('mi_analysis_runs', input.analysisKind)
      const position = input.cursor ? decodeRunCursor(input.cursor) : undefined
      const filters = [kindClause, "status in ('failed','invalid-output','cancelled')"]
      const parameters: (string | number)[] = [...kindParameters]
      if (position) {
        filters.push('(queued_at < ? or (queued_at = ? and id < ?))')
        parameters.push(position.queuedAt, position.queuedAt, position.id)
      }
      parameters.push(limit + 1)
      const rows = database.prepare(`select * from mi_analysis_runs where ${filters.join(' and ')} order by queued_at desc, id desc limit ?`).all(...parameters) as StoredRow[]
      const items = rows.slice(0, limit).map(fromRun)
      const last = items.at(-1)
      return {
        items,
        nextCursor: rows.length > limit && last ? encodeRunCursor({ queuedAt: last.queuedAt, id: last.id }) : null
      }
    }
  }
}
