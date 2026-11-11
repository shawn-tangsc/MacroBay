import { describe, expect, it } from 'vitest'

import { platformText } from '../i18n/platformText'

import {
  describeProxySelfTest,
  formatProxySelfTestLine,
  PROXY_SELF_TEST_PROBE_URL,
  type ProxySelfTestResult
} from './proxySelfTestDisplay'

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
    proxyEndpointLoopback: true,
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

  it('says the local proxy is not running only when the endpoint is on loopback', () => {
    const line = formatProxySelfTestLine(
      result({ endpointReachable: false, ok: false, reasonCode: 'network_timeout', status: null }),
      text,
      customContext
    )

    expect(line).toBe(labels.proxySelfTestProxyNotRunning('127.0.0.1:7890'))
  })

  it('says the local network only when the comparison probe ran and failed', () => {
    const failedProbe = describeProxySelfTest(
      result({
        endpointReachable: false,
        proxyEndpoint: '10.1.2.3:7890',
        proxyEndpointLoopback: false,
        directProbeReachable: false,
        ok: false,
        status: null,
        reasonCode: 'network_refused'
      }),
      text,
      customContext
    )

    expect(failedProbe.triage).toBe('local-network')
    expect(failedProbe.line).toBe(labels.proxySelfTestLocalNetwork)
    expect(failedProbe.hint).toBe(labels.proxySelfTestLocalNetworkHint)
  })

  it('never slides back to the local network when the probe proved it works', () => {
    const view = describeProxySelfTest(
      result({
        endpointReachable: false,
        proxyEndpoint: '10.1.2.3:7890',
        proxyEndpointLoopback: false,
        directProbeReachable: true,
        ok: false,
        status: null,
        reasonCode: 'network_refused'
      }),
      text,
      customContext
    )

    expect(view.triage).toBe('network-ok-proxy-suspect')
    expect(view.line).toBe(labels.proxySelfTestProxyAfterProbe('10.1.2.3:7890'))
    expect(view.line).not.toContain('本机网络不通')
  })

  it('treats a probe that never reported as missing evidence, not as a failure', () => {
    const view = describeProxySelfTest(
      result({
        endpointReachable: false,
        proxyEndpoint: '10.1.2.3:7890',
        proxyEndpointLoopback: false,
        directProbeReachable: null,
        ok: false,
        status: null,
        reasonCode: 'network_refused'
      }),
      text,
      customContext
    )

    expect(view.triage).toBe('insufficient-evidence')
    expect(view.line).toBe(labels.proxySelfTestUnattributable('10.1.2.3:7890'))
    expect(view.line).not.toContain('本机网络')
  })

  it('blames the proxy itself only when it answers and still reports its own failure', () => {
    const line = formatProxySelfTestLine(
      result({ ok: false, status: null, reasonCode: 'proxy_error', endpointReachable: true }),
      text,
      customContext
    )

    expect(line).toBe(labels.proxySelfTestProxyAnsweredBadly(sentences.connectionCheckReasonProxy))
  })

  it('says what it ruled out when a request through a live proxy gets no response at all', () => {
    const line = formatProxySelfTestLine(
      result({ ok: false, status: null, reasonCode: 'network_timeout', endpointReachable: true }),
      text,
      customContext
    )

    expect(line).toBe(labels.proxySelfTestUnattributable('127.0.0.1:7890'))
    expect(line).toContain('原因待查')
    expect(line).not.toContain('代理坏了')
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

  it('says the site refused a 403 instead of telling the reader to bring a key', () => {
    const view = describeProxySelfTest(
      result({ ok: false, status: 403, reasonCode: 'http_403', durationMs: 80 }),
      text,
      customContext
    )

    // 403 是「站点把请求挡下来」，不是「站点要鉴权」：两句都必须和 401 不同。
    expect(view.tone).toBe('partial')
    expect(view.line).toBe(labels.proxySelfTestTargetDenied(403, 'aihubmix.com'))
    expect(view.hint).toBe(labels.proxySelfTestDeniedHint)
    expect(view.line).not.toContain('鉴权')
    expect(view.hint).not.toContain('401')
  })

  it('never prints an internal code for the remaining failure kinds', () => {
    const codes = ['proxy_error', 'network_timeout', 'network_dns', 'tls_error']
    const lines = [
      formatProxySelfTestLine(result({ ok: false, status: null, reasonCode: 'proxy_error', endpointReachable: true }), text, customContext),
      formatProxySelfTestLine(result({ ok: false, status: null, reasonCode: 'network_timeout', endpointReachable: true }), text, customContext),
      formatProxySelfTestLine(result({ ok: false, status: null, reasonCode: 'network_dns', endpointReachable: true }), text, customContext),
      formatProxySelfTestLine(result({ ok: false, status: null, reasonCode: 'tls_error', endpointReachable: true }), text, customContext)
    ]

    expect(lines).toEqual([
      labels.proxySelfTestProxyAnsweredBadly(sentences.connectionCheckReasonProxy),
      labels.proxySelfTestUnattributable('127.0.0.1:7890'),
      labels.proxySelfTestUnattributable('127.0.0.1:7890'),
      labels.proxySelfTestUnattributable('127.0.0.1:7890')
    ])
    for (const line of lines) {
      for (const candidate of codes) expect(line).not.toContain(candidate)
    }
  })

  it('keeps a status-coded failure as partial, naming the host it reached', () => {
    const line = formatProxySelfTestLine(
      result({ ok: false, status: 500, reasonCode: 'http_5xx', endpointReachable: true }),
      text,
      customContext
    )

    expect(line).toContain('aihubmix.com')
    expect(describeProxySelfTest(result({ ok: false, status: 500, reasonCode: 'http_5xx', endpointReachable: true }), text, customContext).tone).toBe('partial')
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

describe('自检的目标固定是 Google，与供应商无关', () => {
  it('probes the Google 204 endpoint through one constant', () => {
    // 用户 2026-11-11：「访问一下 google 就说明代理有没有用了」。
    // 以前拿供应商 origin 当目标，SiliconFlow 根路径 404 → 判失败，而代理其实是通的。
    expect(PROXY_SELF_TEST_PROBE_URL).toBe('https://www.google.com/generate_204')
  })

  it('reads 204 as a pass, not as a failure', () => {
    const view = describeProxySelfTest(result({ ok: true, status: 204, targetHost: 'www.google.com' }), text, customContext)
    expect(view.tone).toBe('pass')
    expect(view.line).toContain('204')
  })

  it('never blames "供应商" when the target answers with a bad status', () => {
    // 目标换成 Google 之后，「供应商返回 HTTP N」这句话就说错对象了。
    const view = describeProxySelfTest(result({ ok: false, status: 404, targetHost: 'www.google.com' }), text, customContext)
    expect(view.tone).toBe('partial')
    expect(view.line).not.toContain('供应商')
    expect(view.line).toContain('目标站')
    expect(view.line).toContain('www.google.com')
  })
})
