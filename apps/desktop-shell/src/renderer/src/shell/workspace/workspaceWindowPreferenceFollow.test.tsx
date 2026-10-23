// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { platformText } from '../../i18n/platformText'
import { WorkspaceWindowRoot, type WorkspaceWindowRootProps } from './WorkspaceWindowRoot'

/**
 * Owner: apps/desktop-shell renderer / workspace（**PLAT-10** focused）。回归：本文件。
 *
 * `context.preferences.{language,theme}`，主窗之后切换语言/主题时已打开的页窗**不跟随**（P2-04 集成项）。
 *
 * 本文件取证渲染侧那一半（不启动 Electron）：
 *  ① 页窗收到**既有**受控事件（`workspaceEvent` 的既有词汇 `snapshot`，与 P2-09/B3 同一订阅）后，
 *     单飞地**重取一次**受控 `getHostContext()`，可见文案随之切换（i18n 文案判据，不重开窗口）；
 *  ② 页窗根的主题属性（`data-theme`，与面板窗同一条 `applyRootThemeAttributes` 路径）随之更新；
 *  ③ **有界**：一次切换 ⇒ 恰好一次上下文重取 + 一次既有 Tab 快照重取；此后重取不再放大；
 *  ④ 未归属（身份不匹配）与错误路径（被拒/传输失败）**显式**：维持最后一次受控值、绝不改判归属、
 *     绝不把页面窗降级成错误壳；错误壳窗口不在 workspace 归属图里 ⇒ 零受控事件订阅（**PLAT-29** 起
 *     它的语言改走既有 `platform.settings.get()` 同源只读面，取证见 `workspaceErrorShellLanguage.test.tsx`）。
 *
 * 生产触发链（Main 侧偏好对账 + 主窗的偏好广播接线）由
 * `platform/desktop/main/workspace/workspaceWindowPreferenceFollow.test.ts`（真 compose）与文件尾的
 * 源码护栏共同取证；真机跨进程可见文案跟随未在本包运行（见回交的「是否需要真机」）。
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const HOST_WINDOW_ID = 'window-page-1'
const HOST_EPOCH = 1
const TAB_KEY = 'ws-page-1'
/** 未命中任何内置页/产品页的 pageId ⇒ 页窗渲染成对 i18n 安全壳（可见文案判据）。 */
const UNKNOWN_PAGE_ID = 'plat-10.unknown-page'
const FLUSH_TURNS = 12
const workspaceLabels = platformText['en-US'].workspace
const zhWorkspaceLabels = platformText['zh-CN'].workspace

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(async () => {
  if (root) {
    const current = root
    root = undefined
    await act(async () => { current.unmount() })
  }
  container = undefined
  document.body.replaceChildren()
  Reflect.deleteProperty(window, 'platform')
  for (const name of ['data-theme', 'data-theme-mode', 'data-accent']) {
    document.documentElement.removeAttribute(name)
  }
})

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < FLUSH_TURNS; turn += 1) await Promise.resolve()
  })
}

type Preferences = { language: string; theme: string }

type FakePageWindow = {
  state: {
    contextCalls: number
    tabSnapshotCalls: number
    listeners: number
    /** 受控读取返回的形状开关：`mismatch` = 身份不匹配；`rejected` = 上下文不可用。 */
    mode: 'ok' | 'mismatch' | 'rejected'
  }
  setPreferences: (next: Partial<Preferences>) => void
  emit: (event: unknown) => void
}

/**
 * 页面窗的 fake preload：与真机同形（同一个 `platform.workspace` 命名空间同时提供面板受控面与 `.tabs.*`）。
 * 计数 getter 是本文件的**有界性观测面**（不给生产代码加测试出口）。
 */
