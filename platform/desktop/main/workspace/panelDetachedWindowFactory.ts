import { BrowserWindow, nativeTheme } from 'electron'

import { WINDOW_BACKGROUND_COLOR, resolveWindowBackgroundColor } from '@platform/ui/theme/windowTheme'

import type { WorkspaceBounds } from '@platform/workspace/contracts'
import {
  SECURE_WINDOW_PREFERENCE_BASELINE,
  assertSecureWindowSecurity,
  isAllowedAppWindowEntryUrl,
  type AppWindowEntryPolicy,
  type WindowOpenHandlerTarget
} from '../../window/createMainWindow'
import { resolveWindowChromeOptions, wireWindowChromeState } from '../../window/windowChrome'
import type { DetachedWindowFactory, DetachedWindowHandle } from './panelDetachedWindowHost'

/**
 * Owner: platform/desktop/main/workspace。权威：技术设计 §4（窗口安全与受控 entry）与 P1-04 工厂契约。
 *
 * 这是唯一 new BrowserWindow 的地方（P1-04 宿主只依赖注入工厂）：
 * 1) 安全基线只来自 `window/createMainWindow.ts`（`SECURE_WINDOW_PREFERENCE_BASELINE` + 注入 preload），
 *    并且对注入的 security 再做一次 fail-closed 校验，绝不信任调用方；
 * 2) 受控 entry 双点校验：构造时校验注入 entry，`loadURL` 时逐次校验（宿主只会加载 entryUrl，纵深防御）；
 * 3) `setWindowOpenHandler` **无条件** deny（http(s) 只交给注入的 openExternal 出口），句柄上的
 *    `setWindowOpenHandler` 只允许重装同一份 deny —— 注入的 security 哪怕是 no-op/allow 也改不掉结论，
 *    宿主事后的幂等重装同样无效，窗口绝不保留 Electron 默认 `window.open` 行为；
 * 4) `close` = 原生 X：**无条件** preventDefault 后交给 app 侧回停靠（绝不直接逻辑关闭，消费者抛错也不冒泡）；
 *    `onNativeClose` 为**必填**（P1-06e：缺省在类型层即不可构造），运行期守卫只作纵深防御
 *    （`detached-window-native-close-required`，防 JS 调用方/断言绕过），
 *    绝不产生「点了 X 就逻辑关闭、布局不回停靠」或无法关闭的窗口；`closed` 回收登记；
 *    **P1-06m 例外**：app 级退出期（`isAppQuitting()` 为真，`before-quit` 置位）不再 preventDefault，
 *    否则 Electron 的退出关窗相位被取消 ⇒ 窗口全销毁但主进程残留（真机 runG/runI）；该分支也不回停靠；
 * 5) 工厂契约：`new BrowserWindow()` 之后、返回句柄之前抛错必须自行销毁再抛（宿主无法回收未返回的窗口）；
 * 6) N7/P1-06l：崩溃态（`render-process-gone` 主 + `webContents.isCrashed()` 兜底）**广播**给订阅者，使宿主对
 *    准备期与已提交期**同权**感知；只读 `isCrashed()` 仍保留给决策点判词表。只在有人订阅时附一条 `unref()`
 *    的兜底轮询（事件端口缺失的最后保险），最后一个订阅者退订或窗口 `closed` 即停。
 * 7) **PLAT-04**：`resize`/`move` 原样**广播**（句柄 `onBoundsChanged`，可选），本条只报「原生事实」：
 *    不做判断、不合并、不去重（同值去重与合并窗口由宿主负责）、不落盘、不改任何窗口选项；
 *    `closed` 时移除原生监听并清空订阅者（零泄漏）。
 * 本模块不组装应用、不注册 IPC、不读 profile/userData，也不携带任何身份材料（owner capability/token）。
 */

export type DetachedWindowFactoryCallbacks = {
  /** 原生 X（close）：app 侧据此走回停靠（lastValidDock → 安全链）。**必填**：缺失在类型层即不可构造
   *  （P1-06e），运行期守卫只作纵深防御，绝不产生「点了 X 就逻辑关闭 / 无法回停靠」的窗口。 */
  onNativeClose: (input: { windowInstanceId: string; hostEpoch: number }) => void
  /** 窗口已销毁（closed）：app 侧据此回收 registry 登记与飞事务。 */
  onWindowDestroyed?: (input: { windowInstanceId: string; hostEpoch: number }) => void
}

