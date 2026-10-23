import { gzipSync } from 'node:zlib'
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
