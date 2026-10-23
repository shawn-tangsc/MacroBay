import { describe, expect, it } from 'vitest'

import type { ProviderRuntimeCheckReport } from '@platform/ai/agent-platform/runtime/compatibility/providerRuntimeCheckTypes'

import { platformText } from '../i18n/platformText'

import {
  buildProviderRuntimeCheckDisplay,
  type ProviderRuntimeCheckDisplayLabels
} from './providerRuntimeCheckDisplay'

const models = platformText['en-US'].models

const labels: ProviderRuntimeCheckDisplayLabels = {
  ordinaryChat: models.connectionCheckOrdinaryChat,
  direct: models.connectionCheckDirect,
  gateway: models.connectionCheckGateway,
  final: models.connectionCheckFinal,
  ready: models.connectionCheckAgentReady,
  notReady: models.connectionCheckAgentNotReady,
  checking: models.connectionCheckStart,
  mixed: models.connectionCheckAgentMixed,
  reasons: models,
  detailPrefix: models.connectionCheckDetailPrefix,
  irrelevantHint: models.connectionCheckIrrelevantHint,
  gatewayDisabledHint: models.connectionCheckGatewayDisabledHint
}

function createReport(overrides: Partial<ProviderRuntimeCheckReport> = {}): ProviderRuntimeCheckReport {
  return {
    providerId: 'deepseek',
    modelId: 'deepseek-chat',
    runtimeId: 'claude-code',
    ordinaryChat: {
      lane: 'ordinary-chat',
      status: 'ready',
      summary: 'Connection succeeded.'
    },
    direct: {
      lane: 'claude-code-direct',
      status: 'auth-failed',
      summary: 'Direct Claude Code authentication failed.',
      route: 'direct'
    },
    gateway: {
      lane: 'claude-code-gateway',
      status: 'gateway-required',
      summary: 'Agent model gateway is disabled.',
      route: 'gateway'
    },
    finalCompatibility: {
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      runtimeId: 'claude-code',
      selectable: false,
      route: 'none',
      status: 'auth-failed',
      summary: 'Direct Claude Code authentication failed.'
    },
    updatedAt: '2026-07-10T00:00:00.000Z',
    signature: 'sig',
    ...overrides
  }
}

