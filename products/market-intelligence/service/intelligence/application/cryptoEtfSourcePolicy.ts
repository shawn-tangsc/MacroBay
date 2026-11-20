/**
 * CryptoETF 的端点、预算与身份。**sourceId 只在这里写一次**（架构师 2026-11-13 裁定），
 * 以后注册表、窗口行、看板格子、证据句柄都引用这个常量，不再各自写一份。
 *
 * 本笔（用户 2026-11-13 定的「只新增、不切换」）只做「可单独测试、可单独抓一次」的适配器：
 * 不装配到 ETF 卡片链路、不写库、不排采集频率。下面的治理参数是给下一阶段的采集用的，
 * 现在只让单次读取遵守同一个身份与预算。
 */
export const cryptoEtfSourcePolicy = Object.freeze({
  sourceId: 'cryptoetf-etf-flows' as const,
  providerId: 'cryptoetf' as const,
  /** 事实性集成数据：Provider 显示名用官方写法，不译。 */
  displayName: 'CryptoETF',
  apiBaseUrl: 'https://api.cryptoetf.today',
  /** 免费档 60 次/分；`x-ratelimit-*` 是唯一可信的额度来源。 */
  requestGovernance: Object.freeze({
    providerId: 'cryptoetf',
    quotaScope: 'api-key' as const,
    rollingWindow: Object.freeze({ maxRequests: 60, windowMs: 60_000 }),
    queue: Object.freeze({ ordering: 'fifo' as const, maxPending: 4, maxWaitMs: 60_000 }),
    settingVisibility: 'visible' as const
  }),
  authHeader: 'Authorization',
  authScheme: 'Bearer',
  requestTimeoutMs: 15_000,
  /** `/funds` 实测约 16KB；2MiB 是上限，不是预期。 */
  responseAcceptedMaxBytes: 2 * 1024 * 1024,
  /** 免费档最多 31 行（30 天 + 当天占位）；给一点余量，超了按形状异常处理。 */
  maximumRowsPerAsset: 32,
  /** 日值单位是「百万美元」；`1e6` 上限只是挡住明显不合法的量级。 */
  maximumAbsoluteUsdMillions: 1_000_000,
  /** 逐基金条目上限：实测 12 条，留足余量。 */
  maximumFundsPerDay: 50,
  /**
   * 每条基金各按 0.1M 取整，聚合误差典型 0.2M、最坏约 0.6M。超过这个数就记一条
   * 「逐基金与 total 对不上」的诊断；**读数仍取 totalUsdM**，绝不用自己加总的数。
   */
  fundSumToleranceUsdMillions: 0.6
} as const)

/** 路径段（官方文档写法）与响应里的 `asset` 是两个词：`/flows/btc` 回 `asset: 'bitcoin'`。 */
export type CryptoEtfAssetKey = 'btc' | 'eth'
export type CryptoEtfAssetSymbol = 'BTC' | 'ETH'
export type CryptoEtfResponseAsset = 'bitcoin' | 'ethereum'

export const cryptoEtfAssetMetadata: Readonly<Record<CryptoEtfAssetKey, Readonly<{ symbol: CryptoEtfAssetSymbol; responseAsset: CryptoEtfResponseAsset }>>> = Object.freeze({
  btc: Object.freeze({ symbol: 'BTC' as const, responseAsset: 'bitcoin' as const }),
  eth: Object.freeze({ symbol: 'ETH' as const, responseAsset: 'ethereum' as const })
})

/** 主读口：只含已定稿交易日，且带逐基金明细。`/flows/{asset}` 含当天占位 0，不当读数。 */
export function cryptoEtfFlowFundsUrl(asset: CryptoEtfAssetKey): string {
  return `${cryptoEtfSourcePolicy.apiBaseUrl}/api/v1/flows/${asset}/funds`
}

export function cryptoEtfAuthorizationHeader(apiKey: string): string {
  return `${cryptoEtfSourcePolicy.authScheme} ${apiKey.trim()}`
}
