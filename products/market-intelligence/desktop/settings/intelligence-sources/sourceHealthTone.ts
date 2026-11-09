/**
 * 五态 → 色调。**只做映射，不再判健康**（判在 `sourceProjection.sourceHealthState`，一处）。
 *
 * 为什么必须共用一份：来源详情行、抽屉目录点、设置页左树都要表达同一个事实；三处各写一段判断，
 * 迟早出现「目录点亮着、详情行说不可用」。
 *
 * 判据（界面设计 2026-11-09 定，2026-11-10 收成映射）：
 * - 绿只给 `healthy`；红只给 `failed` / `repeated-failures`（这次失败、能修）；
 * - 黄只给 `stale`（数据偏旧）；
 * - `off`（没启用 / 取不到 / 没有健康读数）→ 灰。**「不可用」与「没有数据」都不画红。**
 */
import type { SourceHealthMarker, SourceHealthState } from '../../../service/intelligence/application/sourceProjection'

export type SourceHealthTone = 'muted' | 'warn' | 'bad' | 'ok'

export function sourceHealthTone(state: SourceHealthState): SourceHealthTone {
  if (state === 'healthy') return 'ok'
  if (state === 'failed' || state === 'repeated-failures') return 'bad'
  if (state === 'stale') return 'warn'
  return 'muted'
}

/**
 * 标记档 → CSS 类。**纯映射**（架构师 2026-11-10）：判据在 `sourceProjection.sourceHealthMarker`，
 * 这里不接收第二个输入、不再看 `enabled`/`unavailable`。
 */
export function catalogMarkerClass(marker: SourceHealthMarker): 'is-bad' | 'is-warn' | 'is-muted' | undefined {
  if (marker === 'bad') return 'is-bad'
  if (marker === 'warn') return 'is-warn'
  if (marker === 'ring') return 'is-muted'
  return undefined
}
