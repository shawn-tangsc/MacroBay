import { describe, expect, it } from 'vitest'

import type { ProviderRuntimeCheckReport } from '@platform/ai/agent-platform/runtime/compatibility/providerRuntimeCheckTypes'

import { platformText } from '../i18n/platformText'

import {
  buildProviderRuntimeCheckDisplay,
  type ProviderRuntimeCheckDisplayLabels
} from './providerRuntimeCheckDisplay'

/**
 * PLAT-62 更正：智能体跑的是 Claude Code driver，要求 Anthropic Messages 直连或网关转换。
 * 普通聊天只证明「助手可用」，不参与智能体结论。
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
    providerId: 'deepseek',
    modelId: 'deepseek-chat',
    runtimeId: 'claude-code',
    ordinaryChat: { lane: 'ordinary-chat', status: 'ready', summary: 'Connection succeeded.' },
    direct: { lane: 'claude-code-direct', status: 'ready', summary: 'Direct probe passed.', route: 'direct' },
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
      selectable: true,
      route: 'direct',
      status: 'ready',
      summary: 'Direct Claude Code runtime probe passed.'
    },
    updatedAt: '2026-07-10T00:00:00.000Z',
    signature: 'sig',
    ...overrides
  }
}

describe('agent verdict follows the Claude Code routes', () => {
  it('calls the agent usable via direct Anthropic protocol when the direct probe passes', () => {
    const display = buildProviderRuntimeCheckDisplay(createReport(), labels)

    expect(display.overallOk).toBe(true)
    expect(display.overallTone).toBe('success')
    expect(display.overallMessage).toBe(models.connectionCheckAgentUsableDirect)
    const final = display.lanes.find((lane) => lane.key === 'final')
    expect(final?.reason).toBe(models.connectionCheckAgentUsableDirect)
    expect(final?.tone).toBe('success')
    expect(display.lanes.find((lane) => lane.key === 'ordinaryChat')?.hint)
      .toBe(models.connectionCheckAssistantUsable)
  })

  it('calls the agent usable via the gateway when direct fails but the gateway probe passes', () => {
    const display = buildProviderRuntimeCheckDisplay(
      createReport({
        direct: {
          lane: 'claude-code-direct',
          status: 'protocol-unsupported',
          summary: 'HTTP 500 · messages protocol unsupported.',
          failureCode: 'protocol_unsupported',
          route: 'direct'
        },
        gateway: { lane: 'claude-code-gateway', status: 'ready', summary: 'Gateway probe passed.', route: 'gateway' },
        finalCompatibility: {
          providerId: 'deepseek',
          modelId: 'deepseek-chat',
          runtimeId: 'claude-code',
          selectable: true,
          route: 'gateway',
          status: 'ready',
          summary: 'Gateway probe passed.'
        }
      }),
      labels
    )

    expect(display.overallOk).toBe(true)
    expect(display.overallMessage).toBe(models.connectionCheckAgentUsableGateway)
    expect(display.lanes.find((lane) => lane.key === 'final')?.reason)
      .toBe(models.connectionCheckAgentUsableGateway)
  })

  it('keeps the agent unusable when both routes fail, even if ordinary chat works', () => {
    const display = buildProviderRuntimeCheckDisplay(
      createReport({
        direct: {
          lane: 'claude-code-direct',
          status: 'protocol-unsupported',
          summary: 'HTTP 500 · 模型下无渠道支持messages协议',
          failureCode: 'protocol_unsupported',
          route: 'direct'
        },
        gateway: {
          lane: 'claude-code-gateway',
          status: 'gateway-required',
          summary: 'Agent model gateway is disabled.',
          route: 'gateway'
        },
        finalCompatibility: {
          providerId: 'aionly',
          modelId: 'glm-4.6',
          runtimeId: 'claude-code',
          selectable: false,
          route: 'gateway',
          status: 'protocol-unsupported',
          summary: 'Protocol unsupported.'
        }
      }),
      labels
    )

    expect(display.overallOk).toBe(false)
    expect(display.overallTone).toBe('error')
    expect(display.overallMessage).not.toContain(models.connectionCheckAgentUsableDirect)
    const final = display.lanes.find((lane) => lane.key === 'final')
    expect(final?.reason).toBe(models.connectionCheckReasonProtocolUnsupported)
    expect(final?.tone).toBe('error')
    // 普通聊天通过 ⇒ 仍然单独说明「助手可用」。
    expect(display.lanes.find((lane) => lane.key === 'ordinaryChat')?.hint)
      .toBe(models.connectionCheckAssistantUsable)
  })

  it('prioritises 401/403 over the gateway-disabled reason when both routes fail', () => {
    const display = buildProviderRuntimeCheckDisplay(
      createReport({
        direct: {
          lane: 'claude-code-direct',
          status: 'auth-failed',
          summary: 'HTTP 401',
          failureCode: 'http_401',
          route: 'direct'
        },
        gateway: {
          lane: 'claude-code-gateway',
          status: 'gateway-required',
          summary: 'Agent model gateway is disabled.',
          route: 'gateway'
        }
      }),
      labels
    )

    const final = display.lanes.find((lane) => lane.key === 'final')
    expect(display.overallOk).toBe(false)
    expect(final?.reason).toBe(models.connectionCheckReasonUnauthorized)
    expect(final?.reasonCode).toBe('http_401')
  })

  it('explains that the gateway only needs enabling when it is the only blocker', () => {
    const display = buildProviderRuntimeCheckDisplay(
      createReport({
        direct: {
          lane: 'claude-code-direct',
          status: 'unknown',
          summary: 'Model is not enabled for Claude Code agent runtime.',
          route: 'direct'
        },
        gateway: {
          lane: 'claude-code-gateway',
          status: 'gateway-stopped',
          summary: 'Agent model gateway is stopped.',
          route: 'gateway'
        }
      }),
      labels
    )

    const final = display.lanes.find((lane) => lane.key === 'final')
    expect(display.overallOk).toBe(false)
    expect(final?.reason).toBe(models.connectionCheckGatewayRequired)
    expect(final?.reasonCode).toBe('gateway_disabled')
    expect(final?.action).toBe('enable-gateway')
  })

  it('uses the info explanation only when the other route is usable', () => {
    const viaGateway = buildProviderRuntimeCheckDisplay(
      createReport({
        direct: {
          lane: 'claude-code-direct',
          status: 'unknown',
          summary: 'Model is not enabled for Claude Code agent runtime.',
          route: 'direct'
        },
        gateway: { lane: 'claude-code-gateway', status: 'ready', summary: 'Gateway probe passed.', route: 'gateway' }
      }),
      labels
    )

    const direct = viaGateway.lanes.find((lane) => lane.key === 'direct')
    expect(direct?.reason).toBe(models.connectionCheckOptionalRuntimeDisabled)
    expect(direct?.tone).toBe('info')
    expect(viaGateway.overallOk).toBe(true)

    const viaDirect = buildProviderRuntimeCheckDisplay(
      createReport({
        gateway: {
          lane: 'claude-code-gateway',
          status: 'gateway-stopped',
          summary: 'Agent model gateway is stopped.',
          route: 'gateway'
        }
      }),
      labels
    )

    const gateway = viaDirect.lanes.find((lane) => lane.key === 'gateway')
    expect(gateway?.reason).toBe(models.connectionCheckOptionalGatewayDisabled)
    expect(gateway?.tone).toBe('info')
    expect(viaDirect.overallOk).toBe(true)
  })

  it('treats a direct probe timeout as unconfirmed instead of requiring the gateway', () => {
    const display = buildProviderRuntimeCheckDisplay(
      createReport({
        direct: {
          lane: 'claude-code-direct',
          status: 'timeout',
          summary: 'Direct Claude Code runtime probe timed out.',
          route: 'direct'
        },
        gateway: {
          lane: 'claude-code-gateway',
          status: 'gateway-required',
          summary: 'Agent model gateway is disabled.',
          route: 'gateway'
        }
      }),
      labels
    )

    const direct = display.lanes.find((lane) => lane.key === 'direct')
    expect(direct?.tone).toBe('warning')
    expect(direct?.reason).toBe(models.connectionCheckProbeTimeout)
    expect(direct?.reason).toContain('timed out')
    expect(direct?.action).toBe('retry')

    const final = display.lanes.find((lane) => lane.key === 'final')
    expect(display.overallOk).toBe(false)
    expect(display.overallTone).toBe('warning')
    expect(final?.reason).toBe(models.connectionCheckAgentUnconfirmedTimeout)
    expect(final?.reason).toContain('Unconfirmed')
    expect(final?.reason).not.toContain(models.connectionCheckGatewayRequired)
    expect(final?.tone).toBe('warning')
    expect(final?.action).toBe('retry')
  })

  it('keeps an explicit protocol failure as a hard failure even with a timeout elsewhere', () => {
    const display = buildProviderRuntimeCheckDisplay(
      createReport({
        direct: {
          lane: 'claude-code-direct',
          status: 'protocol-unsupported',
          summary: 'HTTP 500 · messages protocol unsupported',
          failureCode: 'protocol_unsupported',
          route: 'direct'
        },
        gateway: {
          lane: 'claude-code-gateway',
          status: 'timeout',
          summary: 'Agent model gateway runtime probe timed out.',
          route: 'gateway'
        }
      }),
      labels
    )

    const final = display.lanes.find((lane) => lane.key === 'final')
    expect(display.overallOk).toBe(false)
    expect(display.overallTone).toBe('error')
    expect(final?.reason).toBe(models.connectionCheckReasonProtocolUnsupported)
    expect(final?.tone).toBe('error')
  })
})
