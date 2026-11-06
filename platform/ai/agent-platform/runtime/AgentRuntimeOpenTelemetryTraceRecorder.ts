import { SpanStatusCode } from '@opentelemetry/api'
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources'
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
  /**
   * 服务名必须落在**资源**上，不能写在 span 属性里：协议只从 `resource.attributes` 读它，
   * span 上那个 `service.name` 改不了这一层。之前只写了 span，于是 SDK 用默认资源，
   * 报出去的名字成了 `unknown_service:<进程完整路径>`——既分不清是哪路进程发的，
   * 又把本机绝对路径带给了收集器。
   */
  const provider = new BasicTracerProvider({
    // 合并而不是替换：保留 SDK 自述属性（`telemetry.sdk.*`），只把 `service.name` 顶掉默认值。
    // 我们的资源在后，同名属性由它覆盖——默认值里那个带本机路径的名字因此不会出去。
    resource: defaultResource().merge(resourceFromAttributes({ 'service.name': serviceName })),
    spanProcessors: [new SimpleSpanProcessor(options.exporter)]
  })
  const tracer = provider.getTracer('agent-runtime')

  return {
    startSpan: (start) => {
      const span = tracer.startSpan(`agent.runtime.${start.operation}`, {
        startTime: new Date(start.startedAt),
        attributes: {
          'agent.runtime.operation': start.operation,
          ...(start.traceId ? { 'agent.runtime.trace_id': start.traceId } : {}),
          'agent.id': start.agentId,
          'agent.type': start.agentType,
          'agent.session.id': start.sessionId,
          ...(start.runId ? { 'agent.run.id': start.runId } : {}),
          ...(start.parentResumeToken ? { 'agent.resume.parent': start.parentResumeToken } : {})
        }
      })
      return createTraceSpan(span)
    },
    flush: () => provider.forceFlush()
  }
}

function createTraceSpan(
  span: {
    setAttributes: (attributes: Record<string, string>) => void
    setStatus: (status: { code: SpanStatusCode; message?: string }) => void
    end: (endTime?: Date) => void
  }
): AgentRuntimeTraceSpan {
  return {
    end: (end) => {
      span.setAttributes({
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
