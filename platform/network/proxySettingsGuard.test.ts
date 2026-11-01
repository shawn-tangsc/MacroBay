import { describe, expect, it } from 'vitest'

import { createDefaultAppSettings } from '../settings/schema/appSettings'

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
    expect(readProxyRejectionReason(rejectionOf('http://bad host:7890'))).toBe('unparsable')
    expect(readProxyRejectionReason(rejectionOf('myproxy'))).toBe('unparsable')
    expect(readProxyRejectionReason(rejectionOf('ftp://1.2.3.4:1'))).toBe('unsupported-protocol')
    expect(readProxyRejectionReason(rejectionOf(''))).toBe('empty')
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
