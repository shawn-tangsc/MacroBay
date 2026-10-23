import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => {
  const loadURL = vi.fn(async () => undefined)
  const loadFile = vi.fn(async () => undefined)
  const show = vi.fn()
  const setWindowOpenHandler = vi.fn()
  const once = vi.fn()
  const openExternal = vi.fn()
  const constructedOptions: { webPreferences?: Record<string, unknown>; backgroundColor?: string }[] = []

  class BrowserWindow {
    webContents = { setWindowOpenHandler }
    loadFile = loadFile
    loadURL = loadURL
    show = show
    once = once
    constructor(options: { webPreferences?: Record<string, unknown>; backgroundColor?: string }) {
      constructedOptions.push(options)
    }
  }

  return { BrowserWindow, constructedOptions, loadFile, loadURL, once, openExternal, setWindowOpenHandler, show }
})

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: electronMocks.BrowserWindow,
  nativeTheme: { shouldUseDarkColors: true },
  shell: { openExternal: electronMocks.openExternal }
}))

import { WINDOW_BACKGROUND_COLOR } from '@platform/ui/theme/windowTheme'
import {
  assertSecureWindowSecurity,
  createMainWindow,
  createSecureWindowSecurity,
  isAllowedAppWindowEntryUrl,
  loadMainWindowRenderer
} from './createMainWindow'

describe('main window startup', () => {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL

  afterEach(() => {
    electronMocks.loadFile.mockClear()
    electronMocks.loadURL.mockClear()
    electronMocks.show.mockClear()
    electronMocks.setWindowOpenHandler.mockClear()
    electronMocks.openExternal.mockClear()
    electronMocks.constructedOptions.length = 0
    if (rendererUrl === undefined) delete process.env.ELECTRON_RENDERER_URL
    else process.env.ELECTRON_RENDERER_URL = rendererUrl
  })

  it('makes an about:blank boot window visible before the normal renderer is requested', async () => {
    process.env.ELECTRON_RENDERER_URL = 'http://127.0.0.1:5173'

    const window = await createMainWindow()

    expect(electronMocks.loadURL).toHaveBeenCalledWith('about:blank')
    expect(electronMocks.show).toHaveBeenCalledOnce()
    expect(electronMocks.loadFile).not.toHaveBeenCalled()

    await loadMainWindowRenderer(window)

    expect(electronMocks.loadURL).toHaveBeenLastCalledWith('http://127.0.0.1:5173')
  })
})

