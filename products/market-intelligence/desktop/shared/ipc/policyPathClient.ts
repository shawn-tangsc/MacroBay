import {
  POLICY_PATH_OUTCOMES,
  type PolicyPathDistribution, type PolicyPathMarker, type PolicyPathOutcome, type PolicyPathPhase,
  type PolicyPathSettlement
} from '../../../contracts/policyPath'
import type { PolicyPathReading } from '../../../service/intelligence/policy-path/policyPathQueryService'
import { POLICY_PATH_IPC_METHODS } from '../../../service/intelligence/policy-path/ipc/registerPolicyPathIpc'

const productId = 'market-intelligence'

/**
 * 为什么这张卡没有读数。**四类不许压成一个词**：
 *
 * - `capability-not-wired`：没有 bridge（这份构建没接上读口）；读者做不了什么，不给按钮；
 * - `malformed`：这份构建读不懂这份数据（形状/版本不符）；重试一万次还是同一份，不给按钮；
 * - `meeting-not-found`：日历里没有下一场 FOMC 行；卡片要说「美联储日程还没有读到」并给一次真采集；
 * - `calendar-query-unavailable` / `query-input-invalid` / `query-failed`：这次读失败；前者与
 *   `query-failed` 是瞬时失败，给重试；`query-input-invalid` 是请求本身不合法，重试也没用。
 *
 * 「没有赔率」不是失败码：读数仍可用（会议日、区间、SEP、上次决议都在），只是 `reading.probability`
 * 缺席——`readReading` 允许它缺席，卡片照常画 `—`，别把它当 `malformed`。
 */
export const policyPathFailureCodes = [
  'capability-not-wired',
  'malformed',
  'meeting-not-found',
  'calendar-query-unavailable',
  'query-input-invalid',
  'query-failed'
] as const

export type PolicyPathFailureCode = typeof policyPathFailureCodes[number]

export type PolicyPathReadResult =
  | Readonly<{ state: 'available'; asOf: string; reading: PolicyPathReading }>
  | Readonly<{ state: 'unavailable'; failureCode: PolicyPathFailureCode }>

export const policyPathClient = {
  async read(asOf: string): Promise<PolicyPathReadResult> {
    const invoked = await invoke(POLICY_PATH_IPC_METHODS.read, { asOf })
    if (invoked.kind === 'unwired') return unavailable('capability-not-wired')
    if (invoked.kind === 'failed') return unavailable('query-failed')
    return sanitize(invoked.value)
  }
}

type Invoked =
  | Readonly<{ kind: 'ok'; value: unknown }>
  /** 没有 bridge：这份构建没接上读口，不是读者的错。 */
  | Readonly<{ kind: 'unwired' }>
  /** bridge 在、调用抛了：这次没读成，可以重试。 */
  | Readonly<{ kind: 'failed' }>

async function invoke(method: string, payload: unknown): Promise<Invoked> {
  try {
    if (!window.platform?.products?.invoke) return { kind: 'unwired' }
    return { kind: 'ok', value: await window.platform.products.invoke(productId, method, payload) }
  } catch {
    return { kind: 'failed' }
  }
}

/**
 * The renderer keeps only what it can render: a reading whose meeting date survives validation.
 * The four failure kinds stay apart; only an unknown code degrades to `malformed`.
 */
export function sanitize(value: unknown): PolicyPathReadResult {
  if (!isObject(value)) return unavailable('malformed')
  if (value.state === 'unavailable') {
    return isPolicyPathFailureCode(value.failureCode) ? unavailable(value.failureCode) : unavailable('malformed')
  }
  if (value.state !== 'available' || typeof value.asOf !== 'string') return unavailable('malformed')
  const reading = readReading(value.reading)
  return reading ? { state: 'available', asOf: value.asOf, reading } : unavailable('malformed')
}

export function isPolicyPathFailureCode(value: unknown): value is PolicyPathFailureCode {
  return typeof value === 'string' && (policyPathFailureCodes as readonly string[]).includes(value)
}

