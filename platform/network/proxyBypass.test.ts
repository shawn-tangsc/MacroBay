import { describe, expect, it } from 'vitest'

import { hostnameOfUrl, shouldBypass } from './proxyBypass'

describe('shouldBypass', () => {
  it('matches the rules Chromium accepts on both outbound paths', () => {
    const rules = '<local>,*.example.test,.corp.test,localhost,127.0.0.1'

    expect(shouldBypass('intranet', rules)).toBe(true)
    expect(shouldBypass('localhost', rules)).toBe(true)
    expect(shouldBypass('api.example.test', rules)).toBe(true)
    expect(shouldBypass('deep.api.example.test', rules)).toBe(true)
    expect(shouldBypass('wiki.corp.test', rules)).toBe(true)
    expect(shouldBypass('127.0.0.1', rules)).toBe(true)
    expect(shouldBypass('api.external.test', rules)).toBe(false)
  })

  it('treats <local> like Chromium: dotted names are not local', () => {
    expect(shouldBypass('intranet', '<local>')).toBe(true)
    expect(shouldBypass('intranet.example', '<local>')).toBe(false)
    expect(shouldBypass('127.0.0.1', '<local>')).toBe(false)
  })

  it('supports the catch-all rule and ignores empty values', () => {
    expect(shouldBypass('anything.test', '*')).toBe(true)
    expect(shouldBypass('anything.test', '  ')).toBe(false)
    expect(shouldBypass('', '*')).toBe(false)
  })

  it('matches a bracketed IPv6 rule against the bare host', () => {
    // 浏览器里规则写作 `[::1]`，而 URL 解析出的 host 是 `::1`：不归一化就永远对不上。
    expect(shouldBypass('::1', '[::1]')).toBe(true)
    expect(shouldBypass('::1', '[::1],localhost')).toBe(true)
  })

  it('reads the host out of a websocket url the same way for every caller', () => {
    expect(hostnameOfUrl('wss://Api.Example.Test:8443/stream')).toBe('api.example.test')
    expect(hostnameOfUrl('not a url')).toBe('')
  })
})
