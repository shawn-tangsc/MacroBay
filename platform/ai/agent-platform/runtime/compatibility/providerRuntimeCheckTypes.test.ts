import { describe, expect, it } from 'vitest'

import {
  buildProviderRuntimeCheckReportKey,
  createIdleLaneResult,
  isProviderRuntimeCheckReport,
  isProviderRuntimeCheckReportStale,
  isProviderRuntimeCheckReportStaleForGateway,
  normalizeProviderRuntimeCheckReport
} from './providerRuntimeCheckTypes'

describe('providerRuntimeCheckTypes', () => {
  it('builds stable report keys', () => {
    expect(buildProviderRuntimeCheckReportKey('deepseek', 'deepseek-chat', 'claude-code')).toBe(
      'deepseek:deepseek-chat:claude-code'
    )
  })

  it('normalizes and validates safe runtime reports', () => {
    const report = {
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      runtimeId: 'claude-code' as const,
      ordinaryChat: {
        lane: 'ordinary-chat' as const,
        status: 'ready' as const,
        summary: 'Connection succeeded.',
        checkedAt: '2026-07-10T00:00:00.000Z'
      },
      direct: {
        lane: 'claude-code-direct' as const,
        status: 'auth-failed' as const,
        summary: 'Direct Claude Code authentication failed.',
        checkedAt: '2026-07-10T00:00:00.000Z',
        route: 'direct' as const
      },
      gateway: createIdleLaneResult('claude-code-gateway', 'Agent model gateway is disabled.'),
      finalCompatibility: {
        providerId: 'deepseek',
        modelId: 'deepseek-chat',
        runtimeId: 'claude-code' as const,
        selectable: false,
        route: 'none' as const,
        status: 'auth-failed' as const,
        summary: 'Direct Claude Code authentication failed.'
      },
      updatedAt: '2026-07-10T00:00:00.000Z',
      signature: 'sig-1'
    }

    expect(isProviderRuntimeCheckReport(report)).toBe(true)
    expect(normalizeProviderRuntimeCheckReport(report)).toEqual(report)
    expect(normalizeProviderRuntimeCheckReport({ providerId: 'x' })).toBeNull()
  })

  it('keeps the optional Responses endpoint lane and rejects malformed ones', () => {
    const report = {
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      runtimeId: 'claude-code' as const,
      ordinaryChat: createIdleLaneResult('ordinary-chat'),
      responses: {
        verdict: 'missing' as const,
        status: 404,
        message: 'HTTP 404',
        checkedAt: '2026-07-10T00:00:00.000Z'
      },
      finalCompatibility: {
        providerId: 'deepseek',
        modelId: 'deepseek-chat',
        runtimeId: 'claude-code' as const,
        selectable: false,
        route: 'none' as const,
        status: 'unknown' as const,
        summary: 'Unknown'
      },
      updatedAt: '2026-07-10T00:00:00.000Z',
      signature: 'sig-1'
    }

    expect(isProviderRuntimeCheckReport(report)).toBe(true)
    expect(normalizeProviderRuntimeCheckReport(report)?.responses).toEqual(report.responses)
    expect(isProviderRuntimeCheckReport({ ...report, responses: { verdict: 'nope', status: 404 } })).toBe(false)
    expect(isProviderRuntimeCheckReport({ ...report, responses: { status: 404 } })).toBe(false)
  })

  it('keeps the optional Gemini endpoint lane and rejects malformed ones', () => {
    const report = {
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      runtimeId: 'claude-code' as const,
      ordinaryChat: createIdleLaneResult('ordinary-chat'),
      responses: { verdict: 'available' as const, status: 200 },
      gemini: { verdict: 'exists_auth_failed' as const, status: 401, message: 'HTTP 401' },
      finalCompatibility: {
        providerId: 'deepseek',
        modelId: 'deepseek-chat',
        runtimeId: 'claude-code' as const,
        selectable: false,
        route: 'none' as const,
        status: 'unknown' as const,
        summary: 'Unknown'
      },
      updatedAt: '2026-07-10T00:00:00.000Z',
      signature: 'sig-1'
    }

    expect(isProviderRuntimeCheckReport(report)).toBe(true)
    expect(normalizeProviderRuntimeCheckReport(report)?.gemini).toEqual(report.gemini)
    expect(isProviderRuntimeCheckReport({ ...report, gemini: { verdict: 'nope', status: 404 } })).toBe(false)
    expect(isProviderRuntimeCheckReport({ ...report, gemini: { status: 404 } })).toBe(false)
    // 没有 gemini 字段的旧报告仍然合法。
    expect(normalizeProviderRuntimeCheckReport({ ...report, gemini: undefined })?.gemini).toBeUndefined()
  })

  it('marks reports stale by age or signature mismatch', () => {
    const report = {
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      runtimeId: 'claude-code' as const,
      ordinaryChat: createIdleLaneResult('ordinary-chat'),
      finalCompatibility: {
        providerId: 'deepseek',
        modelId: 'deepseek-chat',
        runtimeId: 'claude-code' as const,
        selectable: false,
        route: 'none' as const,
        status: 'unknown' as const,
        summary: 'Unknown'
      },
      updatedAt: '2026-07-10T00:00:00.000Z',
      signature: 'sig-1'
    }

    expect(
      isProviderRuntimeCheckReportStale(report, {
        now: new Date('2026-07-10T00:10:00.000Z'),
        signature: 'sig-1'
      })
    ).toBe(false)

    expect(
      isProviderRuntimeCheckReportStale(report, {
        now: new Date('2026-07-10T00:20:00.000Z'),
        signature: 'sig-1'
      })
    ).toBe(true)

    expect(
      isProviderRuntimeCheckReportStale(report, {
        now: new Date('2026-07-10T00:01:00.000Z'),
        signature: 'sig-2'
      })
    ).toBe(true)
  })

  it('marks gateway-ready reports stale when the gateway is no longer running', () => {
    const report = {
      providerId: 'openai',
      modelId: 'gpt-5',
      runtimeId: 'claude-code' as const,
      ordinaryChat: createIdleLaneResult('ordinary-chat'),
      gateway: {
        lane: 'claude-code-gateway' as const,
        status: 'ready' as const,
        summary: 'Gateway ready',
        route: 'gateway' as const
      },
      finalCompatibility: {
        providerId: 'openai',
        modelId: 'gpt-5',
        runtimeId: 'claude-code' as const,
        selectable: true,
        route: 'gateway' as const,
        status: 'ready' as const,
        summary: 'Ready through Agent Gateway'
      },
      updatedAt: '2026-07-10T00:00:00.000Z',
      signature: 'sig-gateway'
    }

    expect(
      isProviderRuntimeCheckReportStaleForGateway(report, {
        enabled: true,
        state: 'running'
      })
    ).toBe(false)
    expect(
      isProviderRuntimeCheckReportStaleForGateway(report, {
        enabled: true,
        state: 'stopped'
      })
    ).toBe(true)
    expect(
      isProviderRuntimeCheckReportStaleForGateway(report, {
        enabled: false,
        state: 'disabled'
      })
    ).toBe(true)
  })
})