export type DetachedWindowFactoryOptions = DetachedWindowFactoryCallbacks & {
  /** 本应用静态资源根（file: URL）；file: entry 必须落在其中。 */
  appRoot: string
  /** 注入的受控 entry；构造期即 fail closed，绝不在运行期才失败。 */
  entryUrl: string
  devOrigins?: readonly string[]
  /** 外链出口：只对 http(s) 生效，且结论恒为 deny（缺省＝只 deny，绝不新开窗口）。 */
  openExternal?: (url: string) => void
  /** 测试接缝：替换 BrowserWindow 构造器（生产缺省用 electron 的 BrowserWindow）。 */
  createBrowserWindow?: (options: BrowserWindowOptions) => BrowserWindow
  /**
   * 崩溃**兜底轮询**周期（毫秒，`0` 关闭）。只在**有人监测**（有崩溃订阅者）时启动：
   * `render-process-gone` 是主信号，但若平台缺失该事件，已提交且完全空闲的僵尸窗没有任何决策点可被探测
   * （P1-07R A-P05b 正是这个形态），因此按固定周期兜底问一次 `webContents.isCrashed()`。
   * 缺省 1000ms：有界收敛，绝不因这条诊断轮询拖住进程（定时器一律 `unref()`）。
   */
  crashProbeIntervalMs?: number
  /**
   * P1-06m：**app 级退出期标记**（`before-quit` 置位，有界 dispose 完成后再 `app.quit()` 放行）。
   *
   * 为真时窗口 `close` **绝不** preventDefault：退出期取消关窗会让 Electron 的退出关窗相位作废，
   * 所有窗口销毁后主进程残留（P1-07R runG/runI 的真机形态；同一快照下无独立窗的 runH 正常退出是受控对照）。
   * 退出期的派生窗销毁由宿主 `appExit` 统一执行，故这里也不触达 `onNativeClose`（退出期不产生回停靠事务）。
   * 缺省 `() => false`：非退出期语义逐字不变（仍无条件 preventDefault + 回停靠）。
   */
  isAppQuitting?: () => boolean
  /**
   * PLAT-39 ①：原生底色的深浅来源（缺省读 `nativeTheme.shouldUseDarkColors`）。
   * 注入端口让「底色随主题派生」在测试里**确定可断言**，也避免把 OS 读取散落在多处。
   */
  systemPrefersDark?: () => boolean
}

/** BrowserWindow 构造参数类型：避免依赖全局 Electron 命名空间。 */
type BrowserWindowOptions = ConstructorParameters<typeof BrowserWindow>[0]

/** 窗口可见性/外观：与主窗同源的克制默认值，不暴露给 renderer。 */
const DETACHED_WINDOW_APPEARANCE = Object.freeze({
  show: false,
  autoHideMenuBar: true,
  /**
   * PLAT-39 ①：**装饰做法与主窗一致**（`window/createMainWindow.ts`）——两边都只消费
   * `resolveWindowChromeOptions()`，不各写一套平台布尔值。
   *
   * 此前分离窗用的是 Electron 默认装饰（原生标题栏）：真机实测主窗 `bounds.height - contentBounds.height = 0`，
   * 分离窗 `= 28`（DIP）——浅色 OS 外观 + 深色应用主题时，那 28pt 就是由 OS 绘制的**白色标题条**
   * （`capturePage()` 不含原生框，所以截图里看不见它）。改成内嵌装饰后两窗做法逐字一致：
   * macOS `hiddenInset`（红绿灯内嵌）、Windows 无原生标题条（自绘顶栏承载页面名，
   * 最小化/最大化/关闭由 `WindowControls` 画在顶栏最右），
   * 窗口切换器/Dock/任务栏仍按渲染侧设置的 `document.title`（= 本地化页面名）显示。
   */
  ...resolveWindowChromeOptions()
} as const)

