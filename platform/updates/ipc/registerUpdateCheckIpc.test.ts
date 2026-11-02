import type { IpcMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'

import { IpcChannels } from '../../desktop/ipc/channels'
import { updateDownloadPageUrl } from '../updateSource'
import { openUpdateDownloadPage } from '../runtime/openUpdateDownloadPage'
import { registerUpdateCheckIpc } from './registerUpdateCheckIpc'

type Handler = (event: unknown, ...args: unknown[]) => unknown

function createIpcMain(): { ipcMain: Pick<IpcMain, 'handle'>; handlers: Map<string, Handler>; channels: string[] } {
  const handlers = new Map<string, Handler>()
  const channels: string[] = []
  const ipcMain = {
    handle(channel: string, handler: unknown) {
      channels.push(channel)
      handlers.set(channel, handler as Handler)
    }
  } as unknown as Pick<IpcMain, 'handle'>
  return { ipcMain, handlers, channels }
}

const projection = {
  state: 'available' as const,
  currentVersion: '0.3.1',
  latestVersion: '0.4.0',
  checkedAt: '2026-11-03T00:10:00.000Z'
}

describe('registering the update check channels', () => {
  it('registers all three in a packaged build, with the agreed channel names', () => {
    const ipc = createIpcMain()
    registerUpdateCheckIpc(ipc.ipcMain, {
      mode: 'packaged',
      getProjection: () => projection,
      checkNow: async () => projection,
      openDownloadPage: async () => ({ ok: true })
    })

    expect(ipc.channels).toEqual([
      IpcChannels.updatesGetState,
      IpcChannels.updatesCheckNow,
      IpcChannels.updatesOpenDownload
    ])
  })

  it('leaves the two action channels unregistered in development, so no request can even be sent', () => {
    const ipc = createIpcMain()
    const checkNow = vi.fn(async () => projection)
    const openDownloadPage = vi.fn(async () => ({ ok: true }))

    registerUpdateCheckIpc(ipc.ipcMain, {
      mode: 'development',
      getProjection: () => ({ state: 'development' }),
      checkNow,
      openDownloadPage
    })

    expect(ipc.channels).toEqual([IpcChannels.updatesGetState])
    // 不是「注册了再返回不可用」：通道根本不在，调用方拿到的是 Electron 的「没有 handler」。
    expect(ipc.handlers.has(IpcChannels.updatesCheckNow)).toBe(false)
    expect(ipc.handlers.has(IpcChannels.updatesOpenDownload)).toBe(false)
    expect(checkNow).not.toHaveBeenCalled()
    expect(openDownloadPage).not.toHaveBeenCalled()
  })

  it('answers the state channel with the current projection', async () => {
    const ipc = createIpcMain()
    registerUpdateCheckIpc(ipc.ipcMain, {
      mode: 'packaged',
      getProjection: () => projection,
      checkNow: async () => projection,
      openDownloadPage: async () => ({ ok: true })
    })

    const handler = ipc.handlers.get(IpcChannels.updatesGetState)
    await expect(Promise.resolve(handler?.({}))).resolves.toEqual(projection)
  })

  it('ignores an address smuggled into the payload and opens the constant page instead', async () => {
    const opened: string[] = []
    const ipc = createIpcMain()
    registerUpdateCheckIpc(ipc.ipcMain, {
      mode: 'packaged',
      getProjection: () => projection,
      checkNow: async () => projection,
      // 生产里这个端口就是 openUpdateDownloadPage：地址由常量拼出，入参里没有地址。
      openDownloadPage: () =>
        openUpdateDownloadPage({
          openExternal: async (url) => {
            opened.push(url)
          },
          log: () => undefined
        })
    })

    const handler = ipc.handlers.get(IpcChannels.updatesOpenDownload)
    await handler?.({}, { url: 'https://example.invalid/evil' })

    // E4 的反向用例：把实现改成读载荷（或读元数据里的 files[].url）时，这条必须变红。
    expect(opened).toEqual([updateDownloadPageUrl()])
    expect(opened[0]).not.toContain('example.invalid')
  })

  it('answers ok:false instead of throwing when the browser cannot be opened', async () => {
    const ipc = createIpcMain()
    registerUpdateCheckIpc(ipc.ipcMain, {
      mode: 'packaged',
      getProjection: () => projection,
      checkNow: async () => projection,
      openDownloadPage: async () => ({ ok: false })
    })

    const handler = ipc.handlers.get(IpcChannels.updatesOpenDownload)
    // 不 throw 是契约的一部分：渲染层靠结果判断有没有打开，不靠异常。
    await expect(Promise.resolve(handler?.({}))).resolves.toEqual({ ok: false })
  })
})