function installPageWindow(initial: Preferences = { language: 'en-US', theme: 'dark' }): FakePageWindow {
  const preferences: Preferences = { ...initial }
  const state: FakePageWindow['state'] = { contextCalls: 0, tabSnapshotCalls: 0, listeners: 0, mode: 'ok' }
  const listeners = new Set<(event: unknown) => void>()

  const tab = () => ({
    workspaceInstanceKey: TAB_KEY, pageId: UNKNOWN_PAGE_ID, menuKey: UNKNOWN_PAGE_ID,
    open: true, order: 0, mode: 'detached', bindingState: 'bound',
    windowInstanceId: HOST_WINDOW_ID, hostEpoch: HOST_EPOCH
  })

  Reflect.set(window, 'platform', {
    workspace: {
      getHostContext: async () => {
        state.contextCalls += 1
        if (state.mode === 'rejected') return { status: 'rejected', errorCode: 'not-owner' }
        return {
          status: 'ok',
          context: {
            // 身份唯一来源是受控上下文；`mismatch` 用来取证「未归属 ⇒ 显式不跟随」
            windowInstanceId: state.mode === 'mismatch' ? 'window-someone-else' : HOST_WINDOW_ID,
            hostEpoch: HOST_EPOCH,
            role: 'panel',
            mounts: [],
            layoutRevision: 2,
            pageIds: [],
            preferences: { ...preferences },
            pendingTransfer: null
          }
        }
      },
      getSnapshot: async () => ({
        status: 'ok',
        snapshot: {
          layoutRevision: 2, activeWorkspaceInstanceKey: null,
          panels: [], pageLayouts: [], tabs: [], persistenceState: 'saved'
        }
      }),
      command: async () => ({ status: 'rejected', errorCode: 'invalid-request' }),
      onEvent: (listener: (event: unknown) => void) => {
        state.listeners += 1
        listeners.add(listener)
        return () => { state.listeners -= 1; listeners.delete(listener) }
      },
      tabsGetSnapshot: async () => {
        state.tabSnapshotCalls += 1
        return {
          status: 'ok',
          pendingDetach: null,
          snapshot: {
            layoutRevision: 2, activeWorkspaceInstanceKey: TAB_KEY, recentlyClosedCount: 0, tabs: [tab()]
          }
        }
      },
      tabsCommand: async () => ({ status: 'rejected', errorCode: 'invalid-request' })
    }
  })

  return {
    state,
    setPreferences: (next) => { Object.assign(preferences, next) },
    emit: (event) => { for (const listener of [...listeners]) listener(event) }
  }
}

/** Main 的偏好通知：**既有**事件词汇 + 既有 `workspaceEvent` 订阅（绝不新增通道/词汇）。 */
function preferenceNotice(revision = 3): unknown {
  return { type: 'snapshot', layoutRevision: revision, scope: { workspaceInstanceKey: TAB_KEY } }
}

async function renderPageWindow(): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const current = root
  await act(async () => { current.render(createElement(WorkspaceWindowRoot, {} as WorkspaceWindowRootProps)) })
  await settle()
  return container
}

const visiblePageText = (view: HTMLDivElement): string | null =>
  view.querySelector('.workspace-page-placeholder')?.textContent ?? null
const redockLabel = (view: HTMLDivElement): string | null =>
  view.querySelector<HTMLElement>(`[data-redock-tab="${TAB_KEY}"]`)?.getAttribute('aria-label') ?? null

describe('PLAT-10 ①：主窗切换语言 ⇒ 已打开页窗可见文案跟随（复用既有受控事件 + 一次受控重取）', () => {
  it('收到既有 snapshot 事件后重取一次 getHostContext，可见文案从 EN 切到 ZH', async () => {
    const fake = installPageWindow()
    const view = await renderPageWindow()
    expect(view.querySelector('[data-window-shell="page"]')).not.toBeNull()
    expect(visiblePageText(view)).toBe(workspaceLabels.tabPageMissing)
    expect(redockLabel(view)).toBe(workspaceLabels.pageWindowRedock)

    // 主窗切换语言：Main 只发既有受控事件；页窗自己重取受控上下文
    fake.setPreferences({ language: 'zh-CN' })
    await act(async () => { fake.emit(preferenceNotice()) })
    await settle()

    expect(visiblePageText(view)).toBe(zhWorkspaceLabels.tabPageMissing)
    expect(redockLabel(view)).toBe(zhWorkspaceLabels.pageWindowRedock)
    // 绝不要求用户重开窗口：同一个页窗根、同一个 Tab 身份，DOM 不重建
    expect(view.querySelector('[data-window-shell="page"]')).not.toBeNull()
    expect(view.querySelector(`[data-redock-tab="${TAB_KEY}"]`)).not.toBeNull()
  })
})

