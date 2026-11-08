/**
 * 免打扰「在不在窗口里」的**唯一判定**（验收 S6）。
 *
 * 现在的调用点：本机表面的路由（`notificationRouting.ts`，决定提示/桌面弹不弹）。
 * 手机那一档要不要在免打扰里也静音，是**还没拍板**的一件事（验收 S6 与现行为不一致），
 * 拍板后 `notificationSubmitPlan.ts` 会调同一个函数——两处各写一遍判断，就会出现
 * 「本机静音了、手机还响」这种半静音。
 *
 * 三种结果，`unknown` 不许折成 `outside`：前者是「拿不到现在几点」，后者是「拿得到，且不在窗口内」。
 * 时区用不了时**不做判定**，宁可多响一次，也不在错的钟点把提醒静音掉（S6 原话）。
 */
import { minutesOfDayInTimeZone } from '../../time/timeZoneClock'
import type { NotificationRuntimeSettings } from '../contracts/notificationContracts'

export type QuietHoursVerdict = 'inside' | 'outside' | 'unknown'

/**
 * 一次提交只算**一次**免打扰决定，规划器算完传给投递路由（2026-11-08，Chief 定）。
 *
 * 两处各判的后果是「一处放过手机、另一处筛掉桌面，回执却说桌面没到」——那是假事实。
 * `bypassed` 只给「读者亲手点的诊断 + 已批穿透 + 测试命名空间」这一种情况。
 */
export type QuietHoursDecision = Readonly<{ inside: boolean; bypassed: boolean }>

export function quietHoursVerdict(
  quietHours: NonNullable<NotificationRuntimeSettings['quietHours']>,
  clock: { now: () => Date; timeZone: () => string }
): QuietHoursVerdict {
  // 按设置的**读者时区**判断，不按运行这台机器的本地时间。
  const currentMinutes = minutesOfDayInTimeZone(clock.now(), clock.timeZone())
  if (currentMinutes === null) return 'unknown'
  const start = parseLocalMinutes(quietHours.startLocalTime)
  const end = parseLocalMinutes(quietHours.endLocalTime)
  // 起止相同＝窗口为空，不是「一整天」：把 `22:00–22:00` 读成一整天是反直觉的陷阱。
  if (start === end) return 'outside'
  const inside = start < end
    ? currentMinutes >= start && currentMinutes < end
    : currentMinutes >= start || currentMinutes < end
  return inside ? 'inside' : 'outside'
}

/** 窗口内吗？只有**确定在窗口内**才算（`unknown` 不静音）。 */
export function isInsideQuietHours(
  settings: NotificationRuntimeSettings,
  clock: { now: () => Date; timeZone: () => string }
): boolean {
  if (settings.quietHours?.enabled !== true) return false
  return quietHoursVerdict(settings.quietHours, clock) === 'inside'
}

function parseLocalMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map((part) => Number.parseInt(part, 10))
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0
  return hours * 60 + minutes
}
