import { describe, expect, it } from 'vitest'

import { platformText } from '../i18n/platformText'

import { formatProxySelfTestLine, type ProxySelfTestResult } from './proxySelfTestDisplay'

const text = platformText['zh-CN']
const labels = text.preferences
const sentences = text.models

function result(overrides: Partial<ProxySelfTestResult> = {}): ProxySelfTestResult {
  return {
    ok: true,
    status: 200,
    durationMs: 120,
    reasonCode: null,
    targetHost: 'aihubmix.com',
    resolvedProxy: 'PROXY 127.0.0.1:7890',
    proxied: true,
    endpointReachable: true,
    proxyEndpoint: '127.0.0.1:7890',
    ...overrides
  }
}

const customContext = { expectsProxy: true, fallbackProxyLabel: 'http://user:typed@1.2.3.4:1' }

describe('formatProxySelfTestLine', () => {
  it('never says passed when a configured proxy resolved to a direct connection', () => {
    const line = formatProxySelfTestLine(
      result({ resolvedProxy: 'DIRECT', proxied: false, endpointReachable: null, proxyEndpoint: null }),
      text,
      customContext
    )

    expect(line).toBe(labels.proxySelfTestNotApplied('DIRECT'))
    expect(line).not.toContain('通过')
  })

  it('says "through the proxy" only when the network stack really proxied it', () => {
    expect(formatProxySelfTestLine(result({ proxied: true }), text, customContext)).toBe(
      labels.proxySelfTestPassedViaProxy(200, '0.1')
    )
    // 未确认经过代理时只说「能连到」，不带「代理」二字。
    const reachable = formatProxySelfTestLine(result({ proxied: undefined }), text, customContext)
    expect(reachable).toBe(labels.proxySelfTestReachable(200, '0.1'))
    expect(reachable).not.toContain('代理')
    // 输入框里的地址永远不参与文案。
    expect(reachable).not.toContain('1.2.3.4')
  })

  it('blames the proxy endpoint when it cannot be reached, before blaming the target', () => {
    const line = formatProxySelfTestLine(
      result({ endpointReachable: false, ok: false, reasonCode: 'network_timeout', status: null }),
      text,
      customContext
    )

    expect(line).toBe(labels.proxySelfTestProxyUnreachable('127.0.0.1:7890'))
  })

  it('shows a direct system resolution as reachable, never as a passed proxy check', () => {
    const line = formatProxySelfTestLine(
      result({ resolvedProxy: 'DIRECT', proxied: false, endpointReachable: null, proxyEndpoint: null }),
      text,
      { expectsProxy: false, fallbackProxyLabel: '系统代理' }
    )

    expect(line).toBe(labels.proxySelfTestReachable(200, '0.1'))
    expect(line).not.toContain('经 DIRECT')
    expect(line).not.toContain('代理')
  })

  it('blames the target site on 401 without the word proxy and without the raw code', () => {
    const line = formatProxySelfTestLine(
      result({ ok: false, status: 401, reasonCode: 'http_401', durationMs: 80 }),
      text,
      customContext
    )

    expect(line).toBe(labels.proxySelfTestTargetRejected(401, 'aihubmix.com'))
    // 401 是「到达了目标站」的连通证据：不许把用户引去改 Key/账号，也不许出现内部码。
    expect(line).toContain('已连到目标站点')
    expect(line).not.toContain('检查 Key')
    expect(line).not.toContain('账号')
    expect(line).not.toContain('http_401')
  })

  it('never prints an internal code for the remaining failure kinds', () => {
    const codes = ['proxy_error', 'network_timeout', 'network_dns', 'tls_error']
    const expected: Record<string, string> = {
      proxy_error: sentences.connectionCheckReasonProxy,
      network_timeout: sentences.connectionCheckReasonTimeout,
      network_dns: sentences.connectionCheckReasonDns,
      tls_error: sentences.connectionCheckReasonTls
    }

    for (const code of codes) {
      const line = formatProxySelfTestLine(
        result({ ok: false, status: null, reasonCode: code }),
        text,
        customContext
      )

      expect(line).toBe(`${expected[code]} · aihubmix.com`)
      for (const candidate of codes) expect(line).not.toContain(candidate)
    }
  })

  it('never falls back to the typed address when reporting success', () => {
    const line = formatProxySelfTestLine(
      result({ resolvedProxy: undefined, proxied: undefined }),
      text,
      customContext
    )

    expect(line).toBe(labels.proxySelfTestReachable(200, '0.1'))
  })
})