describe('shared secure window configuration', () => {
  afterEach(() => {
    electronMocks.constructedOptions.length = 0
    electronMocks.openExternal.mockClear()
    electronMocks.setWindowOpenHandler.mockClear()
  })

  it('gives the main window exactly the set the shared builder hands to detached panel windows', async () => {
    await createMainWindow()
    const options = electronMocks.constructedOptions.at(-1)
    expect(options?.webPreferences).toBeDefined()

    // 两条路径唯一来源：主窗实际使用的 webPreferences 与共享 builder 的输出逐字段一致
    const shared = createSecureWindowSecurity({ preload: String(options?.webPreferences?.preload), openExternal: () => undefined })
    expect(options?.webPreferences).toEqual(shared.webPreferences)
    expect(options?.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false
    })
    // 独立面板窗消费同一对象（WorkspaceWindowSecurityInput + 宿主 fail-closed 校验）
    expect(() => assertSecureWindowSecurity(shared)).not.toThrow()
  })

  it('denies every window.open and forwards only http(s) links to openExternal', async () => {
    await createMainWindow()
    const handler = electronMocks.setWindowOpenHandler.mock.calls.at(-1)?.[0] as ((details: { url: string }) => { action: 'deny' }) | undefined
    expect(handler).toBeTypeOf('function')

    expect(handler?.({ url: 'https://example.com/doc' })).toEqual({ action: 'deny' })
    expect(electronMocks.openExternal).toHaveBeenCalledWith('https://example.com/doc')
    expect(handler?.({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' })
    expect(electronMocks.openExternal).toHaveBeenCalledTimes(1)
  })

  it('accepts app-root entries whose real path contains spaces, non-ASCII or a literal percent', () => {
    // 常见安装路径（macOS /Applications/My App.app、中文用户名、含字面 %）都必须可用：
    // WHATWG URL 必然把这些字符编码成 %20/%xx，所以判定必须是「解码后按路径比较」而不是拒绝百分号
    for (const rootPath of ['/Applications/My App.app/renderer', '/Users/张三/App/renderer', '/app/100%/renderer']) {
      const policy = { appRoot: pathToFileURL(rootPath).href }
      expect(isAllowedAppWindowEntryUrl(pathToFileURL(`${rootPath}/index.html`).href, policy)).toBe(true)
      expect(isAllowedAppWindowEntryUrl(pathToFileURL(`${rootPath}/assets/main.js`).href, policy)).toBe(true)
      expect(isAllowedAppWindowEntryUrl(pathToFileURL('/etc/passwd').href, policy)).toBe(false)
      expect(isAllowedAppWindowEntryUrl(pathToFileURL('/Applications/My App.app/renderer-evil/x.html').href, policy)).toBe(false)
    }
  })

  it('fails closed when a window security object is weakened at runtime', () => {
    const shared = createSecureWindowSecurity({ preload: '/preload/index.js', openExternal: () => undefined })
    expect(() => assertSecureWindowSecurity({ ...shared, webPreferences: { ...shared.webPreferences, contextIsolation: false } })).toThrow(/security/)
    expect(() => assertSecureWindowSecurity({ ...shared, webPreferences: { ...shared.webPreferences, nodeIntegration: true } })).toThrow(/security/)
    expect(() => assertSecureWindowSecurity({ ...shared, webPreferences: { ...shared.webPreferences, webSecurity: false } })).toThrow(/security/)
    expect(() => assertSecureWindowSecurity({ ...shared, webPreferences: { ...shared.webPreferences, preload: '' } })).toThrow(/security/)
  })

  it('only allows app-static entries inside the injected app root, or explicitly injected dev origins', () => {
    const policy = { appRoot: 'file:///app/renderer' }
    expect(isAllowedAppWindowEntryUrl('file:///app/renderer/index.html', policy)).toBe(true)
    expect(isAllowedAppWindowEntryUrl('file:///app/renderer', policy)).toBe(true)
    // F4：file: 不再一律放行，必须落在应用根内
    expect(isAllowedAppWindowEntryUrl('file:///etc/passwd', policy)).toBe(false)
    expect(isAllowedAppWindowEntryUrl('file:///app/renderer/../../etc/passwd', policy)).toBe(false)
    expect(isAllowedAppWindowEntryUrl('file:///app/renderer-evil/index.html', policy)).toBe(false)
    // F7：非空 host 的 file: 与百分号编码分隔符一律拒绝
    expect(isAllowedAppWindowEntryUrl('file://evilhost/app/renderer/index.html', policy)).toBe(false)
    expect(isAllowedAppWindowEntryUrl('file:///app/renderer/..%2f..%2fetc/passwd', policy)).toBe(false)
    expect(isAllowedAppWindowEntryUrl('file:///app/renderer/..%2F..%2Fetc/passwd', policy)).toBe(false)
    expect(isAllowedAppWindowEntryUrl('file:///app/renderer/..%5c..%5cetc/passwd', policy)).toBe(false)
    expect(isAllowedAppWindowEntryUrl('file:///app/renderer/%2e%2e/etc/passwd', policy)).toBe(false)
    expect(isAllowedAppWindowEntryUrl('file:///app/renderer/index.html', { appRoot: '' })).toBe(false)
    expect(isAllowedAppWindowEntryUrl('https://evil.example/app', policy)).toBe(false)
    expect(isAllowedAppWindowEntryUrl('not a url', policy)).toBe(false)
    expect(isAllowedAppWindowEntryUrl('http://127.0.0.1:5173/', { ...policy, devOrigins: ['http://127.0.0.1:5173'] })).toBe(true)
    expect(isAllowedAppWindowEntryUrl('http://127.0.0.1:5173/', policy)).toBe(false)
    expect(isAllowedAppWindowEntryUrl('http://127.0.0.1:9999/', { ...policy, devOrigins: ['http://127.0.0.1:5173'] })).toBe(false)
  })
})

/**
 * Owner: platform/desktop/window（**PLAT-42 ①**：主窗原生底色必须与分离窗同源派生）。
 *
 * 缺陷：`createMainWindow.ts:188` 曾硬编码 `backgroundColor: '#101114'`，而分离面板窗按
 * `nativeTheme.shouldUseDarkColors` 派生 `#0b0d10`/`#ffffff` ⇒ 同一 app 的两类窗口在正文首帧之前是两种底色，
 * 且 `#101114` 不对应任何主题 token（既不是 `--bg` 也不是 `--surface`）。
 *
 * 判据：底色是**派生值**（深/浅两态）、来源**唯一**（`@platform/ui/theme/windowTheme`），
 * 且两个建窗路径**不再各自持有字面量**（源码护栏）。
 */
/** 源码里的注释允许记录历史值（如 `#101114`）；判据只约束代码本身，因此先剥注释。 */
function withoutSourceComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1')
}

describe('PLAT-42：主窗原生底色由主题单源派生（深浅两态）', () => {
  const platformDir = 'platform/desktop'

  afterEach(() => {
    electronMocks.constructedOptions.length = 0
  })

  it('深色/浅色系统外观 ⇒ 主窗底色为单源的对应值（不再硬编码 #101114）', async () => {
    await createMainWindow({ systemPrefersDark: () => true })
    expect(electronMocks.constructedOptions.at(-1)?.backgroundColor).toBe(WINDOW_BACKGROUND_COLOR.dark)
    expect(WINDOW_BACKGROUND_COLOR.dark).toBe('#0b0d10')

    await createMainWindow({ systemPrefersDark: () => false })
    expect(electronMocks.constructedOptions.at(-1)?.backgroundColor).toBe(WINDOW_BACKGROUND_COLOR.light)
    expect(WINDOW_BACKGROUND_COLOR.light).toBe('#ffffff')
  })

  it('缺省读 nativeTheme（与分离窗的系统外观来源同一个），不是写死的常量', async () => {
    await createMainWindow()
    // mock 的 nativeTheme.shouldUseDarkColors = true ⇒ 深色派生值
    expect(electronMocks.constructedOptions.at(-1)?.backgroundColor).toBe(WINDOW_BACKGROUND_COLOR.dark)
  })

  it('两个建窗路径都不持有颜色字面量，且都从同一个单源取底色', () => {
    for (const file of ['window/createMainWindow.ts', 'main/workspace/panelDetachedWindowFactory.ts']) {
      const source = readFileSync(resolve(process.cwd(), platformDir, file), 'utf8')
      expect(withoutSourceComments(source), file).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(source, file).toContain('resolveWindowBackgroundColor')
      // 同一个模块：主进程内相对导入 / 跨层别名导入都可，判据是「指向同一单源」
      expect(source, file).toContain('ui/theme/windowTheme')
    }
  })
})
