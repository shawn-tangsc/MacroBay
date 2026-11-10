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
 * 五态 → 药丸上的那句话。**唯一一处映射**：判在 `sourceProjection.sourceHealthState`，
 * 词与色都在这里对上，调用点不再各自拼 `runtimeStatus`/失败数。
 *
 * `off` 不给词：它同时盖住「没启用」「已启用但取不到」「没有健康读数」三种处境，写成
 * 「已关闭」会把「没有读数」说成读者的动作。取不到的那一种另有一句话（行内「不可用」）。
 */
export const HEALTH_STATE_LABEL_KEYS: Readonly<Record<Exclude<SourceHealthState, 'off'>, string>> = Object.freeze({
  healthy: 'settings.intelligenceSources.health.statuses.healthy',
  'repeated-failures': 'settings.intelligenceSources.health.statuses.multiple-failures',
  stale: 'settings.intelligenceSources.health.statuses.data-stale',
  failed: 'settings.intelligenceSources.health.statuses.failed'
})

/** 一行药丸要的两个东西：词键 + 色调。`off` 返回 `undefined`（不画药丸）。 */
export function healthStateBadge(state: SourceHealthState): Readonly<{ labelKey: string; tone: SourceHealthTone }> | undefined {
  if (state === 'off') return undefined
  return { labelKey: HEALTH_STATE_LABEL_KEYS[state], tone: sourceHealthTone(state) }
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
