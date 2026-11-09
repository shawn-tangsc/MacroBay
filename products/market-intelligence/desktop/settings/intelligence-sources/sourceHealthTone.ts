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
import type { SourceHealthState } from '../../../service/intelligence/application/sourceProjection'

export type SourceHealthTone = 'muted' | 'warn' | 'bad' | 'ok'

export function sourceHealthTone(state: SourceHealthState): SourceHealthTone {
  if (state === 'healthy') return 'ok'
  if (state === 'failed' || state === 'repeated-failures') return 'bad'
  if (state === 'stale') return 'warn'
  return 'muted'
}

/**
 * 目录标记的**唯一判据**（界面设计 2026-11-10 终稿）：形状 + 颜色双编码，灰度屏也分得清。
 *
 * - `bad` → 实心红；`warn` → 实心黄；
 * - `muted` → **空心环**，但**只在「已启用且该源判定不可用」时**画：`muted` 同时盖着
 *   「未启用 / 没数据」，那两个什么都不画，所以画不画不能只看 tone；
 * - `ok` → 什么都不画（常驻的绿点会被读成选中标记）。
 */
export type CatalogMarker = 'bad' | 'warn' | 'muted'

export function catalogMarkerKind(state: SourceHealthState, hasUnavailableEnabled: boolean): CatalogMarker | undefined {
  const tone = sourceHealthTone(state)
  if (tone === 'bad' || tone === 'warn') return tone
  return tone === 'muted' && hasUnavailableEnabled ? 'muted' : undefined
}