function readReading(value: unknown): PolicyPathReading | undefined {
  if (!isObject(value) || typeof value.meetingDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.meetingDate)) return undefined
  if (typeof value.daysUntilMeeting !== 'number' || typeof value.hasProjectionMaterials !== 'boolean') return undefined
  if (value.staleness !== 'live' && value.staleness !== 'delayed' && value.staleness !== 'stale' && value.staleness !== 'unavailable') return undefined
  const probability = isObject(value.probability) && typeof value.probability.value === 'number'
    && typeof value.probability.outcome === 'string'
    && (POLICY_PATH_OUTCOMES as readonly string[]).includes(value.probability.outcome)
    ? {
      ...value.probability,
      ...(isCompleteDistribution(value.probability.distribution)
        ? { distribution: value.probability.distribution as Record<string, number> }
        : {}),
      ...(isObject(value.probability.comparison) ? { comparison: readComparison(value.probability.comparison) } : {}),
      ...(typeof value.probability.marketUrl === 'string' && value.probability.marketUrl.startsWith('https://')
        ? { marketUrl: value.probability.marketUrl }
        : {})
    } as PolicyPathReading['probability']
    : undefined
  const lastDecision = readLastDecision(value.lastDecision)
  // `medianCurrentYear` is optional: a table whose year column is missing is still a valid SEP, and
  // requiring it here silently dropped the whole path.
  const sep = isObject(value.sep) && isObject(value.sep.medianPath) && typeof value.sep.sourceUrl === 'string'
    ? value.sep as NonNullable<PolicyPathReading['sep']>
    : undefined
  const markers = readMarkers(value.markers)
  const settlement = readSettlement(value.settlement)
  return {
    meetingDate: value.meetingDate,
    daysUntilMeeting: value.daysUntilMeeting,
    hasProjectionMaterials: value.hasProjectionMaterials,
    phase: readPhase(value.phase),
    ...(markers ? { markers } : {}),
    ...(settlement ? { settlement } : {}),
    ...(isObject(value.targetRange) ? { targetRange: value.targetRange as NonNullable<PolicyPathReading['targetRange']> } : {}),
    ...(lastDecision ? { lastDecision } : {}),
    ...(sep ? { sep } : {}),
    ...(probability ? { probability } : {}),
    staleness: value.staleness
  }
}

/**
 * The phase is derived on the service side so two machines cannot disagree about the time zone. A
 * payload that lost it (or carries a shape this build does not know) degrades to the normal block,
 * never to a broken one.
 */
function readPhase(value: unknown): PolicyPathPhase {
  if (!isObject(value)) return { kind: 'normal' }
  if (value.kind === 'pre-meeting' && isFiniteNumber(value.daysLeft)) return { kind: 'pre-meeting', daysLeft: value.daysLeft }
  if (value.kind === 'settlement' && isFiniteNumber(value.minutesSinceDecision)) {
    return { kind: 'settlement', minutesSinceDecision: value.minutesSinceDecision }
  }
  if (value.kind === 'verdict' && isFiniteNumber(value.daysSinceDecision)) {
    return { kind: 'verdict', daysSinceDecision: value.daysSinceDecision }
  }
  return { kind: 'normal' }
}

/** A marker the card cannot name is dropped rather than rendered as an empty chip. */
function readMarkers(value: unknown): readonly PolicyPathMarker[] | undefined {
  if (!Array.isArray(value)) return undefined
  const markers = value.flatMap((entry): PolicyPathMarker[] => {
    if (!isObject(entry) || !isFiniteNumber(entry.changeInPp)) return []
    if (entry.kind !== 'repricing' && entry.kind !== 'intraday') return []
    if (entry.level !== 'strong' && entry.level !== 'normal') return []
    return [{ kind: entry.kind, level: entry.level, changeInPp: entry.changeInPp }]
  })
  return markers.length ? markers : undefined
}

/**
 * The settlement strip is arithmetic about the market, so only its two shapes are accepted: a
 * priced/relative conclusion with its numbers, or the named reason the conclusion is absent.
 */
function readSettlement(value: unknown): PolicyPathSettlement | undefined {
  if (!isObject(value) || typeof value.decidedMeetingDate !== 'string') return undefined
  if (!isOutcome(value.actualOutcome)) return undefined
  const conclusion = readConclusion(value.conclusion)
  if (!conclusion) return undefined
  const previousTargetRange = readRange(value.previousTargetRange)
  const priced = isFiniteNumber(value.priced) && value.priced >= 0 && value.priced <= 1 ? value.priced : undefined
  const pricedOutcome = isOutcome(value.pricedOutcome) ? value.pricedOutcome : undefined
  const pricedDistribution = readDistribution(value.pricedDistribution)
  const nextMeeting = readNextMeeting(value.nextMeeting)
  const pricingBasis = value.pricingBasis === 'post-decision' ? 'post-decision' as const : 'pre-decision' as const
  const pricedHoursAfter = typeof value.pricedHoursAfter === 'number' && Number.isFinite(value.pricedHoursAfter) && value.pricedHoursAfter >= 0
    ? Math.round(value.pricedHoursAfter)
    : undefined
  return {
    decidedMeetingDate: value.decidedMeetingDate,
    pricingBasis,
    ...(pricedHoursAfter === undefined ? {} : { pricedHoursAfter }),
    ...(previousTargetRange ? { previousTargetRange } : {}),
    actualOutcome: value.actualOutcome,
    ...(priced === undefined ? {} : { priced }),
    ...(pricedOutcome ? { pricedOutcome } : {}),
    ...(pricedDistribution ? { pricedDistribution } : {}),
    conclusion,
    ...(nextMeeting ? { nextMeeting } : {})
  }
}

