import { describe, expect, it } from 'vitest'

import { redactJobLogEntry, redactSecretsInValue } from './logRedaction'

describe('logRedaction', () => {
  it('redacts api keys and secrets from log messages', () => {
    const redacted = redactJobLogEntry({
      level: 'info',
      message: 'apiKey=abc123 apiSecret=super-secret signature=deadbeef'
    })

    expect(redacted.message).not.toContain('super-secret')
    expect(redacted.message).not.toContain('abc123')
    expect(redacted.message).toContain('[REDACTED]')
  })

  it('redacts sensitive metadata fields', () => {
    const redacted = redactJobLogEntry({
      level: 'error',
      message: 'request failed',
      metadata: {
        apiKey: 'key-1',
        headers: {
          'X-MBX-APIKEY': 'visible-key'
        },
        weight: 12
      }
    })

    expect(redacted.metadata?.apiKey).toBe('[REDACTED]')
    expect((redacted.metadata?.headers as Record<string, string>)['X-MBX-APIKEY']).toBe('[REDACTED]')
    expect(redacted.metadata?.weight).toBe(12)
  })

  it('applies product redact hook after platform redaction', () => {
    const redacted = redactJobLogEntry(
      {
        level: 'info',
        message: 'connection abc',
        metadata: { token: 'secret-token', count: 2 }
      },
      (value) => {
        if (!value || typeof value !== 'object') return value
        const metadata = (value as { metadata?: Record<string, unknown> }).metadata
        if (!metadata) return value
        return {
          ...(value as Record<string, unknown>),
          metadata: {
            ...metadata,
            token: metadata.token ? 'masked' : metadata.token
          }
        }
      }
    )

    expect(redacted.metadata?.token).toBe('masked')
    expect(redacted.metadata?.count).toBe(2)
  })

  it('redacts nested secret values in arbitrary objects', () => {
    const redacted = redactSecretsInValue({
      credentials: {
        apiSecret: 'hidden'
      },
      safe: 'value'
    })

    expect((redacted as { credentials: { apiSecret: string } }).credentials.apiSecret).toBe('[REDACTED]')
    expect((redacted as { safe: string }).safe).toBe('value')
  })
})
