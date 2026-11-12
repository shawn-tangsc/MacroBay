import { httpRequest } from '@platform/jobs'
import type { CredentialProbeFailureCode } from './credentialedProviderProbes'
import { getPlatformFetch } from '@platform/network/platformFetch'

import {
  cryptoEtfAuthorizationHeader,
  cryptoEtfFlowFundsUrl,
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
 * **只读 `/flows/{asset}/funds`**：它只含已定稿交易日，逐基金明细可对账，而且这正是阶段 2
 * 真正解析的那个口。`/flows/{asset}` 我们永远不读——它最后一行是当天占位 0，拿它做探针会
 * 让「源的形状变了」把一个与读者无关的失败显示出来。测试按钮就测这一个口：鉴权、额度、形状
 * 一次全能证明。
 */
/**
 * 取自共享闭集 `CredentialProbeFailureCode`，只挑**这个客户端真会返回**的码，外加自己的诊断码
 * `no-settled-rows`（读数口用，探针把它并到形状那一档，不上界面）。
 * 用 `Extract` 而不是整集合取并：配置线那条 `Record<CryptoEtfFlowFailureCode, ...>` 是穷尽的，
 * 整集合会逼它给「我永远不会返回的码」也写映射。共享集删掉哪个码，这里会立刻编译失败。
 */
export type CryptoEtfFlowFailureCode =
  | Extract<CredentialProbeFailureCode,
      | 'credential-invalid' | 'plan-restricted' | 'rate-limited' | 'request-timeout'
      | 'transport-unavailable' | 'response-unavailable' | 'response-shape-invalid'>
  | 'no-settled-rows'

export type CryptoEtfAssetReading =
  | Readonly<{ state: 'available'; days: readonly CryptoEtfSettledDay[]; audit: CryptoEtfFundsAudit }>
  | Readonly<{ state: 'unavailable'; failureCode: CryptoEtfFlowFailureCode }>

type CryptoEtfAvailableReading = Extract<CryptoEtfAssetReading, { state: 'available' }>

export type CryptoEtfFlowWindow =
  | Readonly<{ state: 'available'; btc: CryptoEtfAvailableReading; eth: CryptoEtfAvailableReading }>
  | Readonly<{ state: 'partial'; btc?: CryptoEtfAvailableReading; eth?: CryptoEtfAvailableReading }>
  | Readonly<{ state: 'unavailable'; failureCode: CryptoEtfFlowFailureCode }>

export type CryptoEtfConnectionTest =
  | Readonly<{
      state: 'succeeded'
      settled: Readonly<{ tradingDate: string; settledRows: number; placeholderOrNonTradingRows: number }>
      plan?: string
      rateLimitRemaining?: string
    }>
  | Readonly<{ state: 'failed'; failureCode: CryptoEtfFlowFailureCode }>

export type CryptoEtfBodyResult =
  | Readonly<{ state: 'ok'; body: string; status: number; headers: Readonly<Record<string, string>> }>
  | Readonly<{ state: 'failed'; failureCode: CryptoEtfFlowFailureCode }>

export type CryptoEtfFlowClientDeps = Readonly<{
  /** 只给用例注入；生产走平台代理感知的出网通道。 */
  requestBody?: (url: string, apiKey: string) => Promise<CryptoEtfBodyResult>
  /** 与 `credentialedProviderProbes.ts` 同样的取法：`deps.platformFetch ?? getPlatformFetch()`。 */
  platformFetch?: (input: string, init: RequestInit) => Promise<Response>
}>

export function createCryptoEtfFlowClient(deps: CryptoEtfFlowClientDeps = {}) {
  const requestBody = deps.requestBody ?? ((url: string, apiKey: string) => requestCryptoEtfBody(url, apiKey, deps.platformFetch))

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
     * 设置页「测试连接」用它，**只打 `/flows/btc/funds`**：鉴权 + 额度 + 形状一次验完，
     * 而且验的正是我们真正要解析的口。形状不对就是红，200 也不算通过。
     */
    async testConnection(apiKey: string): Promise<CryptoEtfConnectionTest> {
      if (!isUsableKey(apiKey)) return Object.freeze({ state: 'failed' as const, failureCode: 'credential-invalid' as const })
      const body = await requestBody(cryptoEtfFlowFundsUrl('btc'), apiKey)
      if (body.state === 'failed') return Object.freeze({ state: 'failed' as const, failureCode: body.failureCode })
      const parsed = parseCryptoEtfFundsResponse(body.body, 'btc')
      // 测试按钮的可见失败只有四组（密钥/额度/网络/形状）。「没有一行定稿」不是第五个词，
      // 对读者就是「返回结构和预期不一样」。
      if (parsed.state !== 'available') return Object.freeze({ state: 'failed' as const, failureCode: parsed.reason === 'no-settled-rows' ? 'response-shape-invalid' : parsed.reason })

      return Object.freeze({
        state: 'succeeded' as const,
        settled: Object.freeze({
          tradingDate: parsed.audit.latestTradingDate,
          settledRows: parsed.audit.settledRows,
          placeholderOrNonTradingRows: parsed.audit.droppedRowsWithoutFunds + parsed.audit.droppedWeekendRows + parsed.audit.droppedUndecidableZeroRows
        }),
        ...(body.headers['x-plan'] ? { plan: body.headers['x-plan'] } : {}),
        ...(body.headers['x-ratelimit-remaining'] ? { rateLimitRemaining: body.headers['x-ratelimit-remaining'] } : {})
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

async function requestCryptoEtfBody(url: string, apiKey: string, platformFetch?: (input: string, init: RequestInit) => Promise<Response>): Promise<CryptoEtfBodyResult> {
  try {
    const response = await httpRequest(
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
      // 出网一律走平台适配器。`httpRequest` 的 fetchImpl 类型更宽，但我们只传 URL 字符串。
      { fetchImpl: (platformFetch ?? getPlatformFetch()) as typeof fetch, retryPolicy: { maxAttempts: 1 }, redactHeaders: ['authorization', 'x-api-key'] }
    )
    if (response.status === 401) return failed('credential-invalid')
    if (response.status === 403) return failed('plan-restricted')
    if (response.status === 429) return failed('rate-limited')
    if (response.status < 200 || response.status >= 300) return failed('response-unavailable')
    if (response.byteSize > cryptoEtfSourcePolicy.responseAcceptedMaxBytes) return failed('response-unavailable')
    if (response.bodyText.trim().length === 0) return failed('response-shape-invalid')
    return Object.freeze({ state: 'ok' as const, body: response.bodyText, status: response.status, headers: Object.freeze({ ...response.headers }) })
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : ''
    return failed(message.includes('timed out') || message.includes('timeout') ? 'request-timeout' : 'transport-unavailable')
  }
}

function pickFailure(codes: readonly CryptoEtfFlowFailureCode[]): CryptoEtfFlowFailureCode {
  const precedence: readonly CryptoEtfFlowFailureCode[] = [
    'credential-invalid', 'plan-restricted', 'rate-limited', 'request-timeout', 'transport-unavailable',
    'response-unavailable', 'response-shape-invalid', 'no-settled-rows'
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
