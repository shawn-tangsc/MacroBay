import { intelligenceHttpRequest } from '../adapters/intelligenceHttpClient'

import {
  cryptoEtfAuthorizationHeader,
  cryptoEtfFlowFundsUrl,
  cryptoEtfFlowUrl,
  cryptoEtfSourcePolicy,
  type CryptoEtfAssetKey
} from './cryptoEtfSourcePolicy'
import {
  parseCryptoEtfFundsResponse,
  type CryptoEtfFundsAudit,
  type CryptoEtfSettledDay
} from './cryptoEtfFundsParser'

/**
 * CryptoETF 的单次读取。**本笔只用于「单独测一次 / 单独抓一次」**：不写库、不定时、不装配到
 * ETF 卡片链路（用户 2026-11-13 定的「只新增、不切换」）。
 *
 * 两个口的分工是硬规则：
 * - `/flows/{asset}/funds` 是**读数口**：只含已定稿交易日，逐基金明细可对账；
 * - `/flows/{asset}` 只用于**连接探针**：它最后一行是当天占位 0，永远不进读数。
 *
 * 测试按钮两个都打：用户要看的是「这个源能不能用」，而「能用」= 鉴权对、额度在、
 * 聚合口回得出形状、**我们真正解析的那个口也能解析**。只打一个都会漏一半。
 */
export type CryptoEtfFlowFailureCode =
  | 'credential-invalid'
  | 'rate-limited'
  | 'request-timeout'
  | 'transport-unavailable'
  | 'response-unavailable'
  | 'response-shape'
  | 'no-settled-rows'

export type CryptoEtfAssetReading =
  | Readonly<{ state: 'available'; days: readonly CryptoEtfSettledDay[]; audit: CryptoEtfFundsAudit }>
  | Readonly<{ state: 'unavailable'; failureCode: CryptoEtfFlowFailureCode }>

export type CryptoEtfFlowWindow =
  | Readonly<{ state: 'available'; btc: CryptoEtfAssetReading; eth: CryptoEtfAssetReading }>
  | Readonly<{ state: 'partial'; btc?: CryptoEtfAssetReading; eth?: CryptoEtfAssetReading }>
  | Readonly<{ state: 'unavailable'; failureCode: CryptoEtfFlowFailureCode }>

export type CryptoEtfAggregateInspection = Readonly<{
  rows: number
  lastDate: string
  /** 聚合口最后一行就是未定稿占位；它是 0 也不代表今天真是 0。 */
  lastRowIsPlaceholder: true
}>

export type CryptoEtfConnectionTest =
  | Readonly<{
      state: 'succeeded'
      aggregate: CryptoEtfAggregateInspection
      settled: Readonly<{ tradingDate: string; settledRows: number; placeholderOrNonTradingRows: number }>
      plan?: string
      rateLimitRemaining?: string
    }>
  | Readonly<{ state: 'failed'; failureCode: CryptoEtfFlowFailureCode }>

export type CryptoEtfBodyResult =
  | Readonly<{ state: 'ok'; body: string; status: number; headers: Readonly<Record<string, string>> }>
  | Readonly<{ state: 'failed'; failureCode: CryptoEtfFlowFailureCode }>

export type CryptoEtfFlowClientDeps = Readonly<{
  /** 只给用例注入；生产走平台代理感知的 `intelligenceHttpRequest`。 */
  requestBody?: (url: string, apiKey: string) => Promise<CryptoEtfBodyResult>
}>

export function createCryptoEtfFlowClient(deps: CryptoEtfFlowClientDeps = {}) {
  const requestBody = deps.requestBody ?? requestCryptoEtfBody

  return {
    /** 两支一起读；一支成功是 `partial`，一支都没成才是 `unavailable`。 */
    async readSettledWindow(apiKey: string): Promise<CryptoEtfFlowWindow> {
      if (!isUsableKey(apiKey)) return Object.freeze({ state: 'unavailable' as const, failureCode: 'credential-invalid' as const })
      const [btc, eth] = await Promise.all([
        readAsset('btc', apiKey, requestBody),
        readAsset('eth', apiKey, requestBody)
      ])
      if (btc.state === 'available' && eth.state === 'available') return Object.freeze({ state: 'available' as const, btc, eth })
      if (btc.state === 'available') return Object.freeze({ state: 'partial' as const, btc })
      if (eth.state === 'available') return Object.freeze({ state: 'partial' as const, eth })
      return Object.freeze({ state: 'unavailable' as const, failureCode: pickFailure([btc.failureCode, eth.failureCode]) })
    },

    /**
     * 设置页「测试连接」用它。先打 `/flows/btc`（鉴权 + 额度 + 聚合形状），再解析
     * `/flows/btc/funds`（我们真正要读的口）；任一步失败都给一个可分辨的原因。
     */
    async testConnection(apiKey: string): Promise<CryptoEtfConnectionTest> {
      if (!isUsableKey(apiKey)) return Object.freeze({ state: 'failed' as const, failureCode: 'credential-invalid' as const })
      const aggregateBody = await requestBody(cryptoEtfFlowUrl('btc'), apiKey)
      if (aggregateBody.state === 'failed') return Object.freeze({ state: 'failed' as const, failureCode: aggregateBody.failureCode })
      const aggregate = inspectAggregate(aggregateBody.body)
      if (!aggregate) return Object.freeze({ state: 'failed' as const, failureCode: 'response-shape' as const })

      const fundsBody = await requestBody(cryptoEtfFlowFundsUrl('btc'), apiKey)
      if (fundsBody.state === 'failed') return Object.freeze({ state: 'failed' as const, failureCode: fundsBody.failureCode })
      const funds = parseCryptoEtfFundsResponse(fundsBody.body, 'btc')
      if (funds.state !== 'available') return Object.freeze({ state: 'failed' as const, failureCode: funds.reason })

      return Object.freeze({
        state: 'succeeded' as const,
        aggregate,
        settled: Object.freeze({
          tradingDate: funds.audit.latestTradingDate,
          settledRows: funds.audit.settledRows,
          placeholderOrNonTradingRows: funds.audit.droppedRowsWithoutFunds + funds.audit.droppedWeekendRows
        }),
        ...(fundsBody.headers['x-plan'] ? { plan: fundsBody.headers['x-plan'] } : {}),
        ...(fundsBody.headers['x-ratelimit-remaining'] ? { rateLimitRemaining: fundsBody.headers['x-ratelimit-remaining'] } : {})
      })
    }
  }
}

