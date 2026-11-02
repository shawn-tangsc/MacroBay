// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import { WorkspaceWindowChromePolicy } from '@platform/workspace/policies'
import { platformText } from '../../i18n/platformText'
import { WorkspaceWindowRoot, type WorkspaceWindowRootProps } from './WorkspaceWindowRoot'
import { resolveWindowPageChrome } from './workspaceWindowTopBar'

/**
 * Owner: apps/desktop-shell renderer / workspace（**PLAT-39 ①**：分离窗自绘顶栏 + 原生标题）。
 *
 * 真机 RED（修复前，`/tmp/plat39-evidence` 的 plat39-pre* 一轮）：
 *  · 分离页窗 `getTitle()` = 应用名，期望 = 主窗 Tab 标签（本地化页面名）；
 *  · 页面窗 DOM 里**没有** `.workspace-window-topbar`（无自绘顶栏 ⇒ 页面名无处可见）；
 *  · `bounds.height - contentBounds.height` 主窗 0 / 分离窗 28（原生标题栏 = 用户看到的「白条」）。
 * 本文件在单测层锁定修复后的结构：顶栏存在、承载本地化名字、拖拽区与 no-drag 动作、原生标题被设置。
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const WINDOW_ID = 'window-plat39-title'
const HOST_EPOCH = 5
const TAB_KEY = 'ws-plat39-title'
const FLUSH_TURNS = 12

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
  document.title = ''
  Reflect.deleteProperty(window, 'platform')
})

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < FLUSH_TURNS; turn += 1) await Promise.resolve()
  })
}

type FakePageOptions = {
  pageId: string
  menuKey: string
  role: 'panel' | 'main'
  withMounts?: boolean
}

/** 页窗 fake preload：受控上下文 + `.tabs.*` 快照（与真机同形；不新增任何测试出口）。 */
function installPageWindow(options: FakePageOptions): void {
  const tab = () => ({
    workspaceInstanceKey: TAB_KEY, pageId: options.pageId, menuKey: options.menuKey,
    open: true, order: 0, mode: 'detached', bindingState: 'bound',
    windowInstanceId: WINDOW_ID, hostEpoch: HOST_EPOCH
  })
  Reflect.set(window, 'platform', {
    settings: { get: async () => ({ themeMode: 'dark', accentColor: 'lime' }) },
    workspace: {
      getHostContext: async () => ({
        status: 'ok',
        context: {
          windowInstanceId: WINDOW_ID, hostEpoch: HOST_EPOCH, role: options.role,
          mounts: options.withMounts === true
            ? [{ workspaceInstanceKey: TAB_KEY, panelInstanceKey: 'panel-1', panelId: 'sample.panel-1', open: true, mode: 'detached', bindingState: 'unavailable' }]
            : [],
          layoutRevision: 2, pageIds: [], pendingTransfer: null,
          preferences: { language: 'zh-CN', theme: 'dark', timeZone: 'Asia/Shanghai' }
        }
      }),
      getSnapshot: async () => ({
        status: 'ok',
        snapshot: {
          layoutRevision: 2, activeWorkspaceInstanceKey: options.withMounts === true ? TAB_KEY : null,
          panels: options.withMounts === true
            ? [{ workspaceInstanceKey: TAB_KEY, panelInstanceKey: 'panel-1', panelId: 'sample.panel-1', open: true, mode: 'detached', presentation: 'normal', bindingState: 'unavailable', lastValidDock: 'embedded', windowInstanceId: WINDOW_ID, hostEpoch: HOST_EPOCH }]
            : [],
          pageLayouts: options.withMounts === true
            ? [{ workspaceInstanceKey: TAB_KEY, panelOrder: ['panel-1'], activePanels: {} }]
            : [],
          tabs: [tab()], persistenceState: 'saved'
        }
      }),
      command: async () => ({ status: 'rejected', errorCode: 'invalid-request' }),
      onEvent: () => () => undefined,
      tabsGetSnapshot: async () => ({
        status: 'ok', pendingDetach: null,
        snapshot: { layoutRevision: 2, activeWorkspaceInstanceKey: TAB_KEY, recentlyClosedCount: 0, tabs: [tab()] }
      }),
      tabsCommand: async () => ({ status: 'rejected', errorCode: 'invalid-request' })
    }
  })
}

