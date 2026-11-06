import { describe, expect, it } from 'vitest'

import { createDefaultAppSettings } from '../settings/schema/appSettings'

import { shouldBypass } from './proxyBypass'
import {
  buildSessionProxyConfig,
  normalizeProxyBypassRules,
  resolveCustomProxyRules,
  validateNetworkSettings
} from './proxyConfig'

describe('proxyConfig', () => {
  it('builds system and direct proxy modes', () => {
    expect(buildSessionProxyConfig({ ...createDefaultAppSettings().network, proxyMode: 'system' })).toEqual({
      mode: 'system'
    })
    expect(buildSessionProxyConfig({ ...createDefaultAppSettings().network, proxyMode: 'none' })).toEqual({
      mode: 'direct'
    })
  })

  it('routes telegram through the local http proxy and never bypasses it', () => {
    // 用户 2026-11-04 的真实设置：本机 HTTP 代理 + 只绕过本机与两个 BLS 源。
    // 这份配置必须产出「http/https 都走 127.0.0.1:7888」，且 api.telegram.org 不在绕过清单里。
    const config = buildSessionProxyConfig({
      proxyMode: 'custom',
      proxyUrl: 'http://127.0.0.1:7888',
      proxyBypassRules: 'localhost,127.0.0.1,api.bls.gov,www.bls.gov'
    })
    expect(config).toEqual({
      mode: 'fixed_servers',
      proxyRules: 'http=127.0.0.1:7888;https=127.0.0.1:7888',
      proxyBypassRules: 'localhost,127.0.0.1,api.bls.gov,www.bls.gov'
    })
    expect(shouldBypass('api.telegram.org', config.proxyBypassRules ?? '')).toBe(false)
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
    expect(resolveCustomProxyRules('127.0.0.1:6153')).toEqual({
      ok: true,
      rules: 'socks5=127.0.0.1:6153',
      protocol: 'socks5',
      protocolWasImplicit: true
    })
    expect(resolveCustomProxyRules('http://127.0.0.1:7890')).toEqual({
      ok: true,
      rules: 'http=127.0.0.1:7890;https=127.0.0.1:7890',
      protocol: 'http',
      protocolWasImplicit: false
    })
    expect(resolveCustomProxyRules('https://proxy.example.test')).toEqual({
      ok: true,
      rules: 'https=proxy.example.test:443',
      protocol: 'https',
      protocolWasImplicit: false
    })
    expect(resolveCustomProxyRules('socks5h://proxy.example.test')).toEqual({
      ok: true,
      rules: 'socks5=proxy.example.test:1080',
      protocol: 'socks5',
      protocolWasImplicit: false
    })
  })

  it('rejects an address it cannot honour instead of silently going direct', () => {
    expect(resolveCustomProxyRules('http://bad host:7890')).toEqual({ ok: false, reason: 'unparsable' })
    expect(resolveCustomProxyRules('myproxy')).toEqual({ ok: false, reason: 'unparsable' })
    expect(resolveCustomProxyRules('ftp://1.2.3.4:1')).toEqual({ ok: false, reason: 'unsupported-protocol' })
    expect(resolveCustomProxyRules('   ')).toEqual({ ok: false, reason: 'empty' })
  })

  it('refuses to save a custom mode with an address it cannot parse', () => {
    expect(validateNetworkSettings({ proxyMode: 'custom', proxyUrl: 'myproxy', proxyBypassRules: '' })).toEqual({
      ok: false,
      reason: 'unparsable'
    })
    expect(
      validateNetworkSettings({ proxyMode: 'custom', proxyUrl: '127.0.0.1:7890', proxyBypassRules: '' })
    ).toEqual({ ok: true, interpretation: 'socks5-implicit' })
    expect(
      validateNetworkSettings({ proxyMode: 'custom', proxyUrl: 'http://127.0.0.1:7890', proxyBypassRules: '' })
    ).toEqual({ ok: true, interpretation: 'explicit' })
    // 绕过规则超出 Chromium 与 WebSocket 共用的语法时，保存即拒，而不是保存后悄悄不生效。
    expect(
      validateNetworkSettings({ proxyMode: 'custom', proxyUrl: 'http://127.0.0.1:7890', proxyBypassRules: '10.0.0.0/8' })
    ).toEqual({ ok: false, reason: 'bypass-rule-unsupported', unsupported: ['10.0.0.0/8'] })
    // 不用代理的模式不看地址字段：切到「系统代理」不该被残留的坏地址拦住。
    expect(validateNetworkSettings({ proxyMode: 'system', proxyUrl: 'myproxy', proxyBypassRules: '' })).toEqual({
      ok: true,
      interpretation: 'explicit'
    })
  })

  it('normalizes bypass rules', () => {
    expect(normalizeProxyBypassRules('localhost, 127.0.0.1 , ::1')).toBe('localhost,127.0.0.1,::1')
  })
})