function readConclusion(value: unknown): PolicyPathSettlement['conclusion'] | undefined {
  if (!isObject(value)) return undefined
  if (value.kind === 'priced') return { kind: 'priced' }
  if (value.kind === 'unavailable' && value.reason === 'settlement-pricing-unavailable') {
    return { kind: 'unavailable', reason: 'settlement-pricing-unavailable' }
  }
  if (value.kind === 'relative' && (value.direction === 'hawkish' || value.direction === 'dovish') && isFiniteNumber(value.surprisePp)) {
    return { kind: 'relative', direction: value.direction, surprisePp: value.surprisePp }
  }
  return undefined
}

function readNextMeeting(value: unknown): NonNullable<PolicyPathSettlement['nextMeeting']> | undefined {
  if (!isObject(value) || typeof value.meetingDate !== 'string' || !isFiniteNumber(value.daysUntil)) return undefined
  return { meetingDate: value.meetingDate, daysUntil: value.daysUntil }
}

function readRange(value: unknown): Readonly<{ lowerPercent: number; upperPercent: number }> | undefined {
  if (!isObject(value) || !isFiniteNumber(value.lowerPercent) || !isFiniteNumber(value.upperPercent)) return undefined
  return { lowerPercent: value.lowerPercent, upperPercent: value.upperPercent }
}

function readDistribution(value: unknown): PolicyPathDistribution | undefined {
  if (!isObject(value)) return undefined
  const entries = POLICY_PATH_OUTCOMES.map((outcome) => [outcome, value[outcome]] as const)
  if (!entries.every(([, share]) => isFiniteNumber(share) && share >= 0 && share <= 1)) return undefined
  const total = entries.reduce((sum, [, share]) => sum + (share as number), 0)
  return Math.abs(total - 1) <= 0.01
    ? Object.fromEntries(entries) as PolicyPathDistribution
    : undefined
}

function isOutcome(value: unknown): value is PolicyPathOutcome {
  return typeof value === 'string' && (POLICY_PATH_OUTCOMES as readonly string[]).includes(value)
}

/** The vote is the only part of the previous decision the row draws; anything else is dropped. */
function readLastDecision(value: unknown): PolicyPathReading['lastDecision'] | undefined {
  if (!isObject(value)) return undefined
  const vote = isObject(value.vote) && typeof value.vote.for === 'number' && typeof value.vote.against === 'number'
    ? { for: value.vote.for, against: value.vote.against }
    : undefined
  if (!vote) return undefined
  const dissents = Array.isArray(value.dissents)
    ? value.dissents.flatMap((entry) => {
      if (!isObject(entry) || typeof entry.name !== 'string') return []
      const preferred = entry.preferred
      if (preferred !== 'raise' && preferred !== 'lower' && preferred !== 'maintain') return []
      return [{ name: entry.name, preferred: preferred as 'raise' | 'lower' | 'maintain' }]
    }).slice(0, 12)
    : undefined
  const outcome = typeof value.outcome === 'string' && (POLICY_PATH_OUTCOMES as readonly string[]).includes(value.outcome)
    ? value.outcome as (typeof POLICY_PATH_OUTCOMES)[number]
    : undefined
  return {
    vote,
    ...(outcome ? { outcome } : {}),
    ...(dissents?.length ? { dissents } : {}),
    ...(typeof value.statementUrl === 'string' && value.statementUrl.startsWith('https://') ? { statementUrl: value.statementUrl } : {})
  }
}

function readComparison(value: Record<string, unknown>): NonNullable<NonNullable<PolicyPathReading['probability']>['comparison']> {
  return {
    ...(isCompleteDistribution(value.day) ? { day: value.day as never } : {}),
    ...(isCompleteDistribution(value.week) ? { week: value.week as never } : {})
  }
}

function isCompleteDistribution(value: unknown): boolean {
  if (!isObject(value)) return false
  return POLICY_PATH_OUTCOMES.every((outcome) => typeof value[outcome] === 'number' && Number.isFinite(value[outcome]))
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function unavailable(failureCode: PolicyPathFailureCode): PolicyPathReadResult {
  return { state: 'unavailable', failureCode }
}
