import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { posix, relative, win32 } from 'node:path'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULT_MIN_WINDOW_HEIGHT, DEFAULT_MIN_WINDOW_WIDTH } from '../../ui/window/windowSizing'
import { resolveWindowBackgroundColor } from '../../ui/theme/windowTheme'
import { APP_DISPLAY_NAME } from '../appIdentity'
import { resolveWindowChromeOptions } from './windowChrome'

/**
 * Owner: platform/desktop/window。权威：技术设计 §4（安全、快照与 IPC）与 P1-04。
 *
 * 这里是「本应用窗口安全基线」的唯一来源：主窗与独立面板窗必须消费同一集合，
 * 不得各自复制一份布尔值。owner capability/token 绝不进入 URL、additionalArguments、
 * preload 暴露面、快照或日志，因此本文件只描述窗口安全开关，不携带任何身份材料。
 */

/** 安全开关集合：主窗与独立窗逐字段一致；新增开关必须同时被两条路径消费。 */
export type SecureWindowWebPreferences = {
  preload: string
  contextIsolation: true
  nodeIntegration: false
  sandbox: false
  webSecurity: true
  allowRunningInsecureContent: false
  experimentalFeatures: false
  nodeIntegrationInWorker: false
  nodeIntegrationInSubFrames: false
}

/** setWindowOpenHandler 目标的最小端口（不依赖 electron 类型，便于独立窗宿主注入与测试）。 */
export type WindowOpenHandlerTarget = {
  setWindowOpenHandler: (handler: (details: { url: string }) => { action: 'deny' }) => void
}

export type WorkspaceWindowSecurity = {
  webPreferences: SecureWindowWebPreferences
  /** 一律 deny 新窗口；http(s) 外链交给宿主注入的 openExternal。 */
  applyWindowOpenHandler: (webContents: WindowOpenHandlerTarget) => void
}

/** 运行时（可能被误配置）的宽松形状：供消费方 fail-closed 校验，而不是信任调用方。 */
export type WorkspaceWindowWebPreferencesInput = {
  preload: string
  contextIsolation: boolean
  nodeIntegration: boolean
  sandbox?: boolean
  webSecurity?: boolean
  allowRunningInsecureContent?: boolean
  experimentalFeatures?: boolean
  nodeIntegrationInWorker?: boolean
  nodeIntegrationInSubFrames?: boolean
}
export type WorkspaceWindowSecurityInput = {
  webPreferences: WorkspaceWindowWebPreferencesInput
  applyWindowOpenHandler: (webContents: WindowOpenHandlerTarget) => void
}

/** 任何窗口（主窗或独立面板窗）都必须满足的安全基线；缺失即 fail closed。 */
export function assertSecureWindowSecurity(security: WorkspaceWindowSecurityInput): void {
  const prefs = security.webPreferences
  const unsafe = prefs.contextIsolation !== true || prefs.nodeIntegration !== false
    || prefs.webSecurity === false || prefs.allowRunningInsecureContent === true
    || prefs.experimentalFeatures === true || prefs.nodeIntegrationInWorker === true
    || prefs.nodeIntegrationInSubFrames === true || typeof prefs.preload !== 'string' || prefs.preload.length === 0
    || typeof security.applyWindowOpenHandler !== 'function'
  if (unsafe) throw new Error('window-security-rejected: 窗口必须使用与主窗一致的安全基线')
}

/**
 * 窗口只允许加载本应用静态 entry（P1-04 F4/F9）：
 *  - `file:` 必须被约束在注入的应用根（file: URL）内，`appRoot` 缺失或非法时一律 fail closed，
 *    避免调用方传入 `file:///etc/passwd` 这类任意路径；
 *  - 判定必须**先解码再按真实路径比较**（`fileURLToPath` + `path.relative`）：WHATWG URL 必然把
 *    空格/非 ASCII 编码成 %20/%xx，若按字符串前缀或拒绝百分号就会把合法安装路径（macOS
 *    `/Applications/My App.app`、`C:\Program Files\…`、中文用户名、含字面 % 的目录）误拒；
 *  - 编码分隔符（`%2f`）会让 `fileURLToPath` 抛错、`%5c` 需按 Windows 规则判定，二者都逃不出根；
 *  - dev 态只接受显式注入的 origin 精确匹配（默认空集合）。
 */
export type AppWindowEntryPolicy = { appRoot: string; devOrigins?: readonly string[] }

export function isAllowedAppWindowEntryUrl(url: string, policy: AppWindowEntryPolicy): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol === 'file:') {
    // 非空 host（file://host/...）一律拒绝；其余按解码后的真实路径判断是否落在应用根内
    if (parsed.host !== '') return false
    const root = appRootPath(policy.appRoot)
    if (root === null) return false
    let candidate: string
    try {
      candidate = fileURLToPath(parsed) // 编码分隔符（%2f）会抛 ERR_INVALID_FILE_URL_PATH ⇒ fail closed
    } catch {
      return false
    }
    return !escapesAppRoot(root, candidate)
  }
  return (policy.devOrigins ?? []).some((origin) => {
    try {
      return new URL(origin).origin === parsed.origin
    } catch {
      return false
    }
  })
}

