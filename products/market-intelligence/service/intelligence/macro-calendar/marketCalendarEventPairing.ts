/**
 * 事件型跨源配对：**同一件事只出一行，出 Narwhal 那一行**。
 *
 * 身份仍是 `(国家, 类型, 时刻)`；这里判的是「这两行说的是不是同一件事」，两个判据：
 * - 两边都有时刻：同国家 + 同类型 + 时刻相差 ≤ 60 分钟；
 * - 旧源只有日期（`T00:00:00.000Z`）：放宽到同一 UTC 日，但**只在该日该国家该类型只有
 *   一条候选**时才配；两条以上不配、都显示，并计数。
 *
 * 名字一律不参与：标题在两家写法不同，拿它当判据就是拿名字当身份。
 */

export const eventPairingWindowMs = 60 * 60 * 1_000

export type EventPairVerdict = 'covered-by-narwhal' | 'keep-old' | 'ambiguous-day'

export function isDateLevelInstant(scheduledAt: string): boolean {
  return scheduledAt.endsWith('T00:00:00.000Z')
}

export function eventPairVerdict(input: Readonly<{
  /** 这一行的发布时刻（规范 ISO）。 */
  scheduledAt: string
  /** 同国家同类型的 Narwhal 时刻。 */
  narwhalInstants: readonly string[]
  /** 这一行若只有日期：该日该国家该类型旧源的候选条数。 */
  dateLevelCandidateCount: number
}>): EventPairVerdict {
  const { scheduledAt, narwhalInstants, dateLevelCandidateCount } = input
  if (narwhalInstants.length === 0) return 'keep-old'
  if (!isDateLevelInstant(scheduledAt)) {
    const at = Date.parse(scheduledAt)
    const covered = narwhalInstants.some((instant) => Math.abs(Date.parse(instant) - at) <= eventPairingWindowMs)
    return covered ? 'covered-by-narwhal' : 'keep-old'
  }
  const day = scheduledAt.slice(0, 10)
  const sameDay = narwhalInstants.some((instant) => instant.slice(0, 10) === day)
  if (!sameDay) return 'keep-old'
  // 日期级放宽必须靠「唯一候选」兜住，否则会把同一天两场讲话并成一场。
  if (dateLevelCandidateCount > 1) return 'ambiguous-day'
  return dateLevelCandidateCount === 1 ? 'covered-by-narwhal' : 'keep-old'
}