async function renderWindow(): Promise<HTMLDivElement> {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const current = root
  await act(async () => { current.render(createElement(WorkspaceWindowRoot, {} as WorkspaceWindowRootProps)) })
  await settle()
  return container
}

describe('PLAT-39 ①：分离窗自绘顶栏承载本地化页面名，并设置原生标题', () => {
  // 用内置页做 fixture：平台测试不依赖任何具体产品，增删产品都不会让本文件变红。
  const BUILT_IN_PAGE_ID = 'assistants'
  const BUILT_IN_MENU_KEY = 'assistants'
  const zhTitle = platformText['zh-CN'].nav.assistants
  const enTitle = platformText['en-US'].nav.assistants

  it('页面名与主窗 Tab 标签同源：zh-CN 与 en-US 都取同一注册表', () => {
    const zh = resolveWindowPageChrome({ pageId: BUILT_IN_PAGE_ID, menuKey: BUILT_IN_MENU_KEY, language: 'zh-CN' })
    const en = resolveWindowPageChrome({ pageId: BUILT_IN_PAGE_ID, menuKey: BUILT_IN_MENU_KEY, language: 'en-US' })
    expect(zh.title).toBe(zhTitle)
    expect(en.title).toBe(enTitle)
    // 注册表缺项 ⇒ 退回 pageId（绝不空白）
    const missing = resolveWindowPageChrome({ pageId: 'nobody.knows', menuKey: '/nobody/knows', language: 'zh-CN' as AppLanguage })
    expect(missing.title).toBe('nobody.knows')
  })

  it('页窗：DOM 里有顶栏（携带页面名 + 回停靠动作），且 document.title = 页面名（原生标题的修法）', async () => {
    installPageWindow({ pageId: BUILT_IN_PAGE_ID, menuKey: BUILT_IN_MENU_KEY, role: 'panel' })
    const view = await renderWindow()
    const bar = view.querySelector<HTMLElement>('[data-window-topbar="true"]')
    expect(bar).not.toBeNull()
    expect(bar?.querySelector('.workspace-window-topbar-title')?.textContent).toBe(zhTitle)
    // 回停靠入口在顶栏内（P2-15 的按钮身份不变）
    expect(bar?.querySelector(`[data-redock-tab="${TAB_KEY}"]`)).not.toBeNull()
    // 原生标题：Electron 用 document.title 作为窗口标题 ⇒ 必须等于页面名（不再是应用名）
    expect(document.title).toBe(zhTitle)
  })

  it('面板窗：同一份顶栏 + document.title = 面板名', async () => {
    installPageWindow({ pageId: 'sample.panel-1', menuKey: '/sample/panel-1', role: 'panel', withMounts: true })
    const view = await renderWindow()
    const bar = view.querySelector<HTMLElement>('[data-window-topbar="true"]')
    expect(bar).not.toBeNull()
    expect(bar?.querySelector('.workspace-window-topbar-title')?.textContent).toBe('sample.panel-1')
    expect(document.title).toBe('sample.panel-1')
  })

  it('顶栏高度只走命名策略（`--topbar-height`，与主窗同）；主窗角色不改标题', async () => {
    expect(WorkspaceWindowChromePolicy.topBarHeightVar).toBe('--topbar-height')
    expect(WorkspaceWindowChromePolicy.topBarHeight).toBeGreaterThan(0)
    document.title = 'UNTOUCHED'
    installPageWindow({ pageId: BUILT_IN_PAGE_ID, menuKey: BUILT_IN_MENU_KEY, role: 'main' })
    await renderWindow()
    expect(document.title).toBe('UNTOUCHED')
  })
})
