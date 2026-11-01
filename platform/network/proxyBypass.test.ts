import { describe, expect, it } from 'vitest'

import { checkBypassRules, hostnameOfUrl, shouldBypass } from './proxyBypass'

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

  it('reads the host out of a websocket url the same way for every caller', () => {
    expect(hostnameOfUrl('wss://Api.Example.Test:8443/stream')).toBe('api.example.test')
    expect(hostnameOfUrl('not a url')).toBe('')
  })
})

describe('checkBypassRules', () => {
  it('accepts the supported syntax and lowercases it', () => {
    expect(checkBypassRules('LOCALHOST,*.Example.test,<local>')).toEqual({
      ok: true,
      rules: ['localhost', '*.example.test', '<local>']
    })
  })

  it('rejects ports, CIDR ranges and unknown directives so saving cannot silently ignore them', () => {
    expect(checkBypassRules('10.0.0.0/8')).toEqual({ ok: false, unsupported: ['10.0.0.0/8'] })
    expect(checkBypassRules('proxy.test:8080')).toEqual({ ok: false, unsupported: ['proxy.test:8080'] })
    expect(checkBypassRules('<-loopback>')).toEqual({ ok: false, unsupported: ['<-loopback>'] })
  })
})
