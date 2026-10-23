import { describe, expect, it } from 'vitest'

import { createDefaultAppSettings } from '../settings/schema/appSettings'

import { buildCustomProxyRules, buildSessionProxyConfig, normalizeProxyBypassRules } from './proxyConfig'

describe('proxyConfig', () => {
  it('builds system and direct proxy modes', () => {
    expect(buildSessionProxyConfig({ ...createDefaultAppSettings().network, proxyMode: 'system' })).toEqual({
      mode: 'system'
    })
    expect(buildSessionProxyConfig({ ...createDefaultAppSettings().network, proxyMode: 'none' })).toEqual({
      mode: 'direct'
    })
  })

  it('maps custom socks5 urls to chromium proxy rules', () => {
    const config = buildSessionProxyConfig({
      proxyMode: 'custom',
      proxyUrl: 'socks5://127.0.0.1:6153',
      proxyBypassRules: 'localhost,127.0.0.1,::1'
    })

    expect(config).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'socks5=127.0.0.1:6153',
      proxyBypassRules: 'localhost,127.0.0.1,::1'
    })
  })

  it('supports host:port shorthand plus HTTP, HTTPS, and SOCKS proxy urls', () => {
    expect(buildCustomProxyRules('127.0.0.1:6153')).toBe('socks5=127.0.0.1:6153')
    expect(buildCustomProxyRules('http://127.0.0.1:7890')).toBe('http=127.0.0.1:7890;https=127.0.0.1:7890')
    expect(buildCustomProxyRules('https://proxy.example.test')).toBe('https=proxy.example.test:443')
    expect(buildCustomProxyRules('socks5h://proxy.example.test')).toBe('socks5=proxy.example.test:1080')
  })

  it('normalizes bypass rules', () => {
    expect(normalizeProxyBypassRules('localhost, 127.0.0.1 , ::1')).toBe('localhost,127.0.0.1,::1')
  })
})
