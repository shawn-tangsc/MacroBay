import { SpanStatusCode } from '@opentelemetry/api'
import { BasicTracerProvider, ConsoleSpanExporter, SimpleSpanProcessor, type SpanExporter } from '@opentelemetry/sdk-trace-base'

import type {
  AgentRuntimeTraceRecorder,
  AgentRuntimeTraceSpan,
  AgentRuntimeTraceSpanEnd
} from './runtimeTypes'

export type AgentRuntimeOpenTelemetryTraceRecorderOptions = {
  serviceName?: string
  exporter: SpanExporter
}

export type AgentRuntimeOpenTelemetryTraceRecorder = AgentRuntimeTraceRecorder & {
  flush: () => Promise<void>
}

export function createAgentRuntimeOpenTelemetryTraceRecorder(
  options: AgentRuntimeOpenTelemetryTraceRecorderOptions
): AgentRuntimeOpenTelemetryTraceRecorder {
  const serviceName = normalizeServiceName(options.serviceName)
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(options.exporter)]
  })
  const tracer = provider.getTracer('agent-runtime')

  return {
    startSpan: (start) => {
      const span = tracer.startSpan(`agent.runtime.${start.operation}`, {
        startTime: new Date(start.startedAt),
        attributes: {
          'service.name': serviceName,
          'agent.runtime.operation': start.operation,
          ...(start.traceId ? { 'agent.runtime.trace_id': start.traceId } : {}),
          'agent.id': start.agentId,
          'agent.type': start.agentType,
          'agent.session.id': start.sessionId,
          ...(start.runId ? { 'agent.run.id': start.runId } : {}),
          ...(start.parentResumeToken ? { 'agent.resume.parent': start.parentResumeToken } : {})
        }
      })
      return createTraceSpan(span, serviceName)
    },
    flush: () => provider.forceFlush()
  }
}

function createTraceSpan(
  span: {
    setAttributes: (attributes: Record<string, string>) => void
    setStatus: (status: { code: SpanStatusCode; message?: string }) => void
    end: (endTime?: Date) => void
  },
  serviceName: string
): AgentRuntimeTraceSpan {
  return {
    end: (end) => {
      span.setAttributes({
        'service.name': serviceName,
        'agent.runtime.status': end.status,
        ...(end.stopReason?.kind ? { 'agent.runtime.stop.kind': end.stopReason.kind } : {}),
        ...(end.stopReason?.message ? { 'agent.runtime.stop.message': end.stopReason.message } : {}),
        ...(end.resumeToken ? { 'agent.resume.token': end.resumeToken } : {})
      })
      span.setStatus(toSpanStatus(end))
      span.end(new Date(end.endedAt))
    }
  }
}

function toSpanStatus(end: AgentRuntimeTraceSpanEnd): { code: SpanStatusCode; message?: string } {
  if (end.status === 'error') {
    return {
      code: SpanStatusCode.ERROR,
      ...(end.stopReason?.message ? { message: end.stopReason.message } : {})
    }
  }
  return { code: SpanStatusCode.UNSET }
}

function normalizeServiceName(serviceName: string | undefined): string {
  const trimmed = serviceName?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : 'desktop-agent-runtime'
}

export function createAgentRuntimeConsoleTraceRecorder(
  serviceName?: string
): AgentRuntimeOpenTelemetryTraceRecorder {
  return createAgentRuntimeOpenTelemetryTraceRecorder({
    serviceName,
    exporter: new ConsoleSpanExporter()
  })
}
