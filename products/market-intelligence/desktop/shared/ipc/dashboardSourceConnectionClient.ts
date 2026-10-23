import type { DashboardSourceConnectionResult } from '../../../contracts/macro/economicCalendarQueryContracts'

const productId = 'market-intelligence'
const method = 'intelligence.dashboardSourceConnection.test'
const sourceIds = ['alternative-fear-greed', 'binance-futures-positioning', 'defillama-stablecoins'] as const

export type DashboardConnectionSourceId = typeof sourceIds[number]

export const dashboardSourceConnectionClient = {
  async testConnection(sourceId: DashboardConnectionSourceId): Promise<DashboardSourceConnectionResult> {
    if (!isSourceId(sourceId)) return unavailable()
    try {
      if (!window.platform?.products?.invoke) return unavailable()
      return safeResult(await window.platform.products.invoke(productId, method, { sourceId }))
    } catch {
      return unavailable()
    }
  }
}

function safeResult(value: unknown): DashboardSourceConnectionResult {
  try {
    if (isExact(value, ['state']) && value.state === 'succeeded') return Object.freeze({ state: 'succeeded' })
    if (isExact(value, ['state', 'failureCode']) && value.state === 'failed' &&
      (value.failureCode === 'transport-unavailable' || value.failureCode === 'request-timeout' || value.failureCode === 'response-unavailable')) {
      return Object.freeze({ state: 'failed', failureCode: value.failureCode })
    }
  } catch { /* hostile bridge result */ }
  return unavailable()
}

function isSourceId(value: unknown): value is DashboardConnectionSourceId {
  return typeof value === 'string' && sourceIds.includes(value as DashboardConnectionSourceId)
}

function isExact(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false
    const names = Object.getOwnPropertyNames(value)
    return names.length === fields.length && fields.every((field) => Object.hasOwn(value, field)) && Object.getOwnPropertySymbols(value).length === 0 && names.every((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field)
      return Boolean(descriptor && descriptor.enumerable && 'value' in descriptor)
    })
  } catch { return false }
}

function unavailable(): DashboardSourceConnectionResult {
  return Object.freeze({ state: 'failed', failureCode: 'response-unavailable' })
}
