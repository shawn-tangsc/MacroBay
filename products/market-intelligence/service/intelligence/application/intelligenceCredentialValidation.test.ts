import { describe, expect, it, vi } from 'vitest'

import { httpRequest } from '@platform/jobs'

import { validateIntelligenceCredential } from './intelligenceCredentialValidation'

vi.mock('@platform/jobs', async () => {
  const actual = await vi.importActual<typeof import('@platform/jobs')>('@platform/jobs')
  return {
    ...actual,
    httpRequest: vi.fn()
  }
})

const mockedHttpRequest = vi.mocked(httpRequest)

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
    mockedHttpRequest.mockResolvedValueOnce({ status: 200, bodyText: '{}' })

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
    mockedHttpRequest.mockResolvedValueOnce({ status: 200, bodyText: '{}' })

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
    mockedHttpRequest.mockResolvedValueOnce({ status: 403, bodyText: 'forbidden' })

    await expect(
      validateIntelligenceCredential({ sourceId: 'github-releases', apiKey: 'bad-token' })
    ).resolves.toEqual({
      ok: false,
      message: 'Credential rejected by provider (HTTP 403).'
    })
  })
})
