import {
  capitalConditionsSnapshotPolicy,
  isValidCapitalConditionsDailyFlows,
  isCanonicalCapitalConditionsSnapshotTime,
  isVisibleEtfPublicSnapshot,
  isWithinCapitalConditionsSnapshotDtoBudget,
  toEtfPublicSnapshot,
  type CapitalConditionsSnapshotQueryInput,
  type CapitalConditionsSnapshotResult
} from '../../../contracts/intelligenceQueryContracts'
import { INTELLIGENCE_PUBLIC_QUERY_METHODS } from '../../../contracts/intelligencePublicQueryMethods'

const PRODUCT_ID = 'market-intelligence'

export type IntelligenceCapitalConditionsClient = {
  querySnapshot: (input: CapitalConditionsSnapshotQueryInput) => Promise<CapitalConditionsSnapshotResult>
}

export const intelligenceCapitalConditionsClient: IntelligenceCapitalConditionsClient = {
  async querySnapshot(input) {
    try {
      if (!isInput(input)) return unavailable()
      return sanitize(await window.platform?.products?.invoke(PRODUCT_ID, INTELLIGENCE_PUBLIC_QUERY_METHODS.queryCapitalConditionsSnapshot, { asOf: input.asOf }), input)
    } catch {
      return unavailable()
    }
  }
}

function isInput(value: unknown): value is CapitalConditionsSnapshotQueryInput {
  return isExactRecord(value, ['asOf']) && isCanonicalCapitalConditionsSnapshotTime(value.asOf)
}

function sanitize(value: unknown, input: CapitalConditionsSnapshotQueryInput): CapitalConditionsSnapshotResult {
  if (isExactRecord(value, ['state', 'asOf']) && value.state === 'empty' && value.asOf === input.asOf) return Object.freeze({ state: 'empty', asOf: input.asOf })
  if (isExactRecord(value, ['state', 'failureCode']) && value.state === 'unavailable' && value.failureCode === capitalConditionsSnapshotPolicy.unavailableFailureCode) return unavailable()
  if (!isAvailableRecord(value) || value.state !== 'available' || value.asOf !== input.asOf) return unavailable()
  const core = value.coreStablecoins
  const coreFields = ['observedAt', 'verifiedAt', 'currentUsd', 'change1dUsd', 'change1dPercent', 'change7dUsd', 'change7dPercent', 'change30dUsd', 'change30dPercent'] as const
  if ((!isExactRecord(core, coreFields) && !isExactRecord(core, [...coreFields, 'dailyFlows'])) ||
    !isCanonicalCapitalConditionsSnapshotTime(core.observedAt) || !isCanonicalCapitalConditionsSnapshotTime(core.verifiedAt) || core.observedAt > core.verifiedAt ||
    !['currentUsd', 'change1dUsd', 'change1dPercent', 'change7dUsd', 'change7dPercent', 'change30dUsd', 'change30dPercent'].every((key) => typeof core[key] === 'number' && Number.isFinite(core[key]) && !Object.is(core[key], -0)) ||
    (core.dailyFlows !== undefined && !isValidCapitalConditionsDailyFlows(core.dailyFlows, input.asOf))) return unavailable()
  const etf = value.etf
  const safeEtf = isVisibleEtfPublicSnapshot(etf, input.asOf) ? toEtfPublicSnapshot(etf) : undefined
  if ((!isExactRecord(etf, ['state']) || etf.state !== 'unavailable') && !safeEtf) return unavailable()
  if (value.conclusion !== 'partial') return unavailable()
  const background = value.usdStablecoinSupplyUsd
  if (background !== undefined && (typeof background !== 'number' || !Number.isFinite(background) || Object.is(background, -0))) return unavailable()
  const result = Object.freeze({
    state: 'available', asOf: input.asOf, etf: safeEtf ?? { state: 'unavailable' },
    coreStablecoins: Object.freeze({
      observedAt: core.observedAt as string, verifiedAt: core.verifiedAt as string,
      currentUsd: core.currentUsd as number, change1dUsd: core.change1dUsd as number,
      change1dPercent: core.change1dPercent as number, change7dUsd: core.change7dUsd as number,
      change7dPercent: core.change7dPercent as number, change30dUsd: core.change30dUsd as number,
      change30dPercent: core.change30dPercent as number,
      ...(core.dailyFlows ? { dailyFlows: core.dailyFlows } : {})
    }),
    ...(background === undefined ? {} : { usdStablecoinSupplyUsd: background }),
    conclusion: 'partial'
  }) as CapitalConditionsSnapshotResult
  return isWithinCapitalConditionsSnapshotDtoBudget(result) ? result : unavailable()
}

function isAvailableRecord(value: unknown): value is Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object') return false
    const names = Object.getOwnPropertyNames(value)
    const required = ['state', 'asOf', 'etf', 'coreStablecoins', 'conclusion']
    return isExactRecord(value, names) && required.every((field) => names.includes(field)) &&
      names.every((name) => required.includes(name) || name === 'usdStablecoinSupplyUsd')
  } catch {
    return false
  }
}

function isExactRecord(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length > 0) return false
    const names = Object.getOwnPropertyNames(value)
    return names.length === fields.length && fields.every((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field)
      return descriptor?.enumerable === true && 'value' in descriptor
    })
  } catch {
    return false
  }
}

function unavailable(): Extract<CapitalConditionsSnapshotResult, { state: 'unavailable' }> {
  return Object.freeze({ state: 'unavailable', failureCode: capitalConditionsSnapshotPolicy.unavailableFailureCode })
}
