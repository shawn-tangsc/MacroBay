import { describe, expect, it, vi } from 'vitest'

import { createCredentialedProviderProbes, narwhalOutcome } from './credentialedProviderProbes'
import { narwhalCalendarProbeUrl, narwhalSourcePolicy } from './narwhalSourcePolicy'

/**
 * Narwhal 探针只回答一件事：这个 key 现在能不能用。
 *
 * 四个状态码必须分出四句话——`401` 填错、`402` 本月额度用尽、`403` 订阅不含、`429` 限速。
 * 全都报「连接失败」的话，读者改不了、我们也查不出问题在哪。
 */
function probeWith(respond: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const probes = createCredentialedProviderProbes({
    platformFetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} })
      return respond(String(input), init ?? {})
    }) as typeof fetch
  })
  return { probe: probes.get(narwhalSourcePolicy.sourceId)!, calls }
}

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('narwhal probe', () => {
  it('sends the key in the Authorization header and never in the URL', async () => {
    const { probe, calls } = probeWith(() => jsonResponse(200, { data: [] }))
    await probe.probe('sk-test-value')
    const [call] = calls
    expect(call).toBeDefined()
    expect(call!.url).not.toContain('sk-test-value')
    expect(call!.url.startsWith('https://api.narwhalapi.com/v1/economics/calendar?')).toBe(true)
    expect(call!.url).toContain('countries=USA')
    const headers = call!.init.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer sk-test-value')
  })

  it('probes one country over a two-day window', () => {
    const url = new URL(narwhalCalendarProbeUrl(new Date('2026-11-13T04:00:00.000Z')))
    expect(url.searchParams.get('start_date')).toBe('2026-11-13')
    expect(url.searchParams.get('end_date')).toBe('2026-11-14')
  })

  it('answers success for a JSON object or array', async () => {
    await expect(probeWith(() => jsonResponse(200, { data: [] })).probe.probe('k')).resolves.toEqual({ state: 'succeeded' })
    await expect(probeWith(() => jsonResponse(200, [])).probe.probe('k')).resolves.toEqual({ state: 'succeeded' })
  })

  it('separates the four refusals instead of calling them all a connection failure', () => {
    expect(narwhalOutcome(401)).toEqual({ state: 'failed', failureCode: 'credential-invalid' })
    expect(narwhalOutcome(402)).toEqual({ state: 'failed', failureCode: 'credits-exhausted' })
    expect(narwhalOutcome(403)).toEqual({ state: 'failed', failureCode: 'plan-restricted' })
    expect(narwhalOutcome(429)).toEqual({ state: 'failed', failureCode: 'rate-limited' })
    expect(narwhalOutcome(500)).toEqual({ state: 'failed', failureCode: 'response-unavailable' })
    expect(narwhalOutcome(200)).toBeUndefined()
  })

  it('never reports an exhausted quota as a restricted plan', () => {
    // 这两句在界面上是两句话：「本月额度已用尽」≠「当前套餐不允许访问这个接口」。
    expect(narwhalOutcome(402)).not.toEqual(narwhalOutcome(403))
  })

  it('reports an unreadable answer as unavailable, not as success', async () => {
    const html = () => new Response('<html>blocked</html>', { status: 200 })
    await expect(probeWith(html).probe.probe('k')).resolves.toEqual({ state: 'failed', failureCode: 'response-unavailable' })
  })

  it('reports a transport failure as unavailable', async () => {
    const { probe } = probeWith(() => { throw new Error('offline') })
    await expect(probe.probe('k')).resolves.toEqual({ state: 'failed', failureCode: 'transport-unavailable' })
  })

  it('refuses a malformed draft before spending a request', async () => {
    const spy = vi.fn(() => jsonResponse(200, { data: [] }))
    const probes = createCredentialedProviderProbes({ platformFetch: spy as unknown as typeof fetch })
    const probe = probes.get(narwhalSourcePolicy.sourceId)!
    expect(probe.isValidCredentialShape('   ')).toBe(false)
    expect(probe.isValidCredentialShape('sk-with-space\u0000inside')).toBe(false)
    expect(probe.isValidCredentialShape('sk-ok')).toBe(true)
    expect(spy).not.toHaveBeenCalled()
  })
})
