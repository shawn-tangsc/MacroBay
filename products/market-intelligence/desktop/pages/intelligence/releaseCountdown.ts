/**
 * 距下一次发布的显示形态——**按发布时刻的精度分**，不凭空造时间。
 *
 * 用户 2026-11-14 定的三条（不再讨论）：
 * - 超过 24 小时：只给整数天（`20 天后`）；
 * - 24 小时内：倒计时（`还有 12 小时 40 分`），最后 1 小时只到分（`还有 42 分`）；
 * - **只有日期、源没给时刻**：只给天数（`3 天后`），**不做倒计时**——那一刻几点我们不知道，
 *   编一个就是假数据（日期型事件的那条 `00:00` 是占位，不是时刻）。
 *
 * 这里只出形态与数字，一句文案都不写：文案由调用方按键装配，中英各一份。
 */
export type ReleaseCountdown =
  | Readonly<{ kind: 'days'; days: number }>
  | Readonly<{ kind: 'countdown'; hours: number; minutes: number }>
  | Readonly<{ kind: 'imminent'; minutes: number }>
  | Readonly<{ kind: 'past' }>

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/**
 * 只有日期的那一档：按**显示日期**做日历日差，不按 24 小时算。
 * 传进来的日期必须是调用方用读者时区格式化好的 `YYYY-MM-DD`——这里不猜时区。
 */
export function countdownForDate(input: Readonly<{ nowDate: string; releaseDate: string }>): ReleaseCountdown {
  const now = Date.parse(`${input.nowDate}T00:00:00.000Z`)
  const release = Date.parse(`${input.releaseDate}T00:00:00.000Z`)
  if (!Number.isFinite(now) || !Number.isFinite(release) || release < now) return { kind: 'past' }
  return { kind: 'days', days: Math.round((release - now) / DAY_MS) }
}

/**
 * 有时刻的那一档。`now` 与 `releaseAt` 都是规范 UTC 时刻。
 *
 * 取整一律向上：倒计时不许显示「还有 0 分」——那会让读者以为已经发布了。
 */
export function countdownForInstant(input: Readonly<{ now: string; releaseAt: string }>): ReleaseCountdown {
  const now = Date.parse(input.now)
  const release = Date.parse(input.releaseAt)
  if (!Number.isFinite(now) || !Number.isFinite(release)) return { kind: 'past' }
  const remaining = release - now
  if (remaining < 0) return { kind: 'past' }
  if (remaining < HOUR_MS) return { kind: 'imminent', minutes: Math.max(1, Math.ceil(remaining / MINUTE_MS)) }
  if (remaining < DAY_MS) {
    const totalMinutes = Math.ceil(remaining / MINUTE_MS)
    return { kind: 'countdown', hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 }
  }
  return { kind: 'days', days: Math.floor(remaining / DAY_MS) }
}

/**
 * 一条排期该用哪一种：**精度说了算**，不是有没有时刻。
 *
 * `timePrecision` 缺省按「只有日期」处理（旧投影不产出这个字段，宁可不倒计时而不要编时刻）。
 */
export function releaseCountdownFor(input: Readonly<{
  now: string
  nowDate: string
  releaseAt: string
  releaseDate: string
  timePrecision?: 'minute' | 'date'
}>): ReleaseCountdown {
  return input.timePrecision === 'minute'
    ? countdownForInstant({ now: input.now, releaseAt: input.releaseAt })
    : countdownForDate({ nowDate: input.nowDate, releaseDate: input.releaseDate })
}
