export const zeroXRouterHttpTransportPolicy = Object.freeze({
  requestHeader: 'X-My-Token',
  method: 'GET',
  requestTimeoutMs: 15_000,
  responseAcceptedMaxBytes: 256 * 1024,
  redirectMode: 'error' as RequestRedirect,
  responseMimeEssence: 'application/json',
  successStatus: Object.freeze({ minimum: 200, maximumExclusive: 300 })
})

export const etfFlowHistoryResponseBudgetPolicy = Object.freeze({
  maximumBodyBytes: 2 * 1024 * 1024,
  trustContentLength: false
})

// Calendar-owned month budget (incident 133), not a change to probes or ETF.
// 2 MiB bounds the raw month; the parser still admits <=1000 rows, and storage
// retains its independent 8 KiB/observation and shared archive/capacity gates.
export const calendarMonthResponseBudgetPolicy = Object.freeze({
  maximumBodyBytes: 2 * 1024 * 1024,
  trustContentLength: true
})

export const zeroXRouterSourcePolicy = Object.freeze({
  sourceId: '0xrouter-aggregate-provider',
  sourceGroup: 'aggregate-data-provider',
  requestGovernance: Object.freeze({
    providerId: '0xrouter',
    quotaScope: 'api-key' as const,
    rollingWindow: Object.freeze({ maxRequests: 10, windowMs: 60_000 }),
    queue: Object.freeze({ ordering: 'fifo' as const, maxPending: 10, maxWaitMs: 60_000 }),
    settingVisibility: 'visible' as const
  }),
  connectionProbe: Object.freeze({
    ...zeroXRouterHttpTransportPolicy,
    url: 'https://0xrouter.app/account/balance',
    contract: 'account-balance-json-object' as const,
    minimumObjectFields: 1,
    explicitFailureSignals: Object.freeze({
      nonSuccessCode: 200,
      unsuccessfulBoolean: false,
      errorStatus: 'error'
    })
  }),
  etfFlowHistoryDiagnostic: Object.freeze({
    ...zeroXRouterHttpTransportPolicy,
    intent: 'user' as const,
    urls: Object.freeze({
      bitcoin: 'https://0xrouter.app/cexdata/etf/bitcoin/flow-history',
      ethereum: 'https://0xrouter.app/cexdata/etf/ethereum/flow-history'
    }),
    contract: 'cexdata-etf-flow-history-envelope-only' as const,
    successEnvelope: Object.freeze({ code: 200, data: 'array' as const })
  }),
  etfData: Object.freeze({
    url: 'https://0xrouter.app/cexdata/etf/bitcoin/net-assets/history/',
    contract: 'cexdata-etf-net-assets-history' as const,
    dataRecordDateField: 'date',
    dataRecordEtfValueField: 'aum',
    dataRecordDatePattern: /^\d{4}-\d{2}-\d{2}$/
  })
})

export const zeroXRouterEtfRefreshSchedulePolicy = Object.freeze({
  sourceId: zeroXRouterSourcePolicy.sourceId,
  collectionPreset: 'balanced' as const,
  intervalSeconds: 10 * 60
})

export const zeroXRouterCalendarEvidenceAdmissionPolicy = Object.freeze({
  baseUrl: 'https://0xrouter.app/cexdata/calendar',
  paths: Object.freeze({
    'macro-calendar-0xrouter-economic-data': 'economic-data',
    'macro-calendar-0xrouter-financial-events': 'financial-events',
    'macro-calendar-0xrouter-central-bank-activities': 'central-bank-activities'
  }),
  locales: Object.freeze(['zh', 'en'] as const),
  /**
   * 每条日历**实际发布**哪些语言。2026-11-09 用证据归档实测：`financial-events` 与
   * `central-bank-activities` 的 `locale=en` 请求返回的是同一个 38 字节空载荷
   * `{"code":200,"msg":"success","data":[]}`（两个 descriptor 的 body 哈希相同），而
   * `economic-data` 同月 en 返回 316 行。也就是说前两条**没有英文条目**，再请求只是空转
   * （569+565 次"成功但 0 行"）。
   *
   * 自动采集只请求这里列出的语言；手动请求仍放行，但批次判定会把它标成 `no-locale-rows`
   * 而不是 `success-empty`——「来源没有这种语言」与「这个月没有事件」必须分开。
   */
  publishedLocales: Object.freeze({
    'macro-calendar-0xrouter-economic-data': Object.freeze(['zh', 'en'] as const),
    'macro-calendar-0xrouter-financial-events': Object.freeze(['zh'] as const),
    'macro-calendar-0xrouter-central-bank-activities': Object.freeze(['zh'] as const)
  }),
  currentUtcMonthParameterNames: Object.freeze({ start: 'startTime', end: 'endTime', locale: 'locale' })
})

export const zeroXRouterCalendarTransportPolicy = Object.freeze({
  descriptorPaths: zeroXRouterCalendarEvidenceAdmissionPolicy.paths,
  locales: zeroXRouterCalendarEvidenceAdmissionPolicy.locales,
  publishedLocales: zeroXRouterCalendarEvidenceAdmissionPolicy.publishedLocales,
  monthPattern: /^\d{4}-(?:0[1-9]|1[0-2])$/,
  parameterNames: zeroXRouterCalendarEvidenceAdmissionPolicy.currentUtcMonthParameterNames,
  successEnvelope: Object.freeze({ code: 200, msg: 'string', data: 'array' })
})

/** 这条日历是否发布该语言。自动采集据此过滤，批次判定据此把空结果与"本月无事件"分开。 */
export function zeroXRouterCalendarPublishesLocale(descriptorId: string, locale: string): boolean {
  const published = (zeroXRouterCalendarEvidenceAdmissionPolicy.publishedLocales as Record<string, readonly string[]>)[descriptorId]
  return published === undefined ? true : published.includes(locale)
}

export function isZeroXRouterSource(sourceId: string): sourceId is typeof zeroXRouterSourcePolicy.sourceId {
  return sourceId === zeroXRouterSourcePolicy.sourceId
}

export function isSafeZeroXRouterApiKey(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 4096 && !/[\u0000-\u001f\u007f]/.test(value)
}
