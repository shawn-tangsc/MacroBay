import { describe, expect, it, vi } from 'vitest'

import type { AgentRuntimeTraceSpanStart } from './runtimeTypes'
import type { AgentRuntimeOpenTelemetryTraceRecorder } from './AgentRuntimeOpenTelemetryTraceRecorder'
import { createAgentRuntimeOpenTelemetryTraceRecorder } from './AgentRuntimeOpenTelemetryTraceRecorder'

function recordingExporter() {
  let captured: { attributes: Record<string, unknown>; resource: { attributes: Record<string, unknown> } } | null = null
  return {
    export: (spans: unknown[], resultCallback: (result: { code: number }) => void) => {
      captured = spans[0] as typeof captured
      resultCallback({ code: 0 })
    },
    shutdown: async () => undefined,
    span: () => {
      if (captured === null) throw new Error('expected the recorder to export a span')
      return captured
    }
  }
}

const spanStart: AgentRuntimeTraceSpanStart = {
  operation: 'send-message',
  traceId: 'trace-1',
  agentId: 'agent-1',
  agentType: 'claude-code',
  sessionId: 'session-1',
  runId: 'run-1',
  parentResumeToken: 'resume-parent',
  startedAt: '2026-01-01T00:00:00.000Z'
}

describe('agent runtime OpenTelemetry trace recorder', () => {
  it('exports runtime spans with stable platform attributes and flushes the provider', async () => {
    const exporter = {
      export: vi.fn((spans: unknown[], resultCallback: (result: { code: number }) => void) => {
        resultCallback({ code: 0 })
      }),
      shutdown: vi.fn(async () => undefined)
    }
    const recorder: AgentRuntimeOpenTelemetryTraceRecorder = createAgentRuntimeOpenTelemetryTraceRecorder({
      serviceName: 'desktop-agent-runtime-test',
      exporter
    })

    const span = recorder.startSpan(spanStart)!
    span.end({
      status: 'success',
      endedAt: '2026-01-01T00:00:01.000Z',
      stopReason: null,
      resumeToken: 'resume-child'
    })

    await recorder.flush()

    expect(exporter.export).toHaveBeenCalledOnce()
    const exportCall = exporter.export.mock.calls[0]!
    const exportedSpans = exportCall[0] as Array<{
      name: string
      attributes: Record<string, unknown>
      resource: { attributes: Record<string, unknown> }
    }>
    expect(exportedSpans).toHaveLength(1)
    expect(exportedSpans[0]).toMatchObject({
      name: 'agent.runtime.send-message',
      attributes: {
        'agent.runtime.operation': 'send-message',
        'agent.runtime.trace_id': 'trace-1',
        'agent.id': 'agent-1',
        'agent.type': 'claude-code',
        'agent.session.id': 'session-1',
        'agent.run.id': 'run-1',
        'agent.resume.parent': 'resume-parent',
        'agent.runtime.status': 'success',
        'agent.resume.token': 'resume-child'
      }
    })
  })

  it('puts the service name on the resource, and nowhere else', async () => {
    // 协议只从 `resource.attributes` 读服务名；写在 span 属性上改不了这一层。
    const exporter = recordingExporter()
    const recorder = createAgentRuntimeOpenTelemetryTraceRecorder({
      serviceName: 'desktop-agent-runtime-test',
      exporter
    })
    const span = recorder.startSpan(spanStart)!
    span.end({ status: 'success', endedAt: '2026-01-01T00:00:01.000Z', stopReason: null, resumeToken: null })
    await recorder.flush()

    const exported = exporter.span()
    expect(exported.resource.attributes['service.name']).toBe('desktop-agent-runtime-test')
    // 合并而不是替换：SDK 自述属性要留着，否则收集器那边少了「哪套 SDK 发的」。
    expect(exported.resource.attributes['telemetry.sdk.name']).toBe('opentelemetry')
    // 一份东西一个名字：span 上不许再带一份。
    expect(exported.attributes).not.toHaveProperty('service.name')
  })

  it('never leaks a local path into the exported span', async () => {
    // 用户报的就是这一条：默认资源把 `unknown_service:<进程完整路径>` 当名字发了出去。
    const exporter = recordingExporter()
    const recorder = createAgentRuntimeOpenTelemetryTraceRecorder({
      serviceName: 'desktop-agent-runtime-test',
      exporter
    })
    const span = recorder.startSpan(spanStart)!
    span.end({ status: 'success', endedAt: '2026-01-01T00:00:01.000Z', stopReason: null, resumeToken: null })
    await recorder.flush()

    // 只序列化「会离开进程的那几项」：span 对象本身带处理器的循环引用，整份 stringify 不了。
    const exportedSpan = exporter.span()
    const serialized = JSON.stringify({
      resource: exportedSpan.resource.attributes,
      attributes: exportedSpan.attributes
    })
    expect(serialized).not.toContain('unknown_service')
    expect(serialized).not.toMatch(/\/(Users|home)\//)
  })

  it('marks interrupted spans as unset instead of exporter failures', async () => {
    const exporter = {
      export: vi.fn((spans: unknown[], resultCallback: (result: { code: number }) => void) => {
        resultCallback({ code: 0 })
      }),
      shutdown: vi.fn(async () => undefined)
    }
    const recorder: AgentRuntimeOpenTelemetryTraceRecorder = createAgentRuntimeOpenTelemetryTraceRecorder({
      exporter
    })

    const span = recorder.startSpan(spanStart)!
    span.end({
      status: 'paused',
      endedAt: '2026-01-01T00:00:01.000Z',
      stopReason: {
        kind: 'interrupt',
        message: 'Interrupted by a newer queued turn.'
      },
      resumeToken: null
    })

    await recorder.flush()

    const exportCall = exporter.export.mock.calls[0]!
    const exportedSpans = exportCall[0] as Array<{
      attributes: Record<string, unknown>
      status: { code: number; message?: string }
    }>
    expect(exportedSpans[0]).toMatchObject({
      attributes: {
        'agent.runtime.status': 'paused',
        'agent.runtime.stop.kind': 'interrupt',
        'agent.runtime.stop.message': 'Interrupted by a newer queued turn.'
      },
      status: {
        code: 0
      }
    })
  })
})
