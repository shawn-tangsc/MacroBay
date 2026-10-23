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
  currentUtcMonthParameterNames: Object.freeze({ start: 'startTime', end: 'endTime', locale: 'locale' })
})

export const zeroXRouterCalendarTransportPolicy = Object.freeze({
  descriptorPaths: zeroXRouterCalendarEvidenceAdmissionPolicy.paths,
  locales: zeroXRouterCalendarEvidenceAdmissionPolicy.locales,
  monthPattern: /^\d{4}-(?:0[1-9]|1[0-2])$/,
  parameterNames: zeroXRouterCalendarEvidenceAdmissionPolicy.currentUtcMonthParameterNames,
  successEnvelope: Object.freeze({ code: 200, msg: 'string', data: 'array' })
})

export function isZeroXRouterSource(sourceId: string): sourceId is typeof zeroXRouterSourcePolicy.sourceId {
  return sourceId === zeroXRouterSourcePolicy.sourceId
}

export function isSafeZeroXRouterApiKey(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 4096 && !/[\u0000-\u001f\u007f]/.test(value)
}
