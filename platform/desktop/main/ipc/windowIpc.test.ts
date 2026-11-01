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

  it('keeps the snapshot in step with the source: no channel appears without the list', async () => {
    // 产品经理那条「只许多不许少」的机械版本：源码里引用的通道名，必须与签入清单逐名相等。
    // 少一个 → 有人把通道搬走了而清单没跟上；多一个 → 有人加了通道而清单没更新。
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('./windowIpc.ts', import.meta.url), 'utf8')
    const referenced = [...source.matchAll(/IpcChannels\.(\w+)/gu)].map((match) => match[1])

    const { IpcChannels } = await import('../../ipc/channels')
    const names = [...new Set(referenced)].map(
      (key) => (IpcChannels as Record<string, string>)[key]
    )
    expect(names.sort()).toEqual([...EXPECTED_CHANNELS].sort())
  })

  it('keeps the visible literals a pinned list, on both the Chinese and English side', async () => {
    // 搬进来时带着 5 条界面可见文案（两个对话框标题 + 三条英文错误）——那是存量，不是许可。
    // 覆盖面按**出现位置**而不是按词：中文逐条计数（不去重），英文只认"可见位置的字符串"，
    // 清单外冒出来的任何一句都红。先剥注释再扫，否则一句解释规则的注释会被当成违规。
    const { readFileSync } = await import('node:fs')
    const raw = readFileSync(new URL('./windowIpc.ts', import.meta.url), 'utf8')
    const source = raw.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '')

    const cjk = [...source.matchAll(/['"`]([^'"`\n]*[\u4e00-\u9fff][^'"`\n]*)['"`]/gu)].map((m) => m[1])
    // 不去重：重复写一句同样的中文也要红。
    expect(cjk.filter((text) => text === '选择工作区')).toHaveLength(1)
    expect(cjk.filter((text) => text === '选择附件')).toHaveLength(1)
    expect(new Set(cjk)).toHaveProperty('size', 2)

    // 英文侧：只看"会显示给用户的位置"——throw new Error(…) 与 title/label/message/placeholder/aria-*。
    const visibleSlots = [
      ...source.matchAll(/throw new Error\(\s*'([^']*)'/gu),
      ...source.matchAll(/\b(?:title|label|message|placeholder|description|ariaLabel)\s*:\s*'([^']*)'/gu)
    ].map((match) => match[1])
    expect([...new Set(visibleSlots)].sort()).toEqual(
      [
        'Clipboard image is empty or too large.',
        'Invalid clipboard image payload.',
        'Only http(s) URLs can be opened externally.',
        '选择工作区',
        '选择附件'
      ].sort()
    )
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
