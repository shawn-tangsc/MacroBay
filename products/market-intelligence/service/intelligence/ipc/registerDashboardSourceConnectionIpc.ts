import type { ProductIpcRegistrar } from '@platform/desktop/ipc/productIpcRegistry'

import type { DashboardSourceConnectionResult } from '../../../contracts/macro/economicCalendarQueryContracts'
import { DASHBOARD_SOURCE_CONNECTION_IPC_METHOD } from '../schema/intelligenceSourcesContracts'
import { dashboardSourceConnectionPolicy, type DashboardSourceConnectionService } from '../application/dashboardSourceConnectionService'

const productId = 'market-intelligence'

export function registerDashboardSourceConnectionIpc(register: ProductIpcRegistrar, service: DashboardSourceConnectionService): void {
  register(productId, DASHBOARD_SOURCE_CONNECTION_IPC_METHOD, async (payload) => {
    if (!isInput(payload)) return responseUnavailable()
    return safeResult(() => service.testConnection(payload.sourceId))
  })
}

async function safeResult(action: () => Promise<DashboardSourceConnectionResult>): Promise<DashboardSourceConnectionResult> {
  try {
    const value = await action()
    if (isExact(value, ['state']) && value.state === 'succeeded') return { state: 'succeeded' }
    if (isExact(value, ['state', 'failureCode']) && value.state === 'failed' && isFailureCode(value.failureCode)) return { state: 'failed', failureCode: value.failureCode }
  } catch {}
  return responseUnavailable()
}

function isInput(value: unknown): value is { sourceId: string } {
  return isExact(value, ['sourceId']) && typeof value.sourceId === 'string' && dashboardSourceConnectionPolicy.sourceIds.includes(value.sourceId as never)
}
function isFailureCode(value: unknown): value is Extract<DashboardSourceConnectionResult, { state: 'failed' }>['failureCode'] {
  return value === 'credential-not-configured' || value === 'transport-unavailable' || value === 'request-timeout' || value === 'response-unavailable'
}
function isExact(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return false
    const names = Object.getOwnPropertyNames(value)
    return names.length === fields.length && fields.every((field) => Object.hasOwn(value, field)) && Object.getOwnPropertySymbols(value).length === 0 && names.every((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field)
      return Boolean(descriptor && 'value' in descriptor)
    })
  } catch { return false }
}
function responseUnavailable(): DashboardSourceConnectionResult { return { state: 'failed', failureCode: 'response-unavailable' } }
