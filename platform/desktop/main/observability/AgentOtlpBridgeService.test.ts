import { gunzipSync, gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AgentOtlpBridgeService } from './AgentOtlpBridgeService'
import { AgentOtlpPayloadAdapter } from './AgentOtlpPayloadAdapter'
import { createAgentTraceExporterBundle } from './AgentTraceExporterFactory'

describe('AgentOtlpPayloadAdapter', () => {
  it('parses spans and strips prompt attributes by default', () => {
    const spans = AgentOtlpPayloadAdapter.spansFromPayload({
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: 'service.name', value: { stringValue: 'claude-code' } }]
          },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                  spanId: 'bbbbbbbbbbbbbbbb',
                  name: 'claude.turn',
                  startTimeUnixNano: '1000000000',
                  endTimeUnixNano: '2000000000',
                  attributes: [
                    { key: 'gen_ai.prompt', value: { stringValue: 'secret prompt' } },
                    { key: 'model', value: { stringValue: 'claude' } }
                  ],
                  status: { code: 1 }
                }
              ]
            }
          ]
        }
      ]
    })

    expect(spans).toEqual([
      expect.objectContaining({
        name: 'claude.turn',
        status: 'OK',
        attributes: {
          'resource.service.name': 'claude-code',
          model: 'claude'
        }
      })
    ])
  })
})

describe('AgentOtlpBridgeService', () => {
  const bridges: AgentOtlpBridgeService[] = []

  afterEach(async () => {
    await Promise.all(bridges.splice(0).map((bridge) => bridge.stop()))
  })

  it('accepts gzip JSON traces on loopback and builds privacy-preserving Claude env', async () => {
    const onSpans = vi.fn()
    const bridge = new AgentOtlpBridgeService({
      settings: { includePrompts: false, includeToolContent: false },
      handlers: { onSpans }
    })
    bridges.push(bridge)

    const endpoint = await bridge.ensureServer()
    const payload = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                  spanId: 'bbbbbbbbbbbbbbbb',
                  name: 'bridge.span',
                  startTimeUnixNano: '1',
                  attributes: [{ key: 'ok', value: { boolValue: true } }]
                }
              ]
            }
          ]
        }
      ]
    }
    const response = await fetch(`${endpoint}/v1/traces`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip'
      },
      body: gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'))
    })

    expect(response.status).toBe(200)
    expect(onSpans).toHaveBeenCalledOnce()
    expect(bridge.buildClaudeCodeTelemetryEnv()).toMatchObject({
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
      OTEL_LOG_USER_PROMPTS: '0',
      OTEL_LOG_TOOL_CONTENT: '0',
      OTEL_LOG_RAW_API_BODIES: '0'
    })
  })

  it('rejects unsupported content types', async () => {
    const bridge = new AgentOtlpBridgeService({
      settings: { includePrompts: false, includeToolContent: false }
    })
    bridges.push(bridge)
    const endpoint = await bridge.ensureServer()
    const response = await fetch(`${endpoint}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}'
    })
    expect(response.status).toBe(415)
  })
})

describe('AgentTraceExporterFactory', () => {
  it('creates a console exporter by default and a remote exporter when configured', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
    const consoleBundle = await createAgentTraceExporterBundle(
      {
        exporterMode: 'console',
        remoteEndpoint: '',
        includePrompts: false,
        includeToolContent: false
      },
      { fetch: fetchImpl as unknown as typeof fetch }
    )
    expect(consoleBundle.bridge).toBeNull()
    await consoleBundle.dispose()

    const remoteBundle = await createAgentTraceExporterBundle(
      {
        exporterMode: 'remote-otlp',
        remoteEndpoint: 'https://collector.example/v1/traces',
        includePrompts: false,
        includeToolContent: false
      },
      { fetch: fetchImpl as unknown as typeof fetch }
    )
    expect(remoteBundle.bridge).toBeNull()
    await remoteBundle.dispose()
  })

  it('sends the service name on the resource and no local path in the payload', async () => {
    // 用户报的那条：默认资源把 `unknown_service:<进程完整路径>` 当名字发了出去。
    // 这里断的是**整份序列化后的报文**，不是某个字段。
    const bodies: string[] = []
    const fetchImpl = vi.fn(async (_url: string, init: { body: Uint8Array }) => {
      bodies.push(gunzipSync(Buffer.from(init.body)).toString('utf8'))
      return new Response('{}', { status: 200 })
    })
    const bundle = await createAgentTraceExporterBundle(
      {
        exporterMode: 'remote-otlp',
        remoteEndpoint: 'https://collector.example/v1/traces',
        includePrompts: false,
        includeToolContent: false
      },
      { fetch: fetchImpl as unknown as typeof fetch }
    )

    const span = bundle.recorder.startSpan({
      operation: 'send-message',
      traceId: 'trace-1',
      agentId: 'agent-1',
      agentType: 'claude-code',
      sessionId: 'session-1',
      runId: null,
      parentResumeToken: null,
      startedAt: '2026-01-01T00:00:00.000Z'
    })!
    span.end({ status: 'success', endedAt: '2026-01-01T00:00:01.000Z', stopReason: null, resumeToken: null })
    await bundle.dispose()

    expect(bodies).toHaveLength(1)
    const payload = JSON.parse(bodies[0]!) as {
      resourceSpans: Array<{ resource: { attributes: Array<{ key: string; value: { stringValue?: string } }> } }>
    }
    const attributes = payload.resourceSpans[0]!.resource.attributes
    expect(attributes.find((item) => item.key === 'service.name')?.value.stringValue).toBe('desktop-agent-runtime')
    expect(bodies[0]).not.toContain('unknown_service')
    expect(bodies[0]).not.toMatch(/\/(Users|home)\//)
  })

  it('starts a local bridge for local-otlp mode', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }))
    const bundle = await createAgentTraceExporterBundle(
      {
        exporterMode: 'local-otlp',
        remoteEndpoint: '',
        includePrompts: false,
        includeToolContent: false
      },
      { fetch: fetchImpl as unknown as typeof fetch }
    )
    expect(bundle.bridge?.getEndpoint()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    await bundle.dispose()
  })
})