/**
 * 是否逃出应用根：`..` 逃逸与跨盘/跨根都算逃出；根内（含根自身）不算。
 *
 * 两条规则各有归属，不能对同一段路径同时套：
 *  - 形如 Windows 的路径（盘符或反斜杠）只按 `win32` 规则判。把它交给 `posix.relative` 会把
 *    `D:\app\renderer` 与 `D:\app\renderer\index.html` 当成两个**相对名字**，算出一个并不存在的
 *    `../D:\app\...` —— 真机现象是 Windows 上**所有**合法 entry 都被判成逃逸
 *    （`detached-window-entry-rejected`，独立窗工厂构造失败、app 起不来）；
 *  - 其余路径只按 POSIX 规则判。POSIX 上 `%5c` 只是普通字符、Windows 视其为分隔符，所以
 *    含反斜杠的候选一律落到上面的 `win32` 分支（越界仍由 `..\` 规则抓住，不放宽）。
 */
function escapesAppRoot(root: string, candidate: string): boolean {
  const outside = (sub: string, separator: string, isAbsolute: (value: string) => boolean): boolean =>
    sub === '..' || sub.startsWith(`..${separator}`) || isAbsolute(sub)
  const looksWindowsPath = (value: string): boolean => /^[a-zA-Z]:/.test(value) || value.includes('\\')
  const posixEscapes = looksWindowsPath(root) || looksWindowsPath(candidate)
    ? false
    : outside(posix.relative(root, candidate), '/', posix.isAbsolute)
  return posixEscapes || outside(win32.relative(root, candidate), '\\', win32.isAbsolute)
}

/** 应用根本身必须是一个合法的 file: URL 绝对路径；缺失/相对/根目录一律 fail closed。 */
function appRootPath(appRoot: string): string | null {
  if (typeof appRoot !== 'string' || appRoot.length === 0) return null
  let parsed: URL
  try {
    parsed = new URL(appRoot)
  } catch {
    return null
  }
  if (parsed.protocol !== 'file:' || parsed.host !== '') return null
  try {
    const path = fileURLToPath(parsed)
    return path === '' || path === '/' ? null : path
  } catch {
    return null
  }
}

/** 具名安全基线：任何窗口都必须满足；缺失即 fail closed。 */
export const SECURE_WINDOW_PREFERENCE_BASELINE = Object.freeze({
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false
} as const)

export const MAIN_WINDOW_PRELOAD_PATH = '../preload/index.js'

export function createSecureWindowSecurity(input: {
  preload: string
  openExternal: (url: string) => void
}): WorkspaceWindowSecurity {
  const webPreferences: SecureWindowWebPreferences = Object.freeze({
    ...SECURE_WINDOW_PREFERENCE_BASELINE,
    preload: input.preload
  })
  return Object.freeze({
    webPreferences,
    applyWindowOpenHandler(webContents: WindowOpenHandlerTarget): void {
      webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https://') || url.startsWith('http://')) {
          input.openExternal(url)
        }
        return { action: 'deny' as const }
      })
    }
  })
}

/**
 * PLAT-42 ①：主窗**原生底色**的深浅来源（缺省读 `nativeTheme.shouldUseDarkColors`，与分离窗同一个来源）。
 *
 * 缺陷（PLAT-39 复核记录）：这里此前写死 `'#101114'`——一个不对应任何主题 token 的颜色（既不是 `--bg` 也不是
 * `--surface`）。而分离窗已按 `nativeTheme` 派生 `#0b0d10`/`#ffffff` ⇒ 同一个 app 的两类窗口在正文首帧之前
 * 是两种底色。现在两条建窗路径都只经 `platform/ui/theme` 的 `resolveWindowBackgroundColor()` 取值。
 * 注入端口让「底色随主题派生」在测试里**确定可断言**，也避免把 OS 读取散落在多处。
 */
export type MainWindowOptions = {
  systemPrefersDark?: () => boolean
}

/** 缺省深色来源：`nativeTheme.shouldUseDarkColors`（与 `readWorkspaceContextTheme` 的 system 分支同源）。 */
function defaultSystemPrefersDark(): boolean {
  try {
    return nativeTheme.shouldUseDarkColors
  } catch {
    // 平台缺失/被替身遮蔽（测试缝）⇒ 与 `:root` 的深色默认 token 一致，绝不抛
    return true
  }
}

export async function createMainWindow(options: MainWindowOptions = {}): Promise<BrowserWindow> {
  const systemPrefersDark = options.systemPrefersDark ?? defaultSystemPrefersDark
  const security = createSecureWindowSecurity({
    preload: join(__dirname, MAIN_WINDOW_PRELOAD_PATH),
    openExternal: (url) => void shell.openExternal(url)
  })

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: DEFAULT_MIN_WINDOW_WIDTH,
    minHeight: DEFAULT_MIN_WINDOW_HEIGHT,
    show: false,
    title: APP_DISPLAY_NAME,
    autoHideMenuBar: true,
    // 装饰只走 `windowChrome` 的单源策略：macOS 红绿灯内嵌在页面上，Windows 无原生标题条、
    // 由渲染层自绘并画出最小化/最大化/关闭（与独立面板窗同一份选项）。
    ...resolveWindowChromeOptions(),
    // PLAT-42 ①：与分离窗**同源**派生（深 `#0b0d10` / 浅 `#ffffff` = `:root --bg` 两态），不再是 `#101114`
    backgroundColor: resolveWindowBackgroundColor(systemPrefersDark()),
    webPreferences: security.webPreferences
  })

  security.applyWindowOpenHandler(mainWindow.webContents)

  await mainWindow.loadURL('about:blank')
  mainWindow.show()

  return mainWindow
}

export async function loadMainWindowRenderer(mainWindow: BrowserWindow): Promise<void> {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
    return
  }
  await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}
