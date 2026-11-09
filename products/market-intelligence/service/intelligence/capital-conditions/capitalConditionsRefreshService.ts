import { parseStablecoinCapitalSnapshot, parseStablecoinDailyHistory, type StablecoinCapitalSnapshot } from './stablecoinCapitalParser'
import type { CapitalConditionsCurrentStateStore } from './stablecoinCapitalCurrentStateStore'

export type CapitalConditionsRefreshResult = Readonly<{ state: 'updated' | 'unchanged' | 'unavailable' }>

type CapitalConditionsTransportResult =
  | Readonly<{ state: 'available'; payload: unknown; acceptedBytes: number }>
  | Readonly<{ state: 'unavailable'; reason: 'response-body-too-large' | 'response-unavailable' }>

export function createCapitalConditionsRefreshService(deps: {
  isEnabled: () => Promise<boolean>
  /**
   * 两条请求：当前快照，和可选的已完成日流水。
   *
   * 实现里早就在读 `requestStablecoinHistoryPayload`（见下面 `refresh`），但类型只写了第一条——
   * 于是那条历史分支在编译期不存在：测试把这条依赖传进来会被判成「未知属性」，
   * 而真正的调用点也不可能被类型检查。补上它，让分支和类型说的是同一件事。
   */
  http: {
    requestStablecoinPayload: () => Promise<CapitalConditionsTransportResult>
    requestStablecoinHistoryPayload?: () => Promise<CapitalConditionsTransportResult>
  }
  store: CapitalConditionsCurrentStateStore
  now: () => string
}) {
  return {
    async refresh(): Promise<CapitalConditionsRefreshResult> {
      if (!await enabled(deps)) return unavailable()
      const attemptedAt = deps.now()
      const result = await requestAndParse(deps, attemptedAt)
      if (!result) {
        await deps.store.recordFailure({ attemptedAt, bodyTooLarge: false })
        return unavailable()
      }
      if (result.state === 'transport-unavailable') {
        await deps.store.recordFailure({ attemptedAt, bodyTooLarge: result.bodyTooLarge })
        return unavailable()
      }
      return deps.store.recordSuccess({ snapshot: result.snapshot, verifiedAt: attemptedAt })
    },
    async probe(): Promise<Readonly<{ state: 'available' | 'unavailable' }>> {
      if (!await enabled(deps)) return unavailable()
      const result = await requestAndParse(deps, deps.now())
      return result?.state === 'available' ? Object.freeze({ state: 'available' as const }) : unavailable()
    }
  }
}

async function enabled(deps: { isEnabled: () => Promise<boolean> }): Promise<boolean> {
  try {
    return await deps.isEnabled()
  } catch {
    return false
  }
}

async function requestAndParse(deps: {
  http: { requestStablecoinPayload: () => Promise<CapitalConditionsTransportResult>; requestStablecoinHistoryPayload?: () => Promise<CapitalConditionsTransportResult> }
}, now: string): Promise<
  | Readonly<{ state: 'available'; snapshot: StablecoinCapitalSnapshot }>
  | Readonly<{ state: 'transport-unavailable'; bodyTooLarge: boolean }>
  | undefined
> {
  try {
    const response = await deps.http.requestStablecoinPayload()
    if (response.state === 'unavailable') {
      return Object.freeze({ state: 'transport-unavailable' as const, bodyTooLarge: response.reason === 'response-body-too-large' })
    }
    const parsed = parseStablecoinCapitalSnapshot(response.payload)
    if (parsed.state !== 'available') return undefined
    if (!deps.http.requestStablecoinHistoryPayload) return Object.freeze({ state: 'available' as const, snapshot: parsed.snapshot })
    const history = await deps.http.requestStablecoinHistoryPayload()
    if (history.state === 'unavailable') return Object.freeze({ state: 'transport-unavailable' as const, bodyTooLarge: history.reason === 'response-body-too-large' })
    const dailyFlows = parseStablecoinDailyHistory(history.payload, now)
    return dailyFlows ? Object.freeze({ state: 'available' as const, snapshot: Object.freeze({ ...parsed.snapshot, dailyFlows }) }) : undefined
  } catch {
    return undefined
  }
}

function unavailable(): Readonly<{ state: 'unavailable' }> {
  return Object.freeze({ state: 'unavailable' as const })
}
