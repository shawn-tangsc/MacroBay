import { getPlatformFetch } from '@platform/network/platformFetch'

import type { DashboardSourceConnectionResult } from '../../../contracts/macro/economicCalendarQueryContracts'
import { parseStablecoinCapitalSnapshot } from '../capital-conditions/stablecoinCapitalParser'
import { macroCalendarTransportPolicy } from '../macro-calendar/macroCalendarPolicy'
import { dashboardSourceSurfacePolicy } from '../schema/intelligenceSourcesContracts'

type DashboardSourceConnectionId = 'alternative-fear-greed' | 'binance-futures-positioning' | 'defillama-stablecoins'
type DashboardSourceConnectionRequest = Readonly<{
  sourceId: DashboardSourceConnectionId
  url: string
  responseContainer: 'object-data-array' | 'array' | 'stablecoin-core'
}>

export const dashboardSourceConnectionPolicy = {
  sourceIds: dashboardSourceSurfacePolicy.connectionProbeSourceIds,
  requests: [
    {
      sourceId: 'alternative-fear-greed',
      url: 'https://api.alternative.me/fng/?limit=1',
      responseContainer: 'object-data-array'
    },
    {
      sourceId: 'binance-futures-positioning',
      url: 'https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1',
      responseContainer: 'array'
    },
    {
      sourceId: 'defillama-stablecoins',
      url: 'https://stablecoins.llama.fi/stablecoins',
      responseContainer: 'stablecoin-core'
    }
  ] as const satisfies readonly DashboardSourceConnectionRequest[],
  requestTimeoutMs: macroCalendarTransportPolicy.requestTimeoutMs,
  responseAcceptedMaxBytes: macroCalendarTransportPolicy.responseAcceptedMaxBytes,
  redirectMode: macroCalendarTransportPolicy.redirectMode
} as const

export type DashboardSourceConnectionService = {
  testConnection: (sourceId: unknown) => Promise<DashboardSourceConnectionResult>
}

/** Owns Dashboard-only fixed probes; it never uses the health-writing generic probe. */
export function createDashboardSourceConnectionService(): DashboardSourceConnectionService {
  return {
    async testConnection(sourceId) {
      const request = fixedRequest(sourceId)
      return request ? requestFixedConnection(request) : responseUnavailable()
    }
  }
}

async function requestFixedConnection(request: DashboardSourceConnectionRequest): Promise<DashboardSourceConnectionResult> {
  const controller = new AbortController()
  let timedOut = false
  let responseReceived = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, dashboardSourceConnectionPolicy.requestTimeoutMs)
  try {
    const response = await getPlatformFetch()(request.url, {
      method: 'GET',
      signal: controller.signal,
      redirect: dashboardSourceConnectionPolicy.redirectMode
    })
    responseReceived = true
    if (!isSuccessStatus(response.status)) return responseUnavailable()
    const declaredBytes = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredBytes) && declaredBytes > dashboardSourceConnectionPolicy.responseAcceptedMaxBytes) return responseUnavailable()
    const body = await response.text()
    if (typeof body !== 'string' || new TextEncoder().encode(body).byteLength > dashboardSourceConnectionPolicy.responseAcceptedMaxBytes) return responseUnavailable()
    return hasExpectedContainer(body, request.responseContainer) ? { state: 'succeeded' } : responseUnavailable()
  } catch {
    if (timedOut) return requestTimeout()
    return responseReceived ? responseUnavailable() : transportUnavailable()
  } finally {
    clearTimeout(timeout)
  }
}

function fixedRequest(sourceId: unknown): DashboardSourceConnectionRequest | undefined {
  return typeof sourceId === 'string'
    ? dashboardSourceConnectionPolicy.requests.find((request) => request.sourceId === sourceId)
    : undefined
}

function isSuccessStatus(status: unknown): status is number {
  return typeof status === 'number' && Number.isInteger(status) && status >= 200 && status < 300
}

function hasExpectedContainer(body: string, expected: DashboardSourceConnectionRequest['responseContainer']): boolean {
  try {
    const value = JSON.parse(body) as unknown
    if (expected === 'array') return Array.isArray(value)
    if (expected === 'stablecoin-core') return parseStablecoinCapitalSnapshot(value).state === 'available'
    if (!isDataRecord(value)) return false
    const descriptor = Object.getOwnPropertyDescriptor(value, 'data')
    return Boolean(descriptor && descriptor.enumerable === true && 'value' in descriptor && Array.isArray(descriptor.value))
  } catch {
    return false
  }
}

function isDataRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype)
}
function transportUnavailable(): DashboardSourceConnectionResult { return { state: 'failed', failureCode: 'transport-unavailable' } }
function requestTimeout(): DashboardSourceConnectionResult { return { state: 'failed', failureCode: 'request-timeout' } }
function responseUnavailable(): DashboardSourceConnectionResult { return { state: 'failed', failureCode: 'response-unavailable' } }
