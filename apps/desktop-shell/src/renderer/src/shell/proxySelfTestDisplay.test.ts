import { describe, expect, it } from 'vitest'

import { platformText } from '../i18n/platformText'

import { formatProxySelfTestLine, type ProxySelfTestResult } from './proxySelfTestDisplay'

const labels = platformText['zh-CN'].preferences

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
      labels,
      customContext
    )

    expect(line).toBe(labels.proxySelfTestNotApplied('DIRECT'))
    expect(line).not.toContain('通过')
  })

  it('names the resolved proxy, not the string the user typed', () => {
    const line = formatProxySelfTestLine(result(), labels, customContext)

    expect(line).toBe(labels.proxySelfTestPassed(200, '0.1', 'PROXY 127.0.0.1:7890'))
    expect(line).not.toContain('1.2.3.4')
  })

  it('blames the proxy endpoint when it cannot be reached, before blaming the target', () => {
    const line = formatProxySelfTestLine(
      result({ endpointReachable: false, ok: false, reasonCode: 'network_timeout', status: null }),
      labels,
      customContext
    )

    expect(line).toBe(labels.proxySelfTestProxyUnreachable('127.0.0.1:7890'))
  })

  it('allows a direct resolution in system mode, where direct is a legitimate outcome', () => {
    const line = formatProxySelfTestLine(
      result({ resolvedProxy: 'DIRECT', proxied: false, endpointReachable: null, proxyEndpoint: null }),
      labels,
      { expectsProxy: false, fallbackProxyLabel: '系统代理' }
    )

    expect(line).toBe(labels.proxySelfTestPassed(200, '0.1', 'DIRECT'))
  })

  it('blames the target site on 401 without the word proxy and without the raw code', () => {
    const line = formatProxySelfTestLine(
      result({ ok: false, status: 401, reasonCode: 'http_401', durationMs: 80 }),
      labels,
      customContext
    )

    expect(line).toBe(labels.proxySelfTestTargetRejected(401, 'aihubmix.com'))
    expect(line).not.toContain('代理')
    expect(line).not.toContain('http_401')
  })

  it('falls back to the mode label when the main process reported no resolution', () => {
    const line = formatProxySelfTestLine(
      result({ resolvedProxy: undefined, proxied: undefined }),
      labels,
      customContext
    )

    expect(line).toContain('1.2.3.4')
  })
})
