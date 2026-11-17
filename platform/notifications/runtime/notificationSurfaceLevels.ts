import type { NotificationApprovedLevel } from '../contracts/notificationEventCatalog'
import type { NotificationSurfaceDecision } from './notificationSurfaceDecision'

/**
 * 生效表面与**按次收窄**放一处：两者回答的其实是同一个问题——「这一次到底排哪几档」。
 *
 * 从 `notificationSubmitPlan.ts` 抽出来是因为那个文件已经顶到 500 行硬线，而这段增长的理由
 * （档位规则）与记录构造无关。行为零改动。
 */
export function effectiveLevels(
  /** 三面判定结果（`decideNotificationSurfaces`）：批准 ∩ 开关 ∩ 选择已经算完。 */
  surfaces: NotificationSurfaceDecision,
  /** 免打扰之外才排手机：窗口内只进中心（S6），不是本机开关的事。 */
  channelAllowed: boolean
): readonly NotificationApprovedLevel[] {
  // center 不是无条件注入的那一行：它是批准档之一，批准表没写就不进中心。
  const levels: NotificationApprovedLevel[] = surfaces.center ? ['center'] : []
  if (surfaces.desktop) levels.push('desktop')
  if (surfaces.toast) levels.push('toast')
  if (channelAllowed && surfaces.channel) levels.push('channel')
  return Object.freeze(levels)
}

export type SurfaceNarrowing =
  | { ok: true; levels: readonly NotificationApprovedLevel[] }
  /** 收窄里出现了批准表没批的档位：**拒收**，不静默求交（那会让生产者以为那一档发出去了）。 */
  | { ok: false; unapproved: readonly NotificationApprovedLevel[] }

/**
 * 按次收窄：只能**变少**，不能**变出**。`center` 与其余档一样可以被收窄掉——
 * 它是批准档之一（记录面），不是必达记录。
 *
 * 所以 `['channel']` 的含义就是「channel」这一档；要不要进中心只看批准表有没有 center。
 */
export function applySurfaceNarrowing(
  approved: readonly NotificationApprovedLevel[],
  narrowed: readonly NotificationApprovedLevel[] | undefined
): SurfaceNarrowing {
  if (narrowed === undefined) return { ok: true, levels: approved }
  const unapproved = narrowed.filter((level) => !approved.includes(level))
  if (unapproved.length > 0) return { ok: false, unapproved }
  return { ok: true, levels: approved.filter((level) => narrowed.includes(level)) }
}