/**
 * PLAT-39 ① / **PLAT-42**：窗口**原生底色**按当前外观派生，不是硬编码常量，也**不在这里持有字面量**。
 * 它只在正文首次绘制之前可见（`hiddenInset` 之后没有原生标题条），因此取与 app 深浅一致的极简底色：
 * 深色 ⇒ `#0b0d10`（= `:root --bg` 的深色默认）、浅色 ⇒ `#ffffff`（= `:root[data-theme='light'] --bg`）。
 * 只读 `nativeTheme.shouldUseDarkColors`（与 `readWorkspaceContextTheme` 的 system 分支同源），不读 profile。
 *
 * 取值与主窗（`window/createMainWindow.ts`）**同源**：`@platform/ui/theme/windowTheme` 的
 * `resolveWindowBackgroundColor()` ⇒ 两条建窗路径不可能再各说一套（PLAT-42 的缺陷就是主窗曾写死 `#101114`）。
 */
function detachedWindowBackgroundColor(systemPrefersDark: () => boolean): string {
  try {
    return resolveWindowBackgroundColor(systemPrefersDark())
  } catch {
    // 平台缺失/被替身遮蔽（测试缝）⇒ 与 `:root` 的深色默认 token 一致，绝不抛
    return WINDOW_BACKGROUND_COLOR.dark
  }
}

/** 缺省深色来源：`nativeTheme.shouldUseDarkColors`（与 `readWorkspaceContextTheme` 的 system 分支同源）。 */
function defaultSystemPrefersDark(): boolean {
  return nativeTheme.shouldUseDarkColors
}

/** N7/P1-06l 崩溃兜底轮询周期：1s 内收敛（`unref()`，绝不拖住进程退出）。 */
const DEFAULT_CRASH_PROBE_INTERVAL_MS = 1_000

