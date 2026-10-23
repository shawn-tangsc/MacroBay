import { getPlatformFetch } from '@platform/network/platformFetch'
import { realMarketApiPolicy, type RealMarketApiFailureCode } from './realMarketApiPolicy'

/**
 * The licensed provider's transport, shared by every instrument this product reads from it.
 *
 * The key rides in the query string, so a URL is credential material: a failure never escapes as a
 * thrown error and never reaches a log line — the catch below collapses it to a code, and the caller
 * is only ever handed `failureCode`. That is why the collector takes a `(url) => result` function
 * rather than a client it could log from.
 */
export type RealMarketApiTransport = (url: string) => Promise<
  | Readonly<{ state: 'ok'; status: number; body: unknown }>
  | Readonly<{ state: 'unavailable'; failureCode: RealMarketApiFailureCode }>>

export function createRealMarketApiTransport(fetchImpl: typeof fetch = getPlatformFetch()): RealMarketApiTransport {
  return async url => {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(realMarketApiPolicy.timeoutMs) })
      const text = await response.text()
      if (text.length > realMarketApiPolicy.maxBodyBytes) return { state: 'unavailable', failureCode: 'response-invalid' }
      return { state: 'ok', status: response.status, body: JSON.parse(text) as unknown }
    } catch {
      return { state: 'unavailable', failureCode: 'transport-unavailable' }
    }
  }
}
