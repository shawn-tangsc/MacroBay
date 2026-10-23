export const capitalConditionsTransportPolicy = Object.freeze({
  stablecoinEndpoint: 'https://stablecoins.llama.fi/stablecoins',
  stablecoinHistoryEndpoint: 'https://stablecoins.llama.fi/stablecoincharts/all',
  maximumResponseBytes: 1_024 * 1_024,
  stablecoinHistoryMaximumResponseBytes: 2 * 1024 * 1024,
  requestInit: Object.freeze({
    method: 'GET',
    redirect: 'manual' as const,
    headers: Object.freeze({ accept: 'application/json' })
  }),
  acceptedContentType: 'application/json'
})

export type CapitalConditionsPlatformFetch = (input: string, init: RequestInit) => Promise<Response>

export type CapitalConditionsHttpResult =
  | Readonly<{ state: 'available'; payload: unknown; acceptedBytes: number }>
  | Readonly<{ state: 'unavailable'; reason: 'response-body-too-large' | 'response-unavailable' }>

export function createCapitalConditionsHttpClient(deps: { platformFetch?: CapitalConditionsPlatformFetch }) {
  return {
    async requestStablecoinPayload(): Promise<CapitalConditionsHttpResult> {
      return request(deps.platformFetch, capitalConditionsTransportPolicy.stablecoinEndpoint, capitalConditionsTransportPolicy.maximumResponseBytes)
    },
    async requestStablecoinHistoryPayload(): Promise<CapitalConditionsHttpResult> {
      return request(deps.platformFetch, capitalConditionsTransportPolicy.stablecoinHistoryEndpoint, capitalConditionsTransportPolicy.stablecoinHistoryMaximumResponseBytes)
    }
  }
}

async function request(platformFetch: CapitalConditionsPlatformFetch | undefined, endpoint: string, maximumResponseBytes: number): Promise<CapitalConditionsHttpResult> {
      if (!platformFetch) return unavailable('response-unavailable')
      try {
        const response = await platformFetch(
          endpoint,
          capitalConditionsTransportPolicy.requestInit
        )
        if (response.status !== 200 || response.redirected || !isJsonResponse(response)) {
          await cancel(response.body)
          return unavailable('response-unavailable')
        }
        const declaredLength = parseContentLength(response.headers.get('content-length'))
        if (declaredLength === 'invalid' || (typeof declaredLength === 'number' && declaredLength > maximumResponseBytes)) {
          await cancel(response.body)
          return unavailable('response-body-too-large')
        }
        const body = await readBoundedJson(response.body, maximumResponseBytes)
        if (!body) return unavailable('response-unavailable')
        if (body.state === 'too-large') return unavailable('response-body-too-large')
        return Object.freeze({ state: 'available' as const, payload: body.payload, acceptedBytes: body.acceptedBytes })
      } catch {
        return unavailable('response-unavailable')
      }
}

async function readBoundedJson(body: ReadableStream<Uint8Array> | null, maximumResponseBytes: number): Promise<
  | Readonly<{ state: 'available'; payload: unknown; acceptedBytes: number }>
  | Readonly<{ state: 'too-large' }>
  | undefined
> {
  if (!body) return undefined
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let acceptedBytes = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      const chunk = next.value
      if (!(chunk instanceof Uint8Array) || acceptedBytes + chunk.byteLength > maximumResponseBytes) {
        await reader.cancel()
        return Object.freeze({ state: 'too-large' as const })
      }
      chunks.push(chunk)
      acceptedBytes += chunk.byteLength
    }
    const bytes = new Uint8Array(acceptedBytes)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return Object.freeze({ state: 'available' as const, payload: JSON.parse(text) as unknown, acceptedBytes })
  } catch {
    await reader.cancel().catch(() => undefined)
    return undefined
  } finally {
    reader.releaseLock()
  }
}

function isJsonResponse(response: Response): boolean {
  return response.headers.get('content-type')?.toLowerCase().split(';', 1)[0] === capitalConditionsTransportPolicy.acceptedContentType
}

function parseContentLength(value: string | null): number | 'invalid' | undefined {
  if (value === null) return undefined
  return /^(?:0|[1-9][0-9]*)$/.test(value) ? Number(value) : 'invalid'
}

async function cancel(body: ReadableStream<Uint8Array> | null): Promise<void> {
  await body?.cancel().catch(() => undefined)
}

function unavailable(reason: Extract<CapitalConditionsHttpResult, { state: 'unavailable' }>['reason']): Extract<CapitalConditionsHttpResult, { state: 'unavailable' }> {
  return Object.freeze({ state: 'unavailable', reason })
}
