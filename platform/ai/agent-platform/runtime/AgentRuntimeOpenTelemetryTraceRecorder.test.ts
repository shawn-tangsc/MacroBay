import { describe, expect, it, vi } from 'vitest'

import type { AgentRuntimeTraceSpanStart } from './runtimeTypes'
import type { AgentRuntimeOpenTelemetryTraceRecorder } from './AgentRuntimeOpenTelemetryTraceRecorder'
import { createAgentRuntimeOpenTelemetryTraceRecorder } from './AgentRuntimeOpenTelemetryTraceRecorder'

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
    }>
    expect(exportedSpans).toHaveLength(1)
    expect(exportedSpans[0]).toMatchObject({
      name: 'agent.runtime.send-message',
      attributes: {
        'service.name': 'desktop-agent-runtime-test',
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
