import type { ProviderState } from '@platform/ai/providers/modelProviderTypes'
import { buildModelsUrl } from '@platform/ai/providers/modelList/remoteModelList'
import type { TransportErrorKind } from '@platform/ai/invocation/structuredModelInvocationTypes'
import { classifyTransportError } from '@platform/ai/invocation/transportErrorKind'

/**
 * 启动窗口的网络就绪门。
 *
 * 现象：app 启动后 4～5 秒内跑起来的分析会失败，而同一个 provider + model 几十秒后又能成功。
 * 那些失败贴着的不是「模型坏了」，而是「进程刚起来，代理/网络栈还没就绪」。所以这里在
 * **启动引导阶段**探一次 provider 的 `/models`，启动窗口内排队的运行等这一个标记，不各自探测。
 *
 * 边界写死：**只覆盖启动窗口，不是网络抖动的通用兜底。** 门最多跑 `budgetMs` 一次，结算之后
 * （成功或超时）再也不阻塞任何运行；运行中途断网仍由调用层自己的错误归因处理。
 *
 * 判定是「端点可达」而不是「鉴权通过」：400/401/403/404/405 都算已就绪——它们都证明请求到达了
 * 服务端并拿到了 HTTP 响应；只有传输层失败（DNS / 拒绝 / 重置 / TLS / 超时）才继续退避。
 */
export const modelNetworkReadinessPolicy = Object.freeze({
  /** 第一次重试前等 500 ms，之后每次翻倍。 */
  initialDelayMs: 500,
  /** 单次等待的上限；总预算才是真正的边界。 */
  maxDelayMs: 8_000,
  /** 总预算 20 秒；超时即 `network-not-ready`，不冒充 `connect-failed`。 */
  budgetMs: 20_000
})

export type ModelNetworkReadinessState =
  | { status: 'idle' }
  | { status: 'probing' }
  | { status: 'ready'; readyAt?: string; httpStatus?: number }
  | { status: 'not-ready'; lastTransportErrorKind?: TransportErrorKind }

export type ModelNetworkReadiness = Readonly<{
  /** 启动引导阶段同步调用一次；重复调用无副作用（每进程只探一次）。 */
  start: () => void
  /** 门已结算时立即返回；未启动时视为就绪（不在启动窗口内，不归这道门管）。 */
  wait: () => Promise<'ready' | 'not-ready'>
  state: () => ModelNetworkReadinessState
  /** 探通时记下的时刻（ISO）；没探通或没有可探目标时为空。 */
  networkReadyAt: () => string | undefined
}>