export function createDetachedWindowFactory(options: DetachedWindowFactoryOptions): DetachedWindowFactory {
  const entryPolicy: AppWindowEntryPolicy = {
    appRoot: options.appRoot,
    ...(options.devOrigins === undefined ? {} : { devOrigins: options.devOrigins })
  }
  if (!isAllowedAppWindowEntryUrl(options.entryUrl, entryPolicy)) {
    throw new Error(`detached-window-entry-rejected: ${options.entryUrl}`)
  }
  // N4/P1-06e：独立窗必须有原生关闭消费者（回停靠的唯一入口）。类型层已要求 `onNativeClose` 必填，
  // 这里再守一次运行期（JS 调用方/断言绕过类型）：缺失即构造期 fail closed，
  // 绝不产生「点了 X 就直接逻辑关闭、布局不回停靠」的窗口。
  if (typeof options.onNativeClose !== 'function') throw new Error('detached-window-native-close-required')
  const construct = options.createBrowserWindow ?? ((input: BrowserWindowOptions) => new BrowserWindow(input))
  const crashProbeIntervalMs = Math.max(0, options.crashProbeIntervalMs ?? DEFAULT_CRASH_PROBE_INTERVAL_MS)
  // P1-06m：退出期标记缺省 false —— 非退出期的 close 语义（无条件回停靠）逐字不变
  const isAppQuitting = options.isAppQuitting ?? ((): boolean => false)
  const systemPrefersDark = options.systemPrefersDark ?? defaultSystemPrefersDark

  return (input) => {
    // 注入的 security 必须自身满足安全基线；随后用共享基线与它的 preload 重建，避免夹带私有开关
    assertSecureWindowSecurity(input.security)
    let window: BrowserWindow | null = null
    try {
      window = construct({
        x: Math.round(input.bounds.x),
        y: Math.round(input.bounds.y),
        width: Math.round(input.bounds.width),
        height: Math.round(input.bounds.height),
        title: input.title,
        ...DETACHED_WINDOW_APPEARANCE,
        backgroundColor: detachedWindowBackgroundColor(systemPrefersDark),
        webPreferences: Object.freeze({
          ...SECURE_WINDOW_PREFERENCE_BASELINE,
          preload: input.security.webPreferences.preload
        })
      })
      const created = window
      const webContents = created.webContents
      /**
       * **PLAT-41**：建窗当刻注入**已解析标题**，并在 Main 侧收口 `page-title-updated`（防篡改）。
       *
       * 真机缺陷：入口 HTML 的 `<title>`（应用名）在首次加载时覆盖 `BrowserWindow({ title })`，渲染侧要等正文
       * 首帧后才写 `document.title` ⇒ ≤300ms 的空窗期里原生标题仍是应用名。这里：
       *  1) `new BrowserWindow` 之后**立刻** `setTitle(主标题)`（不依赖任何渲染帧）；
       *  2) `page-title-updated` 只放行**受控白名单**（注册标题的两种语言 + pageId/主标题），其余一律
       *     `preventDefault()` 并强制回主标题 —— 入口 HTML 的应用名与任意篡改都不可能成为窗口标题；
       *  3) `closed` 时移除监听（零残留监听器）。
       * 白名单缺省 = `[title]`：既有调用方（不传 allowedTitles）语义是「标题只认主标题」，绝不放宽。
       */
      const primaryTitle = typeof input.title === 'string' ? input.title : ''
      const allowedTitles = new Set<string>([
        ...(primaryTitle.length === 0 ? [] : [primaryTitle]),
        ...(input.allowedTitles ?? []).filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      ])
      const setNativeTitle = (value: string): void => {
        const setTitle = (created as unknown as { setTitle?: (next: string) => void }).setTitle
        if (typeof setTitle !== 'function') return
        try { setTitle.call(created, value) } catch { /* 标题设置失败只影响显示名，绝不阻断建窗 */ }
      }
      const enforcePrimaryTitle = (): void => { if (primaryTitle.length > 0) setNativeTitle(primaryTitle) }
      const onPageTitleUpdated = (event: unknown, nextTitle: unknown): void => {
        if (typeof nextTitle === 'string' && allowedTitles.has(nextTitle)) {
          // 白名单内（例如渲染侧语言跟随）：接受并显式落值，行为跨平台确定
          setNativeTitle(nextTitle)
          return
        }
        // 白名单外（入口 HTML 应用名 / 任意篡改）：阻止覆盖并强制回 Main 已解析标题
        const preventable = event as { preventDefault?: () => void } | undefined
        preventable?.preventDefault?.()
        enforcePrimaryTitle()
      }
      enforcePrimaryTitle()
      const titledWebContents = webContents as unknown as {
        on?: (event: string, listener: (event: unknown, title: unknown) => void) => void
        removeListener?: (event: string, listener: (event: unknown, title: unknown) => void) => void
      }
      if (typeof titledWebContents.on === 'function') titledWebContents.on('page-title-updated', onPageTitleUpdated)
      const releaseTitleListener = (): void => {
        if (typeof titledWebContents.removeListener !== 'function') return
        try { titledWebContents.removeListener('page-title-updated', onPageTitleUpdated) } catch { /* 释放失败绝不阻断销毁 */ }
      }
      /**
       * **PLAT-04**：bounds 变化广播（`resize`/`move` → 句柄 `onBoundsChanged`）。
       *
       * 边界（逐条与文档 7) 对齐）：只报原生事实；不合并、不去重以外地改写、不落盘、不读配置；
       * 广播值形状仍由消费方（宿主）自行 fail closed；`closed` 时移除监听并清空订阅者，绝不泄漏。
       */
      const boundsListeners = new Set<(bounds: WorkspaceBounds) => void>()
      /** 读取当前 bounds：平台缺失/抛错/已销毁一律「无法判定」⇒ 不广播，绝不猜。 */
      const readWindowBounds = (): WorkspaceBounds | undefined => {
        if (created.isDestroyed()) return undefined
        const getBounds = (created as unknown as { getBounds?: () => unknown }).getBounds
        if (typeof getBounds !== 'function') return undefined
        try {
          const value = getBounds.call(created)
          return typeof value === 'object' && value !== null ? value as WorkspaceBounds : undefined
        } catch { return undefined }
      }
      const notifyBounds = (): void => {
        const bounds = readWindowBounds()
        if (bounds === undefined) return
        for (const listener of [...boundsListeners]) {
          // 订阅者异常一律吞掉：尺寸广播绝不能因某个消费者抛错而丢失，也不得冒泡回 Electron 事件派发
          try { listener(bounds) } catch { /* 单个订阅者失败不影响窗口语义与其它订阅者 */ }
        }
      }
      created.on('resize', notifyBounds)
      created.on('move', notifyBounds)
      /**
       * 自绘标题栏：最大化/还原事实只发给本窗口的渲染器（`WindowControls` 据此换图形）。
       * 与主窗同一条广播（`wireWindowChromeState`），窗口 `closed` 后监听随窗口一起消失。
       */
      wireWindowChromeState(created)
      /** 移除本窗口的原生监听并丢弃订阅者（`closed` 唯一调用点；幂等）。 */
      const releaseBoundsListeners = (): void => {
        boundsListeners.clear()
        const removeListener = (created as unknown as { removeListener?: (event: string, listener: () => void) => void }).removeListener
        if (typeof removeListener !== 'function') return
        try {
          removeListener.call(created, 'resize', notifyBounds)
          removeListener.call(created, 'move', notifyBounds)
        } catch { /* 移除失败只影响该次释放，绝不冒泡回 Electron 事件派发 */ }
      }
      /**
       * N3：无条件 deny。http(s) 只走注入的 openExternal 出口，其余一律 deny；句柄上的
       * `setWindowOpenHandler` 只允许「重装同一份 deny」，因此注入的 security（no-op 或恶意允许）
       * 以及宿主在 createWindow 之后的重装都改不掉结论 —— 窗口永远不会保留 Electron 默认 window.open 行为。
       */
      const denyWindowOpen = (details: { url: string }): { action: 'deny' } => {
        const external = options.openExternal
        if (external !== undefined && (details.url.startsWith('https://') || details.url.startsWith('http://'))) {
          external(details.url)
        }
        return { action: 'deny' as const }
      }
      webContents.setWindowOpenHandler(denyWindowOpen)
      /**
       * N6/P1-06g + N7/P1-06l：渲染器崩溃态的**唯一真源**。双信号：`render-process-gone` 事件（实时、权威，
       * 同时作为崩溃广播的触发点）为主，`webContents.isCrashed()` 为兜底（覆盖事件端口缺失或崩溃发生在监听之前）。
       * 广播对**准备期与已提交期同权**：P1-06g 的只读 `isCrashed()` 只能在决策点被判词表，已提交窗的僵尸态
       * （窗口存活、渲染器已死）没有任何决策点，必须靠这条订阅主动送达宿主。崩溃态只广播一次。
       */
      let rendererGone = false
      const crashListeners = new Set<() => void>()
      const notifyRendererGone = (): void => {
        if (rendererGone) return
        rendererGone = true
        // 订阅者异常一律吞掉：崩溃处置绝不能因某个消费者抛错而丢失，也不得冒泡回 Electron 事件派发
        for (const listener of [...crashListeners]) {
          try { listener() } catch { /* 单个订阅者失败不影响窗口语义与其它订阅者 */ }
        }
      }
      const webContentsApi = webContents as unknown as { on?: (event: string, listener: () => void) => void }
      if (typeof webContentsApi.on === 'function') webContentsApi.on('render-process-gone', notifyRendererGone)
      /** 兜底信号：事件端口缺失或崩溃发生在监听之前时，仍能由 `isCrashed()` 证明。 */
      const probeCrashed = (): boolean => {
        const probe = (created.webContents as unknown as { isCrashed?: () => boolean }).isCrashed
        try { return typeof probe === 'function' && probe.call(created.webContents) === true } catch { return false }
      }
      /** 已销毁窗口一律 false（窗口已不存在，绝不让已销毁窗口被报成崩溃）。 */
      const isCrashed = (): boolean => !created.isDestroyed() && (rendererGone || probeCrashed())

      /**
       * N7/P1-06l 兜底轮询：只在有订阅者时启动，最后一个订阅者退订或窗口 `closed` 即停。没有订阅者时
       * 一次定时器都不建（零开销）；`unref()` 保证这条诊断轮询绝不拖住进程退出（无残留定时器）。
       */
      let crashProbe: ReturnType<typeof setInterval> | null = null
      const stopCrashProbe = (): void => { if (crashProbe !== null) { clearInterval(crashProbe); crashProbe = null } }
      const ensureCrashProbe = (): void => {
        if (crashProbe !== null || crashProbeIntervalMs <= 0) return
        try {
          const timer = setInterval(() => { if (probeCrashed()) notifyRendererGone() }, crashProbeIntervalMs)
          ;(timer as unknown as { unref?: () => void }).unref?.()
          crashProbe = timer
        } catch { crashProbe = null }
      }
      const target: WindowOpenHandlerTarget = { setWindowOpenHandler: () => { webContents.setWindowOpenHandler(denyWindowOpen) } }
      // 仍然消费注入 security 的 applyWindowOpenHandler（契约要求它存在），但它的 handler 只被忽略式接收
      input.security.applyWindowOpenHandler(target)
      const handle: DetachedWindowHandle = {
        webContentsId: webContents.id,
        isCrashed,
        /**
         * **PLAT-04**：bounds 变化订阅（返回退订函数）。
         *
         * 订阅即**异步补发一次当前值**（调用方在 `createWindow` 返回后才订阅，初始尺寸因此不会漏），
         * 但绝不在订阅调用栈里同步回调（订阅方可能尚未完成登记）；退订后绝不再收到（零残留监听器）。
         * 平台无法读取 bounds 时静默降级为「只报后续变化」：绝不猜、绝不伪造。
         */
        onBoundsChanged: (listener) => {
          boundsListeners.add(listener)
          const initial = readWindowBounds()
          if (initial !== undefined) {
            void Promise.resolve().then(() => {
              if (!boundsListeners.has(listener)) return
              try { listener(initial) } catch { /* 订阅者异常不得冒泡 */ }
            })
          }
          return () => { boundsListeners.delete(listener) }
        },
        /**
         * N7/P1-06l：崩溃订阅（返回退订函数）。崩溃**已经发生**（事件已广播，或仅由 `isCrashed()` 兜底证明）
         * 时**异步补发一次**，绝不在订阅调用栈里同步回调（订阅方可能尚未完成登记）；这是宿主主动感知
         * 已提交窗僵尸态的唯一入口，缺失即无法主动感知。退订后绝不再收到（无残留监听器）。
         */
        onRendererGone: (listener) => {
          const released = (): void => { crashListeners.delete(listener) }
          if (rendererGone || (!created.isDestroyed() && probeCrashed())) {
            void Promise.resolve().then(() => {
              if (rendererGone) { try { listener() } catch { /* 订阅者异常不得冒泡 */ } return }
              // isCrashed() 兜底证明的崩溃：补成正式广播，其它订阅者也不漏
              crashListeners.add(listener)
              notifyRendererGone()
            })
            return released
          }
          crashListeners.add(listener)
          ensureCrashProbe()
          return () => { released(); if (crashListeners.size === 0) stopCrashProbe() }
        },
        setWindowOpenHandler: () => { webContents.setWindowOpenHandler(denyWindowOpen) },
        loadURL: async (url) => {
          // 宿主只应加载注入 entry；这里逐次校验，杜绝任何运行期被拼接/替换的 URL
          if (!isAllowedAppWindowEntryUrl(url, entryPolicy)) throw new Error(`detached-window-entry-rejected: ${url}`)
          await created.loadURL(url)
          if (!created.isDestroyed()) created.show()
        },
        isDestroyed: () => created.isDestroyed(),
        destroy: () => { if (!created.isDestroyed()) created.destroy() },
        focus: () => { if (!created.isDestroyed()) created.focus() }
      }
      // 原生 X 只回停靠：无条件 preventDefault 后交由 app 侧销毁 + 布局交还主窗（构造期已保证消费者存在）
      created.on('close', (event: { preventDefault: () => void }) => {
        // P1-06m 退出期：绝不 preventDefault（否则 app.quit() 的关窗相位被取消、主进程残留），
        // 也不触发回停靠（退出期布局已冻结，派生窗由宿主 appExit 统一销毁）。
        if (isAppQuitting()) return
        event.preventDefault()
        // 消费者抛错不得让窗口按逻辑关闭（也就不会绕过回停靠），更不得冒泡回 Electron 的事件派发
        try { options.onNativeClose({ windowInstanceId: input.windowInstanceId, hostEpoch: input.hostEpoch }) } catch { /* 回停靠失败只影响该次点击，登记与布局仍由 app 侧其它入口收敛 */ }
      })
      created.on('closed', () => {
        // 窗口已销毁：崩溃广播不再有任何消费者（`isCrashed()` 也一律 false），先停轮询、释放订阅再回收登记
        stopCrashProbe()
        crashListeners.clear()
        // PLAT-04：bounds 原生监听与订阅者必须一起释放（重复 create/destroy 绝不累积监听器）
        releaseBoundsListeners()
        // PLAT-41：标题收口监听随窗口销毁释放（零残留监听器）
        releaseTitleListener()
        options.onWindowDestroyed?.({ windowInstanceId: input.windowInstanceId, hostEpoch: input.hostEpoch })
      })
      return handle
    } catch (error) {
      // 工厂契约：句柄没交出去之前出错，必须自己销毁窗口，绝不把孤儿留给宿主
      if (window !== null && !window.isDestroyed()) window.destroy()
      throw error
    }
  }
}
