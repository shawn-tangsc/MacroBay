import { describe, expect, it } from 'vitest'

import type { ProviderRuntimeCheckReport } from '@platform/ai/agent-platform/runtime/compatibility/providerRuntimeCheckTypes'

import { platformText } from '../i18n/platformText'

import {
  buildProviderRuntimeCheckDisplay,
  type ProviderRuntimeCheckDisplayLabels
} from './providerRuntimeCheckDisplay'

/**
 * PLAT-62 追加：探针命中 Anthropic 协议不支持时，
 * 汇总（final）行必须是「该模型不支持 Anthropic 协议」，并给出网关/换模型的建议，
 * 不能再出现「该模型未启用 Claude Code 运行时」。
 */
const zh = platformText['zh-CN'].models

const labels: ProviderRuntimeCheckDisplayLabels = {
  ordinaryChat: zh.connectionCheckOrdinaryChat,
  direct: zh.connectionCheckDirect,
  gateway: zh.connectionCheckGateway,
  final: zh.connectionCheckFinal,
  ready: zh.connectionCheckAgentReady,
  notReady: zh.connectionCheckAgentNotReady,
  checking: zh.connectionCheckStart,
  mixed: zh.connectionCheckAgentMixed,
  reasons: zh,
  detailPrefix: zh.connectionCheckDetailPrefix,
  irrelevantHint: zh.connectionCheckIrrelevantHint,
  gatewayDisabledHint: zh.connectionCheckGatewayDisabledHint
}

const protocolSummary = 'HTTP 500 · 模型 glm-4.6 下无渠道支持messages协议，请注意使用的接口协议'

function createReport(): ProviderRuntimeCheckReport {
  return {
    providerId: 'aionly',
    modelId: 'glm-4.6',
    runtimeId: 'claude-code',
    ordinaryChat: {
      lane: 'ordinary-chat',
      status: 'ready',
      summary: 'Connection succeeded.'
    },
    direct: {
      lane: 'claude-code-direct',
      status: 'protocol-unsupported',
      summary: protocolSummary,
      failureCode: 'protocol_unsupported',
      route: 'direct'
    },
    finalCompatibility: {
      providerId: 'aionly',
      modelId: 'glm-4.6',
      runtimeId: 'claude-code',
      selectable: false,
      route: 'gateway',
      status: 'protocol-unsupported',
      summary: protocolSummary
    },
    updatedAt: '2026-08-01T00:00:00.000Z',
    signature: 'sig'
  }
}

describe('PLAT-62 protocol unsupported display', () => {
  it('shows the protocol sentence and the gateway/other-model hint on the final lane', () => {
    const display = buildProviderRuntimeCheckDisplay(createReport(), labels)
    const final = display.lanes.find((lane) => lane.key === 'final')

    expect(final?.reasonCode).toBe('protocol_unsupported')
    expect(final?.reason).toBe(zh.connectionCheckReasonProtocolUnsupported)
    expect(final?.reason).toContain('不支持 Anthropic 协议')
    expect(final?.reason).not.toContain(zh.connectionCheckReasonHttp(500))
    expect(final?.hint).toBe(zh.connectionCheckReasonProtocolUnsupportedHint)
    expect(final?.hint).toContain('模型网关')
  })

  it('never falls back to the model-runtime-disabled sentence for this probe result', () => {
    const display = buildProviderRuntimeCheckDisplay(createReport(), labels)
    const final = display.lanes.find((lane) => lane.key === 'final')

    expect(final?.reason).not.toContain('未启用 Claude Code 运行时')
    expect(final?.reason).not.toBe(zh.connectionCheckReasonModelRuntimeDisabled)
  })

  it('keeps the detail as one summarized line instead of raw JSON', () => {
    const display = buildProviderRuntimeCheckDisplay(createReport(), labels)
    const direct = display.lanes.find((lane) => lane.key === 'direct')

    expect(direct?.reason).toBe(zh.connectionCheckReasonProtocolUnsupported)
    expect(direct?.detail).toContain('HTTP 500')
    expect(direct?.detail).toContain('messages协议')
    expect(direct?.detail).not.toContain('{"')
  })
})
