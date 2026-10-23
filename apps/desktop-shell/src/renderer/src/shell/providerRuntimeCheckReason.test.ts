import { describe, expect, it } from 'vitest'

import { platformText } from '../i18n/platformText'

import {
  formatProviderRuntimeCheckReason,
  resolveProviderRuntimeCheckReasonCode
} from './providerRuntimeCheckReason'

const labels = platformText['en-US'].models
const base = { summary: '', providerEnabled: true, hasApiKey: true }

describe('PLAT-61 provider runtime check reason', () => {
  it('uses the probe failure code first', () => {
    expect(resolveProviderRuntimeCheckReasonCode({ ...base, status: 'unknown', summary: 'Connection failed.', failureCode: 'network_dns' }))
      .toBe('network_dns')
  })

  it('reports provider_disabled before any probe code', () => {
    expect(
      resolveProviderRuntimeCheckReasonCode({
        ...base,
        providerEnabled: false,
        status: 'unknown',
        summary: 'Connection failed.',
        failureCode: 'network_dns'
      })
    ).toBe('provider_disabled')
  })

  it('reports missing_api_key when no key is available', () => {
    expect(
      resolveProviderRuntimeCheckReasonCode({ ...base, hasApiKey: false, status: 'unknown', summary: 'Connection failed.' })
    ).toBe('missing_api_key')
  })

  it.each([
    ['401 status', 'auth-failed', 'HTTP 401', 'unauthorized'],
    ['403 summary', 'unknown', 'HTTP 403', 'unauthorized'],
    ['dns', 'network-error', 'getaddrinfo ENOTFOUND api.example.test', 'network_dns'],
    ['refused', 'network-error', 'connect ECONNREFUSED 127.0.0.1:443', 'network_refused'],
    ['timeout', 'timeout', 'The operation timed out', 'network_timeout'],
    ['tls', 'network-error', 'CERT_HAS_EXPIRED', 'tls_error'],
    ['proxy', 'network-error', 'proxy connection failed', 'proxy_error'],
    ['model', 'unknown', 'The model does not exist', 'model_not_found'],
    ['balance', 'unknown', 'Your account balance is insufficient', 'account_balance_insufficient'],
    ['http 429', 'unknown', 'HTTP 429', 'rate_limited'],
    ['overloaded', 'unknown', 'HTTP 429 · overloaded_error (1305)', 'rate_limited'],
    ['rate limit wording', 'unknown', 'The service may be temporarily overloaded', 'rate_limited'],
    [
      'retired model',
      'unknown',
      'HTTP 502 · upstream_error · Model deepseek-v3 has been retired on 2026-10-09 and is no longer available.',
      'model_retired'
    ],
    ['retired model (zh)', 'unknown', 'HTTP 502 · 该模型已下线，请更换模型', 'model_retired'],
    ['no available channel', 'unknown', 'HTTP 400 · no available channels', 'model_unavailable'],
    ['no available channel (zh)', 'unknown', 'HTTP 400 · 该模型当前无可用渠道', 'model_unavailable']
  ])('falls back to summary classification for old reports (%s)', (_name, status, summary, expected) => {
    expect(resolveProviderRuntimeCheckReasonCode({ ...base, status, summary })).toBe(expected)
  })

  it('prefers the model lifecycle probe code over the raw status wording', () => {
    expect(
      resolveProviderRuntimeCheckReasonCode({
        ...base,
        status: 'unknown',
        summary: 'HTTP 502 · Model deepseek-v3 has been retired on 2026-10-09',
        failureCode: 'model_retired'
      })
    ).toBe('model_retired')
    expect(
      resolveProviderRuntimeCheckReasonCode({ ...base, status: 'unknown', summary: 'HTTP 400', failureCode: 'model_unavailable' })
    ).toBe('model_unavailable')
  })

  it('maps gateway/model runtime statuses instead of falling back to unknown', () => {
    expect(resolveProviderRuntimeCheckReasonCode({ ...base, status: 'gateway-required', summary: 'Agent model gateway is disabled.' }))
      .toBe('gateway_disabled')
    expect(resolveProviderRuntimeCheckReasonCode({ ...base, status: 'model-not-enabled', summary: 'Model is not enabled for Claude Code agent runtime.' }))
      .toBe('model_runtime_disabled')
  })

  it('maps the protocol-unsupported status and legacy messages-protocol summaries', () => {
    expect(
      resolveProviderRuntimeCheckReasonCode({
        ...base,
        status: 'protocol-unsupported',
        summary: 'Provider endpoint did not satisfy Claude Code runtime protocol expectations.'
      })
    ).toBe('protocol_unsupported')
    expect(
      resolveProviderRuntimeCheckReasonCode({
        ...base,
        status: 'unknown',
        summary: 'HTTP 500 · 模型 glm-4.6 下无渠道支持messages协议，请注意使用的接口协议'
      })
    ).toBe('protocol_unsupported')
  })

  it('returns null for ready lanes and for undecidable summaries', () => {
    expect(resolveProviderRuntimeCheckReasonCode({ ...base, status: 'ready', summary: 'Connection succeeded.' })).toBeNull()
    expect(resolveProviderRuntimeCheckReasonCode({ ...base, status: 'unknown', summary: 'Connection failed.' })).toBeNull()
  })

  it('formats every code into a human sentence and http_<status> with the status number', () => {
    const cases: Array<[Parameters<typeof formatProviderRuntimeCheckReason>[0], string]> = [
      ['provider_disabled', labels.connectionCheckReasonProviderDisabled],
      ['missing_api_key', labels.connectionCheckReasonMissingApiKey],
      ['unauthorized', labels.connectionCheckReasonUnauthorized],
      ['http_401', labels.connectionCheckReasonUnauthorized],
      ['http_403', labels.connectionCheckReasonForbidden],
      ['http_404', labels.connectionCheckReasonNotFound],
      ['http_5xx', labels.connectionCheckReasonServerError],
      ['network_dns', labels.connectionCheckReasonDns],
      ['network_refused', labels.connectionCheckReasonRefused],
      ['network_timeout', labels.connectionCheckReasonTimeout],
      ['tls_error', labels.connectionCheckReasonTls],
      ['proxy_error', labels.connectionCheckReasonProxy],
      ['account_balance_insufficient', labels.connectionCheckReasonAccountBalance],
      ['rate_limited', labels.connectionCheckReasonRateLimited],
      ['http_429', labels.connectionCheckReasonRateLimited],
      ['protocol_unsupported', labels.connectionCheckReasonProtocolUnsupported],
      ['model_retired', labels.connectionCheckReasonModelRetired],
      ['model_unavailable', labels.connectionCheckReasonModelUnavailable],
      ['model_not_found', labels.connectionCheckReasonModelNotFound],
      ['invalid_response', labels.connectionCheckReasonInvalidResponse],
      ['gateway_disabled', labels.connectionCheckReasonGatewayDisabled],
      ['model_runtime_disabled', labels.connectionCheckReasonModelRuntimeDisabled],
      ['unknown', labels.connectionCheckReasonUnknown],
      ['http_500', labels.connectionCheckReasonHttp(500)]
    ]

    for (const [code, expected] of cases) {
      const text = formatProviderRuntimeCheckReason(code, labels)
      expect(text, String(code)).toBe(expected)
      expect(text, String(code)).not.toBe('Connection failed.')
    }
    expect(formatProviderRuntimeCheckReason(null, labels)).toBeNull()
    expect(formatProviderRuntimeCheckReason('http_418', labels)).toBe(labels.connectionCheckReasonHttp(418))
  })
})
