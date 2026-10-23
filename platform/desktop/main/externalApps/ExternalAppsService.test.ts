import { describe, expect, it, vi } from 'vitest'

import { ExternalAppsService } from './ExternalAppsService'
import { buildExternalAppWorkspaceUrl, validateLaunchExternalAppRequest } from './externalAppLauncher'
import { EXTERNAL_APPS, isExternalAppId } from './externalAppRegistry'

describe('externalAppRegistry', () => {
  it('allow-lists vscode, cursor, and zed only', () => {
    expect(EXTERNAL_APPS.map((app) => app.id)).toEqual(['vscode', 'cursor', 'zed'])
    expect(isExternalAppId('vscode')).toBe(true)
    expect(isExternalAppId('notepad')).toBe(false)
  })
})

describe('externalAppLauncher', () => {
  it('builds protocol URLs for absolute workspace paths', () => {
    // Absolute Unix paths keep the leading slash after `file/`, matching the file/ URL shape.
    expect(
      buildExternalAppWorkspaceUrl({ id: 'vscode', protocol: 'vscode://' }, '/Users/demo/project')
    ).toBe('vscode://file//Users/demo/project?windowId=_blank')
    expect(
      buildExternalAppWorkspaceUrl({ id: 'zed', protocol: 'zed://' }, '/Users/demo/project')
    ).toBe('zed://file/Users/demo/project')
  })

  it('rejects relative workspace paths and unknown app ids', () => {
    expect(() =>
      validateLaunchExternalAppRequest({ appId: 'vscode', workspacePath: 'relative/path' })
    ).toThrow(/absolute/)
    expect(() =>
      validateLaunchExternalAppRequest({ appId: 'notepad', workspacePath: '/tmp/project' })
    ).toThrow(/allow-listed/)
  })
})

describe('ExternalAppsService', () => {
  it('detects installed apps through injectable protocol lookup and caches results', async () => {
    const getApplicationInfoForProtocol = vi
      .fn()
      .mockResolvedValueOnce({ name: 'Visual Studio Code', path: '/Applications/Visual Studio Code.app' })
      .mockRejectedValueOnce(new Error('not installed'))
      .mockResolvedValueOnce({ name: 'Zed', path: '/Applications/Zed.app' })

    const service = new ExternalAppsService({
      getApplicationInfoForProtocol,
      openExternal: vi.fn(async () => undefined),
      now: () => 1_000,
      cacheDurationMs: 5_000
    })

    const first = await service.detectInstalledApps()
    expect(first.map((app) => app.id)).toEqual(['vscode', 'zed'])
    expect(getApplicationInfoForProtocol).toHaveBeenCalledTimes(3)

    const second = await service.detectInstalledApps()
    expect(second).toEqual(first)
    expect(getApplicationInfoForProtocol).toHaveBeenCalledTimes(3)
  })

  it('launches only allow-listed installed apps with absolute workspace paths', async () => {
    const openExternal = vi.fn(async () => undefined)
    const service = new ExternalAppsService({
      getApplicationInfoForProtocol: async (protocol) => {
        if (protocol === 'cursor://') {
          return { name: 'Cursor', path: '/Applications/Cursor.app' }
        }
        throw new Error('missing')
      },
      openExternal
    })

    const result = await service.launchWorkspace({
      appId: 'cursor',
      workspacePath: '/Users/demo/workspace'
    })

    expect(result).toEqual({
      ok: true,
      appId: 'cursor',
      url: 'cursor://file//Users/demo/workspace?windowId=_blank'
    })
    expect(openExternal).toHaveBeenCalledWith('cursor://file//Users/demo/workspace?windowId=_blank')

    await expect(
      service.launchWorkspace({
        appId: 'vscode',
        workspacePath: '/Users/demo/workspace'
      })
    ).rejects.toThrow(/not installed/)
  })

  it('exposes renderer-safe installed views', async () => {
    const service = new ExternalAppsService({
      getApplicationInfoForProtocol: async (protocol) => {
        if (protocol === 'cursor://') {
          return { name: 'Cursor', path: '/Applications/Cursor.app' }
        }
        throw new Error('missing')
      },
      openExternal: vi.fn(async () => undefined)
    })

    const views = await service.listInstalledAppViews()
    expect(views).toEqual([
      {
        id: 'cursor',
        name: 'Cursor',
        protocol: 'cursor://',
        tags: ['code-editor'],
        installed: true,
        path: '/Applications/Cursor.app'
      }
    ])
  })
})
