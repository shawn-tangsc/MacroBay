import { dailyBriefingPolicy } from './dailyBriefing/policies'

/**
 * 手动生成的时间窗（用户 2026-11-06）：**今天往前 3 天内**，含今天；未来一律不许。
 *
 * 三个入口（手动生成弹框、历史缺版页的重试、对已有这一版的重跑）与服务端校验**共用这一个判定**：
 * 界面挡一次、服务端再挡一次，理由都是"每次生成都是一次模型调用"。日期按**读者设置时区的今天**
 * 算（与"今天"同源），不许用 UTC，也不许用机器本地时间。
 */
export const dailyBriefingManualGenerationWindowDays = dailyBriefingPolicy.manualGenerationWindowDays

/** `YYYY-MM-DD` 往前/往后挪天数（纯日期串运算，不经过时区）。 */
function shiftDate(date: string, days: number): string | undefined {
  const at = Date.parse(`${date}T00:00:00.000Z`)
  if (!Number.isFinite(at)) return undefined
  return new Date(at + days * 86_400_000).toISOString().slice(0, 10)
}

/** 窗口的最早一天（含）。今天本身也算在内，所以是往前 3 天。 */
export function earliestManualGenerationDate(today: string): string {
  return shiftDate(today, -dailyBriefingManualGenerationWindowDays) ?? today
}

/** 这一天能不能手动生成：不晚于今天、不早于今天往前 3 天。 */
export function isManualGenerationDateAllowed(date: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return false
  return date <= today && date >= earliestManualGenerationDate(today)
}
