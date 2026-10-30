import type { PolicyPathReading } from '../../../service/intelligence/policy-path/policyPathQueryService'
import { POLICY_PATH_IPC_METHODS } from '../../../service/intelligence/policy-path/ipc/registerPolicyPathIpc'

const productId = 'market-intelligence'

export type PolicyPathReadResult =
  | Readonly<{ state: 'available'; asOf: string; reading: PolicyPathReading }>
  | Readonly<{ state: 'unavailable'; failureCode: string }>

export const policyPathClient = {
  async read(asOf: string): Promise<PolicyPathReadResult> {
    const value = await invoke(POLICY_PATH_IPC_METHODS.read, { asOf })
    return sanitize(value)
  }
}

async function invoke(method: string, payload: unknown): Promise<unknown> {
  try {
    if (!window.platform?.products?.invoke) return undefined
    return await window.platform.products.invoke(productId, method, payload)
  } catch {
    return undefined
  }
}

/**
 * The renderer keeps only what it can render: a reading whose meeting date and probability shape
 * survive validation. Anything else becomes `unavailable`, never a half-filled block.
 */
export function sanitize(value: unknown): PolicyPathReadResult {
  if (!isObject(value)) return unavailable('malformed')
  if (value.state === 'unavailable') return unavailable('unavailable')
  if (value.state !== 'available' || typeof value.asOf !== 'string') return unavailable('malformed')
  const reading = readReading(value.reading)
  return reading ? { state: 'available', asOf: value.asOf, reading } : unavailable('malformed')
}

function readReading(value: unknown): PolicyPathReading | undefined {
  if (!isObject(value) || typeof value.meetingDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.meetingDate)) return undefined
  if (typeof value.daysUntilMeeting !== 'number' || typeof value.hasProjectionMaterials !== 'boolean') return undefined
  if (value.staleness !== 'live' && value.staleness !== 'delayed' && value.staleness !== 'stale' && value.staleness !== 'unavailable') return undefined
  const probability = isObject(value.probability) && typeof value.probability.value === 'number'
    ? { ...value.probability } as PolicyPathReading['probability']
    : undefined
  const lastDecision = readLastDecision(value.lastDecision)
  const sep = isObject(value.sep) && typeof value.sep.medianCurrentYear === 'number' && typeof value.sep.sourceUrl === 'string'
    ? value.sep as NonNullable<PolicyPathReading['sep']>
    : undefined
  return {
    meetingDate: value.meetingDate,
    daysUntilMeeting: value.daysUntilMeeting,
    hasProjectionMaterials: value.hasProjectionMaterials,
    ...(isObject(value.targetRange) ? { targetRange: value.targetRange as NonNullable<PolicyPathReading['targetRange']> } : {}),
    ...(lastDecision ? { lastDecision } : {}),
    ...(sep ? { sep } : {}),
    ...(probability ? { probability } : {}),
    staleness: value.staleness
  }
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
  return {
    vote,
    ...(dissents?.length ? { dissents } : {}),
    ...(typeof value.statementUrl === 'string' && value.statementUrl.startsWith('https://') ? { statementUrl: value.statementUrl } : {})
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function unavailable(failureCode: string): PolicyPathReadResult {
  return { state: 'unavailable', failureCode }
}
