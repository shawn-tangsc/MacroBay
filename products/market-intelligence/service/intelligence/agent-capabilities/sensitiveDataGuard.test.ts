import { describe, expect, it } from 'vitest'

import { ProductToolGuardError } from './capabilityTypes'
import { guardProductToolOutput } from './sensitiveDataGuard'

function nest(level: number): unknown {
  let value: unknown = 'leaf'
  for (let index = 0; index < level; index += 1) value = { child: value }
  return value
}

describe('guardProductToolOutput', () => {
  it('blocks a blocked key and never echoes the value in the message', () => {
    try {
      guardProductToolOutput({ sourceId: 'source-a', apiKey: 'sk-test' })
      throw new Error('expected guardProductToolOutput to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(ProductToolGuardError)
      const guardError = error as ProductToolGuardError
      expect(guardError.code).toBe('sensitive-output-blocked')
      expect(guardError.message).not.toContain('sk-test')
      expect(String(guardError)).not.toContain('sk-test')
    }
  })

  it.each(['APIKEY', 'api_key', 'clientSecret', 'authorization', 'Set-Cookie', 'headers', 'ciphertext'])(
    'blocks the key %s at any depth',
    (key) => {
      expect(() => guardProductToolOutput({ nested: [{ [key]: 'value' }] })).toThrowError(
        expect.objectContaining({ code: 'sensitive-output-blocked' })
      )
    }
  )

  it('allows a bare credential key because credentialStatus is a legitimate field', () => {
    const value = { credential: { hasCredential: true }, credentialStatus: { hasCredential: false } }
    expect(guardProductToolOutput(value)).toEqual(value)
  })

  it('strips projection-only keys instead of failing', () => {
    expect(
      guardProductToolOutput({
        sourceId: 'source-a',
        credentialRef: 'vault://source-a',
        maskedPreview: 'sk-…',
        sourceSpecificConfigJson: '{}',
        localPath: '/Users/alice/data',
        filePath: 'data.json'
      })
    ).toEqual({ sourceId: 'source-a' })
  })

  it('throws beyond depth 32 and keeps a payload at depth 32', () => {
    expect(() => guardProductToolOutput(nest(33))).toThrowError(expect.objectContaining({ code: 'output-too-deep' }))
    expect(() => guardProductToolOutput(nest(32))).not.toThrow()
  })

  it('returns a deep clone so stripping does not mutate the input', () => {
    const original = { sourceId: 'source-a', credentialRef: 'vault://source-a', counts: { items: 2 } }
    const guarded = guardProductToolOutput(original)

    expect(guarded).toEqual({ sourceId: 'source-a', counts: { items: 2 } })
    expect(guarded).not.toBe(original)
    expect(original.credentialRef).toBe('vault://source-a')
  })

  it('keeps a legitimate nested payload unchanged', () => {
    const payload = {
      state: 'available',
      revision: 'abcdef123456',
      focusMarkets: { enabledFocusMarkets: ['CN', 'US'] },
      sources: [
        {
          sourceId: 'source-a',
          enabled: true,
          credentialStatus: { hasCredential: true, lastValidatedAt: '2026-07-01T00:00:00.000Z' },
          monitoredSymbols: ['BTCUSDT', 'ETHUSDT']
        }
      ],
      caveats: ['partial coverage'],
      counts: { items: 3, total: 10, ratio: 0.3, verbose: false, nothing: null }
    }

    expect(guardProductToolOutput(payload)).toEqual(payload)
  })

  it('redacts absolute paths, bearer tokens and secret URL parameters', () => {
    expect(guardProductToolOutput({ note: '/Users/alice/reports/private.csv' })).toEqual({ note: '<path>' })
    expect(guardProductToolOutput({ note: 'C:\\Users\\alice\\private.csv' })).toEqual({ note: '<path>' })
    expect(guardProductToolOutput({ note: 'Bearer abcdefghijkl' })).toEqual({ note: '<redacted>' })
    expect(guardProductToolOutput({ note: 'Basic dXNlcjpwYXNz' })).toEqual({ note: '<redacted>' })
    expect(guardProductToolOutput({ note: 'sk-abcdefgh1234' })).toEqual({ note: '<redacted>' })
    expect(guardProductToolOutput({ note: 'https://example.test/x?token=abcdef&limit=2' })).toEqual({
      note: 'https://example.test/x?token=<redacted>&limit=2'
    })
  })

  it('composes sanitizeSafeView and converts its rejection into a guard error', () => {
    expect(() => guardProductToolOutput({ note: 'loaded with apiKey=abcdefgh' })).toThrowError(
      expect.objectContaining({ code: 'sensitive-output-blocked' })
    )
  })
})