async function readAsset(asset: CryptoEtfAssetKey, apiKey: string, requestBody: NonNullable<CryptoEtfFlowClientDeps['requestBody']>): Promise<CryptoEtfAssetReading> {
  const body = await requestBody(cryptoEtfFlowFundsUrl(asset), apiKey)
  if (body.state === 'failed') return Object.freeze({ state: 'unavailable' as const, failureCode: body.failureCode })
  const parsed = parseCryptoEtfFundsResponse(body.body, asset)
  return parsed.state === 'available'
    ? Object.freeze({ state: 'available' as const, days: parsed.days, audit: parsed.audit })
    : Object.freeze({ state: 'unavailable' as const, failureCode: parsed.reason })
}

function inspectAggregate(body: string): CryptoEtfAggregateInspection | undefined {
  try {
    const value: unknown = JSON.parse(body)
    if (!isPlainRecord(value) || value.symbol !== 'BTC' || value.asset !== 'bitcoin') return undefined
    if (!Array.isArray(value.days) || value.days.length === 0) return undefined
    const last = value.days.at(-1)
    if (!isPlainRecord(last) || typeof last.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(last.date)) return undefined
    if (typeof last.netFlowUsdM !== 'number' || !Number.isFinite(last.netFlowUsdM)) return undefined
    return Object.freeze({ rows: value.days.length, lastDate: last.date, lastRowIsPlaceholder: true as const })
  } catch {
    return undefined
  }
}

async function requestCryptoEtfBody(url: string, apiKey: string): Promise<CryptoEtfBodyResult> {
  try {
    const response = await intelligenceHttpRequest(
      {
        url,
        method: 'GET',
        headers: {
          Accept: 'application/json',
          [cryptoEtfSourcePolicy.authHeader]: cryptoEtfAuthorizationHeader(apiKey)
        },
        timeoutMs: cryptoEtfSourcePolicy.requestTimeoutMs
      },
      // 测试按钮只按一次：不重试、不放大并发。429 必须让读者看见，不是悄悄重排。
      { retryPolicy: { maxAttempts: 1 }, redactHeaders: ['authorization', 'x-api-key'] }
    )
    if (response.status === 401 || response.status === 403) return failed('credential-invalid')
    if (response.status === 429) return failed('rate-limited')
    if (response.status < 200 || response.status >= 300) return failed('response-unavailable')
    if (response.byteSize > cryptoEtfSourcePolicy.responseAcceptedMaxBytes) return failed('response-unavailable')
    if (response.bodyText.trim().length === 0) return failed('response-shape')
    return Object.freeze({ state: 'ok' as const, body: response.bodyText, status: response.status, headers: Object.freeze({ ...response.headers }) })
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : ''
    return failed(message.includes('timed out') || message.includes('timeout') ? 'request-timeout' : 'transport-unavailable')
  }
}

function pickFailure(codes: readonly CryptoEtfFlowFailureCode[]): CryptoEtfFlowFailureCode {
  const precedence: readonly CryptoEtfFlowFailureCode[] = [
    'credential-invalid', 'rate-limited', 'request-timeout', 'transport-unavailable',
    'response-unavailable', 'response-shape', 'no-settled-rows'
  ]
  return precedence.find((code) => codes.includes(code)) ?? 'response-unavailable'
}

function isUsableKey(apiKey: unknown): apiKey is string {
  return typeof apiKey === 'string' && apiKey.trim().length > 0 && apiKey.trim().length <= 4096 &&
    !/[\u0000-\u001f\u007f]/.test(apiKey)
}

function failed(failureCode: CryptoEtfFlowFailureCode): CryptoEtfBodyResult {
  return Object.freeze({ state: 'failed' as const, failureCode })
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype && Object.getOwnPropertySymbols(value).length === 0
}
