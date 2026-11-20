/**
 * 政策路径的「阶段」判定：会议前的倒计时、决出后的落定期、平时的常态。
 *
 * 2026-11-16 从 `policyPath.ts` 抽出来控体积（该文件曾 558 行）。**只搬不改**：
 * 纽约时钟、`decisionInstant`、`phaseAt` 与阈值常量原样搬，契约文件仍把它们转出，
 * 调用点一行未改。
 */
export type PolicyPathPhase =
  | Readonly<{ kind: 'normal' }>
  | Readonly<{ kind: 'pre-meeting'; daysLeft: number }>
  | Readonly<{ kind: 'settlement'; minutesSinceDecision: number }>
  | Readonly<{ kind: 'verdict'; daysSinceDecision: number }>

export const POLICY_PATH_PHASE_POLICY = Object.freeze({
  /** The block upgrades to the meeting view only inside this many days. */
  preMeetingDays: 14,
  /** The settlement strip stays up for a full day: readers look back the next morning. */
  settlementHours: 24,
  /** How long the verdict stays on the card before the next meeting's normal shape returns. */
  verdictDays: 3
} as const)

const MINUTE_MS = 60_000
const DAY_MS = 86_400_000

/**
 * New York's wall clock at an instant, expressed as the offset from UTC in milliseconds.
 *
 * This is looked up from the time zone database rather than assumed: 14:00 in New York is 18:00Z in
 * summer and 19:00Z in winter, and a fixed number would put a whole season's decisions an hour off.
 */
const newYorkClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
})

function newYorkOffsetMs(instantMs: number): number {
  const parts = Object.fromEntries(newYorkClock.formatToParts(new Date(instantMs)).map((part) => [part.type, part.value]))
  const wallClock = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  )
  return wallClock - instantMs
}

/** The decision instant: 14:00 on the meeting day in New York, converted to UTC exactly once. */
export function decisionInstant(meetingDate: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(meetingDate)
  if (!match) return undefined
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const wallClock = Date.UTC(year, month - 1, day, 14, 0, 0)
  // Date.UTC normalises 02-30 and 13-01 into the next month; a meeting date that does not survive
  // the round trip is not a date.
  const calendarDay = new Date(wallClock)
  if (calendarDay.getUTCFullYear() !== year || calendarDay.getUTCMonth() !== month - 1 || calendarDay.getUTCDate() !== day) return undefined
  // Two passes: the first guess lands on the right side of a DST change, the second settles the
  // offset that is actually in force at the converted instant.
  const firstGuess = wallClock - newYorkOffsetMs(wallClock)
  return new Date(wallClock - newYorkOffsetMs(firstGuess)).toISOString()
}

/**
 * Which shape the block takes at `now`. The boundaries belong to the later shape: exactly T0 is a
 * settlement, exactly T0+24h is a verdict, and exactly T0+3d is normal again.
 */
export function phaseAt(decisionAt: string, now: string): PolicyPathPhase {
  const decision = Date.parse(decisionAt)
  const current = Date.parse(now)
  if (!Number.isFinite(decision) || !Number.isFinite(current)) return { kind: 'normal' }
  const elapsed = current - decision
  if (elapsed < 0) {
    return -elapsed <= POLICY_PATH_PHASE_POLICY.preMeetingDays * DAY_MS
      ? { kind: 'pre-meeting', daysLeft: Math.ceil(-elapsed / DAY_MS) }
      : { kind: 'normal' }
  }
  if (elapsed < POLICY_PATH_PHASE_POLICY.settlementHours * 60 * MINUTE_MS) {
    return { kind: 'settlement', minutesSinceDecision: Math.floor(elapsed / MINUTE_MS) }
  }
  if (elapsed < POLICY_PATH_PHASE_POLICY.verdictDays * DAY_MS) {
    return { kind: 'verdict', daysSinceDecision: Math.floor(elapsed / DAY_MS) }
  }
  return { kind: 'normal' }
}

/** The band order the settlement conclusion reads: later entries are the tighter policy. */
