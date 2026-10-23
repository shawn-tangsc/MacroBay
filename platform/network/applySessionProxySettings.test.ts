import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDefaultAppSettings } from '../settings/schema/appSettings'

vi.mock('electron', () => ({
  session: {
    defaultSession: {
      setProxy: vi.fn(),
      forceReloadProxyConfig: vi.fn(),
      closeAllConnections: vi.fn()
    }
  }
}))

import { session } from 'electron'

import { applySessionProxySettings, SESSION_PROXY_APPLY_POLICY } from './applySessionProxySettings'

describe('applySessionProxySettings', () => {
  afterEach(() => {
    vi.resetAllMocks()
  })

  it('reloads proxy config and closes old connections after applying session proxy settings', async () => {
    const calls: string[] = []
    vi.mocked(session.defaultSession.setProxy).mockImplementation(async () => {
      calls.push('setProxy')
    })
    vi.mocked(session.defaultSession.forceReloadProxyConfig).mockImplementation(async () => {
      calls.push('forceReloadProxyConfig')
    })
    vi.mocked(session.defaultSession.closeAllConnections).mockImplementation(async () => {
      calls.push('closeAllConnections')
    })

    await applySessionProxySettings({
      ...createDefaultAppSettings().network,
      proxyMode: 'custom',
      proxyUrl: 'socks5://127.0.0.1:6153'
    })

    expect(session.defaultSession.setProxy).toHaveBeenCalledWith({
      mode: 'fixed_servers',
      proxyRules: 'socks5=127.0.0.1:6153',
      proxyBypassRules: 'localhost,127.0.0.1,::1'
    })
    expect(calls).toEqual(['setProxy', 'forceReloadProxyConfig', 'closeAllConnections'])
  })

  it('documents the fail-closed ordered proxy application policy', () => {
    expect(SESSION_PROXY_APPLY_POLICY).toEqual({
      owner: 'platform/network/applySessionProxySettings',
      source: 'SessionProxyApplyPolicy',
      steps: ['setProxy', 'forceReloadProxyConfig', 'closeAllConnections'],
      failure: 'propagate-and-stop-desktop-startup',
      testBoundary: 'platform/network/applySessionProxySettings.test.ts'
    })
  })

  it('stops before reload and connection closure when applying the proxy fails', async () => {
    vi.mocked(session.defaultSession.setProxy).mockRejectedValueOnce(new Error('set-proxy-failed'))

    await expect(applySessionProxySettings(createDefaultAppSettings().network)).rejects.toThrow('set-proxy-failed')

    expect(session.defaultSession.forceReloadProxyConfig).not.toHaveBeenCalled()
    expect(session.defaultSession.closeAllConnections).not.toHaveBeenCalled()
  })

  it('stops before connection closure when reloading the proxy config fails', async () => {
    vi.mocked(session.defaultSession.setProxy).mockResolvedValueOnce(undefined)
    vi.mocked(session.defaultSession.forceReloadProxyConfig).mockRejectedValueOnce(new Error('reload-proxy-failed'))

    await expect(applySessionProxySettings(createDefaultAppSettings().network)).rejects.toThrow('reload-proxy-failed')

    expect(session.defaultSession.closeAllConnections).not.toHaveBeenCalled()
  })

  it('propagates a connection closure failure after applying and reloading the proxy', async () => {
    vi.mocked(session.defaultSession.setProxy).mockResolvedValueOnce(undefined)
    vi.mocked(session.defaultSession.forceReloadProxyConfig).mockResolvedValueOnce(undefined)
    vi.mocked(session.defaultSession.closeAllConnections).mockRejectedValueOnce(new Error('close-connections-failed'))

    await expect(applySessionProxySettings(createDefaultAppSettings().network)).rejects.toThrow('close-connections-failed')
  })
})