describe('buildProviderRuntimeCheckDisplay', () => {
  it('turns a failed ordinary chat into a decidable reason plus the raw message as detail', () => {
    const display = buildProviderRuntimeCheckDisplay(
      createReport({
        ordinaryChat: {
          lane: 'ordinary-chat',
          status: 'auth-failed',
          summary: 'HTTP 401',
          failureCode: 'http_401'
        },
        finalCompatibility: {
          providerId: 'deepseek',
          modelId: 'deepseek-chat',
          runtimeId: 'claude-code',
          selectable: false,
          route: 'none',
          status: 'auth-failed',
          summary: 'Authentication failed.'
        }
      }),
      labels
    )

    const ordinary = display.lanes[0]
    expect(ordinary?.reason).toBe(models.connectionCheckReasonUnauthorized)
    expect(ordinary?.detail).toBe('HTTP 401')
    expect(ordinary?.summary).toBe('HTTP 401')
    expect(ordinary?.hint).toBeNull()
  })

  /**
   * PLAT-66：停用时主文案只能是一句「先启用」，**不得**把上游 message 用「。：」拼在后面
   * （实测：`供应商当前是停用状态…。：Model deepseek-v3 has been retired…`），也保留任何原始信息。
   */
  it('keeps only the provider-disabled sentence on every lane, with no upstream text mixed in', () => {
    const retired = 'Model deepseek-v3 has been retired on 2026-10-09 and is no longer available.'
    const display = buildProviderRuntimeCheckDisplay(
      createReport({
        ordinaryChat: {
          lane: 'ordinary-chat',
          status: 'unknown',
          summary: `HTTP 502 · upstream_error · ${retired}`,
          failureCode: 'http_5xx',
          upstreamMessage: retired
        },
        direct: {
          lane: 'claude-code-direct',
          status: 'unknown',
          summary: `HTTP 502 · upstream_error · ${retired}`,
          route: 'direct'
        },
        finalCompatibility: {
          providerId: 'deepseek',
          modelId: 'deepseek-chat',
          runtimeId: 'claude-code',
          selectable: false,
          route: 'none',
          status: 'provider-disabled',
          summary: retired
        }
      }),
      labels,
      { providerEnabled: false, hasApiKey: true }
    )

    for (const lane of display.lanes) {
      expect(lane.reasonCode, lane.key).toBe('provider_disabled')
      expect(lane.reason, lane.key).toBe(models.connectionCheckReasonProviderDisabled)
      expect(lane.detail, lane.key).toBeNull()
      expect(lane.upstreamMessage, lane.key).toBeNull()
      // 停用只是「还没启用」，不是错误；也不该给「不影响普通聊天」这种误导性提示。
      expect(lane.tone, lane.key).toBe('warning')
      expect(lane.hint, lane.key).toBeNull()
    }
    expect(display.overallTone).toBe('warning')
    expect(display.overallMessage).toBe(models.connectionCheckReasonProviderDisabled)
    const rendered = display.lanes.map((lane) => `${lane.reason ?? ''} ${lane.detail ?? ''}`).join(' ')
    expect(rendered).not.toContain('retired')
    expect(rendered).not.toContain('HTTP 5')
  })

  it('keeps ordinary chat before the two Claude Code lanes so the main path is read first', () => {
    const display = buildProviderRuntimeCheckDisplay(createReport(), labels)
    const keys = display.lanes.map((lane) => lane.key)

    expect(keys.indexOf('ordinaryChat')).toBeLessThan(keys.indexOf('direct'))
    expect(keys.indexOf('ordinaryChat')).toBeLessThan(keys.indexOf('gateway'))
  })

  it('shows rate limiting as a human reason for ordinary chat instead of the status-code hint', () => {
    const display = buildProviderRuntimeCheckDisplay(
      createReport({
        ordinaryChat: {
          lane: 'ordinary-chat',
          status: 'unknown',
          summary: 'HTTP 429 · The service may be temporarily overloaded',
          failureCode: 'rate_limited',
          upstreamMessage: 'The service may be temporarily overloaded'
        },
        direct: undefined,
        gateway: undefined
      }),
      labels
    )

    const ordinary = display.lanes[0]
    expect(ordinary?.reasonCode).toBe('rate_limited')
    expect(ordinary?.reason).toContain(models.connectionCheckReasonRateLimited)
    expect(ordinary?.reason).not.toContain(models.connectionCheckReasonHttp(429))
    expect(ordinary?.reason).not.toContain(models.connectionCheckReasonUnknown)
  })

  it('renders a summarized compatibility-check detail without raw JSON', () => {
    const detail =
      'HTTP 429 · overloaded_error (1305) · The service may be temporarily overloaded · request_id req_abc123'
    const display = buildProviderRuntimeCheckDisplay(
      createReport({
        direct: {
          lane: 'claude-code-direct',
          status: 'unknown',
          summary: detail,
          failureCode: 'rate_limited',
          route: 'direct'
        }
      }),
      labels
    )

    const direct = display.lanes.find((lane) => lane.key === 'direct')
    expect(direct?.reasonCode).toBe('rate_limited')
    expect(direct?.reason).toContain(models.connectionCheckReasonRateLimited)
    expect(direct?.reason).not.toContain(models.connectionCheckReasonUnknown)
    expect(direct?.detail).toContain('overloaded_error')
    expect(direct?.detail).toContain('request_id')
    expect(direct?.detail).not.toContain('{"')
    expect(direct?.detail).not.toContain('"type":"error"')
  })

  it('renders the Responses endpoint lane right after ordinary chat with the endpoint verdict', () => {
    const display = buildProviderRuntimeCheckDisplay(
      createReport({
        responses: { verdict: 'exists_auth_failed', status: 401, message: 'HTTP 401 · invalid key' }
      }),
      labels
    )
    const keys = display.lanes.map((lane) => lane.key)
    const responses = display.lanes.find((lane) => lane.key === 'responses')

    expect(keys.indexOf('responses')).toBe(keys.indexOf('ordinaryChat') + 1)
    expect(responses?.title).toBe(models.requestConfigResponses)
    expect(responses?.reason).toBe(models.endpointTestExistsAuthFailed)
    expect(responses?.detail).toBe('HTTP 401 · invalid key')
    expect(responses?.tone).toBe('warning')
  })

  it('renders the Gemini native lane after the Responses lane', () => {
    const display = buildProviderRuntimeCheckDisplay(
      createReport({
        responses: { verdict: 'available', status: 200 },
        gemini: { verdict: 'exists_param_error', status: 400, message: 'HTTP 400 · bad contents' }
      }),
      labels
    )
    const keys = display.lanes.map((lane) => lane.key)
    const gemini = display.lanes.find((lane) => lane.key === 'gemini')

    expect(keys.indexOf('responses')).toBe(keys.indexOf('ordinaryChat') + 1)
    expect(keys.indexOf('gemini')).toBe(keys.indexOf('responses') + 1)
    expect(gemini?.title).toBe(models.connectionCheckGeminiNative)
    expect(gemini?.reason).toBe(models.endpointTestExistsParamError)
    expect(gemini?.detail).toBe('HTTP 400 · bad contents')
    expect(gemini?.tone).toBe('warning')
  })

  it('puts a Gemini-only lane right after ordinary chat', () => {
    const display = buildProviderRuntimeCheckDisplay(
      createReport({ gemini: { verdict: 'missing', status: 404 } }),
      labels
    )
    const keys = display.lanes.map((lane) => lane.key)

    expect(keys.indexOf('gemini')).toBe(keys.indexOf('ordinaryChat') + 1)
    expect(keys).not.toContain('responses')
  })

  it('does not render a Gemini lane when the endpoint is not configured', () => {
    const display = buildProviderRuntimeCheckDisplay(createReport(), labels)

    expect(display.lanes.some((lane) => lane.key === 'gemini')).toBe(false)
  })

  it('does not render a Responses lane when the endpoint is not configured', () => {
    const display = buildProviderRuntimeCheckDisplay(createReport(), labels)

    expect(display.lanes.some((lane) => lane.key === 'responses')).toBe(false)
  })

  it('uses the Chinese rate-limit sentence in the main line (and no status-code hint) for a 429', () => {
    const zhModels = platformText['zh-CN'].models
    const detail =
      'HTTP 429 · overloaded_error (1305) · The service may be temporarily overloaded · request_id req_abc123'
    const display = buildProviderRuntimeCheckDisplay(
      createReport({
        direct: {
          lane: 'claude-code-direct',
          status: 'unknown',
          summary: detail,
          failureCode: 'rate_limited',
          route: 'direct'
        }
      }),
      { ...labels, reasons: zhModels }
    )

    const direct = display.lanes.find((lane) => lane.key === 'direct')
    expect(direct?.reason).toContain('限流')
    expect(direct?.reason).not.toContain('请按状态码排查')
    expect(direct?.reason).not.toContain('原因无法判定')
    expect(direct?.detail).toContain('overloaded_error')
    expect(direct?.detail).toContain('request_id req_abc123')
  })
})

describe('PLAT-66 providers without an anthropic endpoint', () => {
  it('does not report an anthropic protocol failure and stays informational', () => {
    const report = {
      version: 1,
      providerId: 'gemini',
      modelId: 'gemini-3.5-flash',
      runtimeId: 'claude-code',
      checkedAt: '2026-10-19T10:00:00.000Z',
      ordinaryChat: { status: 'ready', summary: 'chat ok' },
      finalCompatibility: { status: 'unknown', summary: 'needs anthropic endpoint' }
    } as unknown as Parameters<typeof buildProviderRuntimeCheckDisplay>[0]

    const display = buildProviderRuntimeCheckDisplay(report, labels, {
      providerEnabled: true,
      hasApiKey: true
    })

    expect(display.lanes.some((lane) => lane.key === 'direct' || lane.key === 'gateway')).toBe(false)
    expect(display.lanes.some((lane) => lane.reasonCode === 'protocol_unsupported')).toBe(false)
    expect(display.lanes.at(-1)?.summary).toBe(labels.reasons.connectionCheckAgentNeedsAnthropicEndpoint)
    expect(display.lanes.at(-1)?.tone).toBe('warning')
  })
})
