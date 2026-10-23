import { describe, expect, it } from 'vitest'

import type { ProviderRuntimeCheckReport } from '@platform/ai/agent-platform/runtime/compatibility/providerRuntimeCheckTypes'

import { platformText } from '../i18n/platformText'

import {
  buildProviderRuntimeCheckDisplay,
  type ProviderRuntimeCheckDisplayLabels
} from './providerRuntimeCheckDisplay'

/**
 * PLAT-66：模型生命周期失败的**展示**（从 `providerRuntimeCheckDisplay.test.ts` 拆出，保持 <300 行）。
 *  - 停用时所有 lane（含 Responses / Gemini）只能出「先启用」，不允许带上游 message；
 *  - 启用后 502 +「has been retired」要给「已下线」，而不是「按 HTTP 状态码排查」。
 */
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
    providerId: 'qiniu',
    modelId: 'deepseek-v3',
    runtimeId: 'claude-code',
    ordinaryChat: {
      lane: 'ordinary-chat',
      status: 'ready',
      summary: 'Connection succeeded.'
    },
    finalCompatibility: {
      providerId: 'qiniu',
      modelId: 'deepseek-v3',
      runtimeId: 'claude-code',
      selectable: false,
      route: 'none',
      status: 'auth-failed',
      summary: 'Direct Claude Code authentication failed.'
    },
    updatedAt: '2026-10-19T00:00:00.000Z',
    signature: 'sig',
    ...overrides
  }
}

describe('PLAT-66 连接检查的模型生命周期展示', () => {
  it('does not let the Responses / Gemini endpoint lanes bypass the provider-disabled conclusion', () => {
    const display = buildProviderRuntimeCheckDisplay(
      createReport({
        ordinaryChat: { lane: 'ordinary-chat', status: 'unknown', summary: 'Connection failed.' },
        responses: { verdict: 'exists_auth_failed', status: 401, message: 'HTTP 401 · invalid key' },
        gemini: { verdict: 'missing', status: 404 }
      }),
      labels,
      { providerEnabled: false, hasApiKey: true }
    )

    const responses = display.lanes.find((lane) => lane.key === 'responses')
    const gemini = display.lanes.find((lane) => lane.key === 'gemini')
    for (const lane of [responses, gemini]) {
      expect(lane?.reasonCode).toBe('provider_disabled')
      expect(lane?.reason).toBe(models.connectionCheckReasonProviderDisabled)
      expect(lane?.detail).toBeNull()
      expect(lane?.tone).toBe('warning')
    }
  })

  /**
   * PLAT-66：供应商启用后，502 + 「has been retired」必须给出「已下线」的结论，
   * 而不是「供应商返回 HTTP 502，请按状态码排查」。
   */
  it('turns a 502 + retired model response into the retired-model conclusion instead of an HTTP status hint', () => {
    const zhModels = platformText['zh-CN'].models
    const retired = 'Model deepseek-v3 has been retired on 2026-10-09 and is no longer available. Please use another model.'
    const display = buildProviderRuntimeCheckDisplay(
      createReport({
        ordinaryChat: {
          lane: 'ordinary-chat',
          status: 'unknown',
          summary: `HTTP 502 · upstream_error · ${retired}`,
          failureCode: 'model_retired',
          upstreamMessage: retired
        },
        direct: {
          lane: 'claude-code-direct',
          status: 'unknown',
          summary: `HTTP 502 · upstream_error · ${retired}`,
          route: 'direct'
        }
      }),
      { ...labels, reasons: zhModels }
    )

    const ordinary = display.lanes[0]
    const direct = display.lanes.find((lane) => lane.key === 'direct')
    expect(ordinary?.reasonCode).toBe('model_retired')
    expect(ordinary?.reason).toContain(zhModels.connectionCheckReasonModelRetired)
    expect(ordinary?.reason).not.toContain('HTTP 5')
    // 直连探针只带一行 summary（没有 failureCode），也要靠兜底识别出「已下线」。
    expect(direct?.reasonCode).toBe('model_retired')
    expect(direct?.reason).toContain('已下线')
    expect(direct?.reason).not.toContain('HTTP 5')
  })

  it('turns a 400 + "no available channels" response into the model-unavailable conclusion', () => {
    const zhModels = platformText['zh-CN'].models
    const display = buildProviderRuntimeCheckDisplay(
      createReport({
        ordinaryChat: {
          lane: 'ordinary-chat',
          status: 'unknown',
          summary: 'HTTP 400 · no available channels for this model',
          failureCode: 'model_unavailable'
        }
      }),
      { ...labels, reasons: zhModels }
    )

    const ordinary = display.lanes[0]
    expect(ordinary?.reasonCode).toBe('model_unavailable')
    expect(ordinary?.reason).toContain(zhModels.connectionCheckReasonModelUnavailable)
    expect(ordinary?.reason).not.toContain('HTTP 4')
  })

  it('never shows the coarse "Connection failed." as the primary line for a failed lane', () => {
    const display = buildProviderRuntimeCheckDisplay(
      createReport({
        ordinaryChat: { lane: 'ordinary-chat', status: 'unknown', summary: 'Connection failed.' },
        direct: undefined,
        gateway: undefined
      }),
      labels
    )

    const ordinary = display.lanes[0]
    expect(ordinary?.reason).toBe(models.connectionCheckReasonUnknown)
    expect(ordinary?.reason).not.toBe('Connection failed.')
    expect(ordinary?.detail).toBe('Connection failed.')
  })

  it('keeps the final lane on the provider-disabled conclusion even without Claude Code lanes', () => {
    // openai-agents 报告没有直连/网关 lane：仍然不能说「需开启网关」。
    const display = buildProviderRuntimeCheckDisplay(
      createReport({
        runtimeId: 'openai-agents',
        ordinaryChat: { lane: 'ordinary-chat', status: 'unknown', summary: 'Provider is disabled.' },
        finalCompatibility: {
          providerId: 'qiniu',
          modelId: 'deepseek-v3',
          runtimeId: 'openai-agents',
          selectable: false,
          route: 'none',
          status: 'provider-disabled',
          summary: 'Provider is disabled.'
        }
      }),
      labels,
      { providerEnabled: false, hasApiKey: true }
    )

    const final = display.lanes.find((lane) => lane.key === 'final')
    expect(final?.reasonCode).toBe('provider_disabled')
    expect(final?.reason).toBe(models.connectionCheckReasonProviderDisabled)
    expect(final?.tone).toBe('warning')
    expect(final?.reason).not.toBe(models.connectionCheckGatewayRequired)
  })

  it('explains a missing Gemini native endpoint as a configuration step', () => {
    const display = buildProviderRuntimeCheckDisplay(
      createReport({
        ordinaryChat: {
          lane: 'ordinary-chat',
          status: 'unknown',
          summary: 'Gemini native endpoint is not configured.',
          failureCode: 'gemini_native_endpoint_missing'
        }
      }),
      labels
    )

    const ordinary = display.lanes[0]
    expect(ordinary?.reasonCode).toBe('gemini_native_endpoint_missing')
    expect(ordinary?.reason).toBe(models.connectionCheckReasonGeminiNativeMissing)
  })
})