export function createModelNetworkReadinessGate(deps: {
  getProviderState: () => Promise<ProviderState>
  fetch: typeof fetch
  /** 便于用例注入假时钟；缺省用真实时钟。 */
  now?: () => number
  nowIso?: () => string
  sleep?: (ms: number) => Promise<void>
  log?: (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void
  policy?: Partial<typeof modelNetworkReadinessPolicy>
}): ModelNetworkReadiness {
  const policy: typeof modelNetworkReadinessPolicy = { ...modelNetworkReadinessPolicy, ...deps.policy }
  const now = deps.now ?? (() => Date.now())
  const nowIso = deps.nowIso ?? (() => new Date().toISOString())
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))

  let state: ModelNetworkReadinessState = { status: 'idle' }
  let settlement: Promise<'ready' | 'not-ready'> | undefined
  let resolveSettlement: ((value: 'ready' | 'not-ready') => void) | undefined

  function settle(next: Extract<ModelNetworkReadinessState, { status: 'ready' | 'not-ready' }>): void {
    state = next
    resolveSettlement?.(next.status)
    resolveSettlement = undefined
    if (next.status === 'ready') {
      deps.log?.('info', 'model-network-ready', {
        readyAt: next.readyAt ?? null,
        httpStatus: next.httpStatus ?? null
      })
    } else {
      deps.log?.('warn', 'model-network-not-ready', {
        lastTransportErrorKind: next.lastTransportErrorKind ?? 'unknown'
      })
    }
  }

  function startProbeLoop(startedAtMs: number): void {
    const deadline = startedAtMs + policy.budgetMs
    // 单次 fetch 挂住时也要在预算内收口：到点 abort，循环据此判超时。
    const budgetController = new AbortController()
    const budgetTimer = setTimeout(() => budgetController.abort(), policy.budgetMs)
    let delayMs: number = policy.initialDelayMs
    let lastTransportErrorKind: TransportErrorKind | undefined

    const finish = (next: Extract<ModelNetworkReadinessState, { status: 'ready' | 'not-ready' }>): void => {
      clearTimeout(budgetTimer)
      settle(next)
    }

    const loop = async (): Promise<void> => {
      while (true) {
        const target = await resolveProbeTarget(deps.getProviderState, deps.log)
        // 没有可探的 provider：网络无从证明，判就绪；配置问题由 `model-not-ready` 那一档回答。
        if (!target) return finish({ status: 'ready' })
        try {
          const response = await deps.fetch(buildModelsUrl(target.baseUrl), {
            method: 'GET',
            headers: {
              accept: 'application/json',
              ...(target.apiKey ? { authorization: `Bearer ${target.apiKey}` } : {}),
              ...(target.customHeaders ?? {})
            },
            signal: budgetController.signal
          })
          // 收到任何 HTTP 响应就证明传输通了；400/401/403/404/405、甚至 5xx 都算。
          void Promise.resolve(response.body?.cancel?.()).catch(() => undefined)
          return finish({ status: 'ready', readyAt: nowIso(), httpStatus: response.status })
        } catch (error) {
          lastTransportErrorKind = classifyTransportError(error)
        }
        const remaining = deadline - now()
        if (remaining <= 0) return finish({ status: 'not-ready', lastTransportErrorKind })
        await sleep(Math.min(delayMs, remaining))
        delayMs = Math.min(delayMs * 2, policy.maxDelayMs)
      }
    }

    void loop().catch(() => finish({ status: 'not-ready', lastTransportErrorKind }))
  }

  return {
    start() {
      if (state.status !== 'idle') return
      const startedAtMs = now()
      state = { status: 'probing' }
      settlement = new Promise(resolve => { resolveSettlement = resolve })
      startProbeLoop(startedAtMs)
    },
    wait() {
      if (state.status === 'ready') return Promise.resolve('ready')
      if (state.status === 'not-ready') return Promise.resolve('not-ready')
      if (state.status === 'probing' && settlement) return settlement
      // 未启动：不在启动窗口内，这道门不参与。
      return Promise.resolve('ready')
    },
    state() {
      return state
    },
    networkReadyAt() {
      return state.status === 'ready' ? state.readyAt : undefined
    }
  }
}

type ProbeTarget = Readonly<{
  baseUrl: string
  apiKey?: string
  customHeaders?: Record<string, string>
}>

/**
 * 探哪个 provider：enabled、有 chat 模型、baseUrl 非空；有 Key 的优先（没 Key 的 401 也证明通，
 * 但有 Key 的那次请求更像真实调用）。
 */
async function resolveProbeTarget(
  getProviderState: () => Promise<ProviderState>,
  log?: (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void
): Promise<ProbeTarget | undefined> {
  let providers: ProviderState['providers']
  try {
    providers = (await getProviderState()).providers
  } catch (error) {
    log?.('warn', 'model-network-probe-state-unavailable', {
      message: error instanceof Error ? error.message : String(error)
    })
    return undefined
  }
  const candidates = providers.filter(provider =>
    provider.enabled &&
    provider.baseUrl.trim().length > 0 &&
    provider.models.some(model => model.capabilities.chat)
  )
  const provider = candidates.find(candidate => Boolean(candidate.apiKey?.trim())) ?? candidates[0]
  if (!provider) return undefined
  const customHeaders: Record<string, string> = {}
  for (const header of provider.customHeaders ?? []) {
    if (header.value) customHeaders[header.name] = header.value
  }
  return {
    baseUrl: provider.baseUrl,
    ...(provider.apiKey?.trim() ? { apiKey: provider.apiKey.trim() } : {}),
    ...(Object.keys(customHeaders).length > 0 ? { customHeaders } : {})
  }
}
