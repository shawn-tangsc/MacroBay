import { describe, expect, it } from 'vitest'

import { createDefaultAppSettings, normalizeNetworkSettings } from '../settings/schema/appSettings'

import {
  assertProxySettingsPatchAccepted,
  mergeNetworkSettingsPatch,
  readProxyRejectionReason
} from './proxySettingsGuard'

const currentNetwork = () => createDefaultAppSettings().network

function rejectionOf(proxyUrl: string): unknown {
  try {
    assertProxySettingsPatchAccepted(
      { network: { proxyMode: 'custom', proxyUrl, proxyBypassRules: 'localhost' } },
      currentNetwork()
    )
    return null
  } catch (error) {
    return error
  }
}

describe('proxySettingsGuard', () => {
  it('refuses a custom address it cannot honour, with a reason the UI can name', () => {
    expect(readProxyRejectionReason(rejectionOf('http://bad host:7890'))).toMatchObject({ reason: 'unparsable' })
    expect(readProxyRejectionReason(rejectionOf('myproxy'))).toMatchObject({ reason: 'unparsable' })
    expect(readProxyRejectionReason(rejectionOf('ftp://1.2.3.4:1'))).toMatchObject({ reason: 'unsupported-protocol' })
    expect(readProxyRejectionReason(rejectionOf(''))).toMatchObject({ reason: 'empty' })
  })

  it('does not let a stored proxy problem block an unrelated save', () => {
    // 现象：语言存不下来。根因是校验每次保存都跑，并沿用库里的旧网络数据。
    const staleNetwork = { proxyMode: 'custom' as const, proxyUrl: 'myproxy', proxyBypassRules: 'localhost' }
    expect(() => assertProxySettingsPatchAccepted({ language: 'en-US' }, staleNetwork)).not.toThrow()
    expect(() => assertProxySettingsPatchAccepted({ themeMode: 'dark' }, staleNetwork)).not.toThrow()
    // 真改网络时才校验，并给得出原因。
    expect(() => assertProxySettingsPatchAccepted({ network: staleNetwork }, staleNetwork)).toThrow()
  })

  it('keeps an unsupported rule the user wrote, and only refuses it when the network is being changed', () => {
    const legacy = 'localhost;10.0.0.0/8;:1;api.bls.gov'
    const normalized = normalizeNetworkSettings({
      proxyMode: 'custom',
      proxyUrl: 'http://127.0.0.1:7890',
      proxyBypassRules: legacy
    })

    // 读取只做格式：CIDR 是用户写的有意义规则，必须原样留着，只有 :1 这种残留被丢。
    expect(normalized.proxyBypassRules).toBe('localhost,10.0.0.0/8,api.bls.gov')
    // 只改语言不会被它挡住。
    expect(() => assertProxySettingsPatchAccepted({ language: 'en-US' }, normalized)).not.toThrow()
    // 真去改网络时才被拒，并且错误里指名是哪一条。
    let caught: unknown
    try {
      assertProxySettingsPatchAccepted({ network: normalized }, normalized)
    } catch (error) {
      caught = error
    }
    expect(readProxyRejectionReason(caught)).toEqual({ reason: 'bypass-rule-unsupported', detail: '10.0.0.0/8' })
  })

  it('migrates semicolon-separated legacy rules instead of trapping the user', () => {
    const normalized = normalizeNetworkSettings({
      proxyMode: 'custom',
      proxyUrl: 'socks5://127.0.0.1:1080',
      proxyBypassRules: 'localhost;127.0.0.1;:1;api.bls.gov;www.bls.gov'
    })

    expect(normalized.proxyBypassRules).toBe('localhost,127.0.0.1,api.bls.gov,www.bls.gov')
    expect(() =>
      assertProxySettingsPatchAccepted(
        { network: { proxyMode: 'custom', proxyUrl: 'http://127.0.0.1:7890', proxyBypassRules: normalized.proxyBypassRules } },
        currentNetwork()
      )
    ).not.toThrow()
  })

  it('lets a bare host:port through, because it is a supported shorthand', () => {
    expect(rejectionOf('127.0.0.1:7890')).toBeNull()
  })

  it('does not block switching away from custom because of a stale bad address', () => {
    expect(() =>
      assertProxySettingsPatchAccepted(
        { network: { proxyMode: 'system', proxyUrl: 'myproxy', proxyBypassRules: '' } },
        currentNetwork()
      )
    ).not.toThrow()
  })

  it('keeps current values for fields the patch does not carry', () => {
    const current = currentNetwork()
    expect(mergeNetworkSettingsPatch({}, current)).toEqual(current)
    expect(
      mergeNetworkSettingsPatch({ network: { proxyMode: 'custom', proxyUrl: 'http://127.0.0.1:7890' } }, current)
    ).toEqual({ proxyMode: 'custom', proxyUrl: 'http://127.0.0.1:7890', proxyBypassRules: current.proxyBypassRules })
  })

  it('ignores a patch network value that is not an object', () => {
    expect(mergeNetworkSettingsPatch({ network: 'nope' }, currentNetwork())).toEqual(currentNetwork())
  })
})
