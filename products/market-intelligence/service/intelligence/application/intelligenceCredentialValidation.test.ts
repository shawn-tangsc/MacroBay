import { describe, expect, it, vi } from 'vitest'

import { httpRequest, type HttpClientResponse } from '@platform/jobs'

import { validateIntelligenceCredential } from './intelligenceCredentialValidation'

// The application injects the platform's proxy-aware fetch at startup. Tests never reach the
// network, so a stub stands in for it — the point is that the module boundary stays real and no
// silent fallback to the global fetch can creep back in.
vi.mock('@platform/network/platformFetch', () => ({
  getPlatformFetch: () => (async () => new Response('', { status: 200 })) as unknown as typeof fetch
}))

vi.mock('@platform/jobs', async () => {
  const actual = await vi.importActual<typeof import('@platform/jobs')>('@platform/jobs')
  return {
    ...actual,
    httpRequest: vi.fn()
  }
})

const mockedHttpRequest = vi.mocked(httpRequest)

/** A complete transport answer: the probe only reads `status` and `bodyText`, but the type carries all four. */
function answer(status: number, bodyText: string): HttpClientResponse {
  return { status, bodyText, headers: {}, byteSize: bodyText.length }
}

describe('validateIntelligenceCredential', () => {
  it('rejects empty credentials', async () => {
    await expect(
      validateIntelligenceCredential({ sourceId: 'fred-rates-liquidity', apiKey: '   ' })
    ).resolves.toEqual({
      ok: false,
      message: 'Credential is required.'
    })
  })

  it('verifies fred-rates-liquidity with api_key on the canonical probe request', async () => {
    mockedHttpRequest.mockResolvedValueOnce(answer(200, '{}'))

    await expect(
      validateIntelligenceCredential({ sourceId: 'fred-rates-liquidity', apiKey: 'demo-key' })
    ).resolves.toEqual({
      ok: true,
      message: 'Credential verified with provider.'
    })

    expect(mockedHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringMatching(/api_key=demo-key/)
      }),
      expect.any(Object)
    )
    expect(mockedHttpRequest.mock.calls[0]?.[0]?.url).toContain('series_id=DGS2')
  })

  it('verifies bea-economic-series with UserID on the probe request', async () => {
    mockedHttpRequest.mockResolvedValueOnce(answer(200, '{}'))

    await expect(
      validateIntelligenceCredential({ sourceId: 'bea-economic-series', apiKey: 'bea-user' })
    ).resolves.toEqual({
      ok: true,
      message: 'Credential verified with provider.'
    })

    expect(mockedHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: expect.stringMatching(/UserID=bea-user/)
      }),
      expect.any(Object)
    )
  })

  it('returns provider rejection messages for failed checks', async () => {
    mockedHttpRequest.mockResolvedValueOnce(answer(403, 'forbidden'))

    await expect(
      validateIntelligenceCredential({ sourceId: 'github-releases', apiKey: 'bad-token' })
    ).resolves.toEqual({
      ok: false,
      message: 'Credential rejected by provider (HTTP 403).'
    })
  })
})
