import { describe, expect, it, vi } from 'vitest'

/**
 * 窗口模块的运行时快照。
 *
 * 这是第 1 步存在的真正理由：`windowIpc.ts` 可以从外部 import，所以能直接调 `registerWindowIpc`
 * 拿到「它到底注册了哪些通道、按什么顺序」。旧写法读 `app.ts` 源码文本，搬一行就断，
 * 而且它证明的从来不是「运行时注册了什么」。
 */
vi.mock('electron', () => ({
  app: {
    getName: () => 'MacroBay',
    getPath: () => '/tmp',
    getVersion: () => '0.0.0',
    getApplicationInfoForProtocol: async () => ({})
  },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  Menu: { getApplicationMenu: () => null },
  nativeTheme: { shouldUseDarkColors: false },
  shell: { openExternal: async () => undefined, openPath: async () => '' }
}))

const { registerWindowIpc } = await import('./windowIpc')

const EXPECTED_CHANNELS = [
  'platform:app-info',
  'platform:window-minimize',
  'platform:window-maximize',
  'platform:window-close',
  'platform:window-is-maximized',
  'platform:window-set-minimum-size',
  'platform:window-reset-minimum-size',
  'platform:window-menu-list',
  'platform:window-menu-popup',
  'platform:shell-open-external',
  'platform:shell-open-path',
  'platform:app-quote-to-main',
  'platform:dialog-select-directory',
  'platform:dialog-select-files',
  'platform:app-read-text-file',
  'platform:app-save-clipboard-image'
]

function record(): { channels: string[]; ipcMain: { handle: (channel: string, listener: unknown) => void } } {
  const channels: string[] = []
  return {
    channels,
    ipcMain: {
      handle: (channel: string) => {
        // 真实 ipcMain 对同名通道会抛错；recorder 必须模拟这条，否则重复注册会被静默吞掉。
        if (channels.includes(channel)) throw new Error(`duplicate channel: ${channel}`)
        channels.push(channel)
      }
    }
  }
}

describe('window ipc surface', () => {
  it('registers exactly the sixteen window/app/shell/dialog channels, in order', () => {
    const { channels, ipcMain } = record()
    registerWindowIpc(ipcMain as never, {
      getMainWindow: () => null,
      resolveInvokingWindow: () => null
    })

    expect(channels).toEqual(EXPECTED_CHANNELS)
  })

  it('takes run-time state only through its two ports', async () => {
    // 「只依赖两个端口」说的是运行期状态，不是 import 的数量：app/dialog/shell 是无状态 API，直连即可。
    const source = await import('node:fs').then(({ readFileSync }) =>
      readFileSync(new URL('./windowIpc.ts', import.meta.url), 'utf8')
    )
    // 不允许出现的是**运行期状态的实例**；`getMainWindow()` 本身是端口调用，属于正确用法。
    for (const disallowed of ['settingsStore', 'shellTimeZone', 'let mainWindow', 'let tray']) {
      expect(source).not.toContain(disallowed)
    }
    expect(source).toContain('ports: WindowIpcPorts')
  })
})
