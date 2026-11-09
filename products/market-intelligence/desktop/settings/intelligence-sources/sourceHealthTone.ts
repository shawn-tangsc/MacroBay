/**
 * 一个源的**健康色调**：只有这一处决定「亮不亮、亮什么色」。
 *
 * 为什么必须共用一份：来源详情行、左栏目录点都要表达同一个事实。两处各写一段判断，
 * 迟早出现「抽屉点亮、详情行说不可用」——今天反复吃的就是这种「同一事实两处实现」。
 *
 * 判据（界面设计 2026-11-09 定）：
 * - **绿只给「已连通且新鲜」**：启用、可用、健康数据说 healthy；
 * - **红只给「这次失败、能修」**：健康数据说 failed，或连续失败到阈值；
 * - **不可用 → muted**（它是「现在取不到」，不是「失败」，别用红吓人）；
 * - 没启用、或没有健康数据 → muted。**「没有数据」不等于「健康」**。
 */
import { SOURCE_REPEATED_FAILURE_THRESHOLD } from '../../../service/intelligence/application/sourceProjection'

export type SourceHealthTone = 'muted' | 'warn' | 'bad' | 'ok'

export type SourceHealthInput = {
  enabled: boolean
  unavailable: boolean
  health?: Readonly<{ runtimeStatus: 'healthy' | 'degraded' | 'failed' | 'paused'; consecutiveFailures?: number }>
}

export function sourceHealthTone({ enabled, unavailable, health }: SourceHealthInput): SourceHealthTone {
  if (!enabled) return 'muted'
  if (unavailable) return 'muted'
  if (!health) return 'muted'
  if (health.runtimeStatus === 'healthy') return 'ok'
  if (health.runtimeStatus === 'failed') return 'bad'
  if (health.runtimeStatus === 'paused') return 'muted'
  return (health.consecutiveFailures ?? 0) >= SOURCE_REPEATED_FAILURE_THRESHOLD ? 'bad' : 'warn'
}