describe('PLAT-10 ②：主窗切换主题 ⇒ 页窗根主题属性跟随（applyRootThemeAttributes 路径）', () => {
  it('页窗根按受控 context.preferences.theme 写 data-theme，并在切换后更新', async () => {
    const fake = installPageWindow({ language: 'en-US', theme: 'dark' })
    await renderPageWindow()
    // 页窗此前**从不**写根主题（只有面板窗写）：浅色主题下页窗永远是暗色默认 —— 本包必须补齐
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    fake.setPreferences({ theme: 'light' })
    await act(async () => { fake.emit(preferenceNotice()) })
    await settle()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('主题与语言在同一次重取里更新（同一份受控上下文，绝不分叉）', async () => {
    const fake = installPageWindow({ language: 'en-US', theme: 'light' })
    const view = await renderPageWindow()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')

    fake.setPreferences({ language: 'zh-CN', theme: 'dark' })
    await act(async () => { fake.emit(preferenceNotice()) })
    await settle()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(visiblePageText(view)).toBe(zhWorkspaceLabels.tabPageMissing)
  })
})

describe('PLAT-10 ③：一次切换的更新次数有上界（单飞 + 有界，绝不自持环）', () => {
  it('一次事件 ⇒ 恰好一次上下文重取（外加既有的一次 Tab 快照重取），此后不再放大', async () => {
    const fake = installPageWindow()
    await renderPageWindow()
    const contextAfterMount = fake.state.contextCalls
    const tabsAfterMount = fake.state.tabSnapshotCalls
    expect(contextAfterMount).toBe(1)
    expect(tabsAfterMount).toBe(1)

    fake.setPreferences({ language: 'zh-CN' })
    await act(async () => { fake.emit(preferenceNotice()) })
    await settle()
    expect(fake.state.contextCalls).toBe(contextAfterMount + 1)
    // 既有语义不变：事件到达即重取一次受控 Tab 快照（P2-09/B3 的有界姿态）
    expect(fake.state.tabSnapshotCalls).toBe(tabsAfterMount + 1)

    // 再等若干微任务轮：绝无自持环、绝无忙轮询
    await settle()
    expect(fake.state.contextCalls).toBe(contextAfterMount + 1)
    expect(fake.state.tabSnapshotCalls).toBe(tabsAfterMount + 1)
  })

  it('连续三个事件 ⇒ 上下文重取不超过三次（单飞合并，绝不风暴）', async () => {
    const fake = installPageWindow()
    await renderPageWindow()
    const before = fake.state.contextCalls
    fake.setPreferences({ language: 'zh-CN' })
    await act(async () => {
      fake.emit(preferenceNotice(3))
      fake.emit(preferenceNotice(4))
      fake.emit(preferenceNotice(5))
    })
    await settle()
    const delta = fake.state.contextCalls - before
    expect(delta).toBeGreaterThanOrEqual(1)
    expect(delta).toBeLessThanOrEqual(3)
  })
})

describe('PLAT-10 ④：未归属与错误路径显式（维持最后一次受控值，绝不放宽归属）', () => {
  it('重取的上下文身份与本窗不符 ⇒ 显式不跟随（维持原语言主题）', async () => {
    const fake = installPageWindow({ language: 'en-US', theme: 'dark' })
    const view = await renderPageWindow()
    fake.setPreferences({ language: 'zh-CN', theme: 'light' })
    fake.state.mode = 'mismatch'
    await act(async () => { fake.emit(preferenceNotice()) })
    await settle()

    // 未归属的上下文绝不改判本窗：语言/主题维持最后一次受控值
    expect(visiblePageText(view)).toBe(workspaceLabels.tabPageMissing)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(fake.state.contextCalls).toBeGreaterThan(1)
  })

  it('重取被拒（上下文不可用）⇒ 维持最后一次受控值，绝不把页窗降级成错误壳', async () => {
    const fake = installPageWindow({ language: 'en-US', theme: 'dark' })
    const view = await renderPageWindow()
    fake.state.mode = 'rejected'
    await act(async () => { fake.emit(preferenceNotice()) })
    await settle()

    expect(view.querySelector('[data-window-shell="page"]')).not.toBeNull()
    expect(view.querySelector('[data-window-shell="error"]')).toBeNull()
    expect(visiblePageText(view)).toBe(workspaceLabels.tabPageMissing)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('没有任何 workspace 桥的窗口（无受控通道）不参与跟随：仍是既有 shell 兜底', async () => {
    Reflect.deleteProperty(window, 'platform')
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const current = root
    await act(async () => {
      current.render(createElement(WorkspaceWindowRoot, {} as WorkspaceWindowRootProps,
        createElement('p', null, 'shell-child')))
    })
    await settle()
    expect(container.textContent).toBe('shell-child')
    // 明确排除：没有受控通道的窗口既没有可跟随的来源，也不会被写入主题
    expect(document.documentElement.getAttribute('data-theme')).toBeNull()
  })

  it('错误壳窗口（受控上下文不可用）零受控事件订阅：不会被半新半旧地更新', async () => {
    const fake = installPageWindow()
    fake.state.mode = 'rejected'
    const view = await renderPageWindow()
    const shell = view.querySelector('[data-window-shell="error"]')
    expect(shell).not.toBeNull()
    expect(shell?.textContent).toContain(workspaceLabels.windowHostUnavailableTitle)

    // 错误壳窗口**没有**页面窗归属、也没有任何受控 workspace 事件订阅 ⇒ 它既收不到偏好通知，
    // 也不会被「半新半旧」地更新。**PLAT-29** 起它的语言跟随改走既有 `settings.get()` 同源只读面
    // （本 fake 未提供 settings 桥 ⇒ 维持 `fallbackLanguage`；跟随取证见 workspaceErrorShellLanguage.test.tsx），
    // 本用例只守「零受控事件订阅 + 不改写根主题」这两条归属纪律。
    expect(fake.state.listeners).toBe(0)
    fake.setPreferences({ language: 'zh-CN', theme: 'light' })
    await act(async () => { fake.emit(preferenceNotice()) })
    await settle()
    expect(view.querySelector('[data-window-shell="error"]')?.textContent)
      .toContain(workspaceLabels.windowHostUnavailableTitle)
    expect(document.documentElement.getAttribute('data-theme')).toBeNull()
  })
})

describe('PLAT-36 生产接线护栏：偏好对账只有 Main 侧那一个显式通知点', () => {
  /** 注释允许记录历史（例如「曾在这里调 getHostContext」）；判据只约束代码本身。 */
  const appShellSource = readFileSync(
    resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/AppShell.tsx'),
    'utf8'
  ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1')

  it('AppShell 不再残留「偏好写入后单飞 getHostContext」的 S1 前对账调用（也不新增通道/preload 方法）', () => {
    // PLAT-32/S1 之后，偏好对账的唯一触发点是 Main：`settingsUpdate` 成功路径的
    // `panelWorkspaceForDisposal?.notifyPreferencesChanged()`。受控读取**不带副作用**，
    // 因此渲染侧那次「单飞读取」只是一条无产出的额外 IPC ⇒ 必须不存在（行为证据见
    // `apps/desktop-shell/src/renderer/src/shell/workspacePreferenceWriteSideEffect.test.tsx`）。
    expect(appShellSource).not.toContain('broadcastWorkspacePreferenceChange')
    expect(appShellSource).not.toContain('getHostContext')
    expect(appShellSource).not.toContain('ipcRenderer')
    // 正向：偏好仍然通过既有 settings 面写入（本包绝不改设置保存路径）
    expect(appShellSource).toContain('window.platform.settings.update')
  })
})
