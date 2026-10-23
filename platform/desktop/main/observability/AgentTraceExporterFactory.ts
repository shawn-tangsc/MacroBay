import { gzipSync } from 'node:zlib'

import { ConsoleSpanExporter, type ReadableSpan, type SpanExporter } from '@opentelemetry/sdk-trace-base'

import type { AgentObservabilitySettings } from '../../../ai/agent-platform/runtime/agentObservabilitySettings'
import { createAgentRuntimeOpenTelemetryTraceRecorder } from '../../../ai/agent-platform/runtime/AgentRuntimeOpenTelemetryTraceRecorder'
import { AgentOtlpBridgeService } from './AgentOtlpBridgeService'

type ExportResult = { code: number }

const EXPORT_SUCCESS = 0
const EXPORT_FAILED = 1

export type AgentTraceExporterFactoryDependencies = {
  fetch: typeof fetch
  createBridge?: (settings: AgentObservabilitySettings) => AgentOtlpBridgeService
}

export type AgentTraceExporterBundle = {
  exporter: SpanExporter
  bridge: AgentOtlpBridgeService | null
  recorder: ReturnType<typeof createAgentRuntimeOpenTelemetryTraceRecorder>
  dispose: () => Promise<void>
}

export async function createAgentTraceExporterBundle(
  settings: AgentObservabilitySettings,
  deps: AgentTraceExporterFactoryDependencies
): Promise<AgentTraceExporterBundle> {
  let bridge: AgentOtlpBridgeService | null = null
  let exporter: SpanExporter

  if (settings.exporterMode === 'disabled') {
    exporter = createNoopSpanExporter()
  } else if (settings.exporterMode === 'local-otlp') {
    bridge = deps.createBridge?.(settings) ?? new AgentOtlpBridgeService({ settings })
    const endpoint = await bridge.ensureServer()
    exporter = createRemoteOtlpJsonExporter(`${endpoint}/v1/traces`, deps.fetch)
  } else if (settings.exporterMode === 'remote-otlp' && settings.remoteEndpoint.trim()) {
    exporter = createRemoteOtlpJsonExporter(settings.remoteEndpoint.trim(), deps.fetch)
  } else {
    exporter = new ConsoleSpanExporter()
  }

  const recorder = createAgentRuntimeOpenTelemetryTraceRecorder({
    serviceName: 'desktop-agent-runtime',
    exporter
  })

  return {
    exporter,
    bridge,
    recorder,
    dispose: async () => {
      try {
        await Promise.resolve(recorder.flush())
      } catch {
        // best-effort flush
      }
      try {
        await Promise.resolve(exporter.shutdown?.())
      } catch {
        // best-effort shutdown
      }
      await bridge?.stop()
    }
  }
}

export function createRemoteOtlpJsonExporter(endpoint: string, fetchImpl: typeof fetch): SpanExporter {
  return {
    export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
      void exportSpans(endpoint, spans, fetchImpl)
        .then(() => resultCallback({ code: EXPORT_SUCCESS }))
        .catch(() => resultCallback({ code: EXPORT_FAILED }))
    },
    async shutdown(): Promise<void> {
      return undefined
    }
  }
}

function createNoopSpanExporter(): SpanExporter {
  return {
    export(_spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
      resultCallback({ code: EXPORT_SUCCESS })
    },
    async shutdown(): Promise<void> {
      return undefined
    }
  }
}

async function exportSpans(endpoint: string, spans: ReadableSpan[], fetchImpl: typeof fetch): Promise<void> {
  if (spans.length === 0) return
  const payload = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            {
              key: 'service.name',
              value: { stringValue: 'desktop-agent-runtime' }
            }
          ]
        },
        scopeSpans: [
          {
            scope: { name: 'agent-runtime' },
            spans: spans.map((span) => ({
              traceId: span.spanContext().traceId,
              spanId: span.spanContext().spanId,
              name: span.name,
              kind: 1,
              startTimeUnixNano: hrTimeToUnixNano(span.startTime),
              endTimeUnixNano: hrTimeToUnixNano(span.endTime),
              attributes: Object.entries(span.attributes).flatMap(([key, value]) => {
                if (value === undefined) return []
                return [{ key, value: attributeValue(value) }]
              }),
              status: {
                code: span.status.code,
                message: span.status.message
              }
            }))
          }
        ]
      }
    ]
  }

  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  const compressed = gzipSync(body)
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-encoding': 'gzip'
    },
    body: compressed
  })
  if (!response.ok) {
    throw new Error(`Remote OTLP export failed with status ${response.status}`)
  }
}

function attributeValue(value: unknown): { stringValue?: string; boolValue?: boolean; intValue?: number; doubleValue?: number } {
  if (typeof value === 'boolean') return { boolValue: value }
  if (typeof value === 'number' && Number.isInteger(value)) return { intValue: value }
  if (typeof value === 'number') return { doubleValue: value }
  return { stringValue: String(value) }
}

function hrTimeToUnixNano(value: [number, number]): string {
  const seconds = BigInt(value[0])
  const nanos = BigInt(value[1])
  return (seconds * 1_000_000_000n + nanos).toString()
}
