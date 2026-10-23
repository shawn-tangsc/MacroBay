// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { platformText } from '../../i18n/platformText'
import { WorkspaceWindowRoot, type WorkspaceWindowRootProps } from './WorkspaceWindowRoot'

/**
 * Owner: apps/desktop-shell renderer / workspace 独立**页面窗**的回停靠入口（P2-15）。
 * 权威：P2-09「原生关闭即回停靠」已交付，但页窗**没有可见的回停靠控件**（用户实测找不到）；
 * 本文件取证：回停靠控件是绝对定位（`position:absolute`，**不占布局高度**、不破坏 P2-14 的填充判据）的
 * 悬浮按钮，点击走已验证的 `.tabs.*` `redockTab`（`tabsCommand` 恰一次），且原生关闭路径不被本包改动。
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const language = 'en-US' as const
const labels = platformText[language].workspace
const HOST_WINDOW_ID = 'window-page-1'
const TAB_KEY = 'ws-page-1'
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
  Reflect.deleteProperty(window, 'platform')
})

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < FLUSH_TURNS; turn += 1) await Promise.resolve()
  })
}

/** 页面窗的受控上下文：`mounts` 为空 ⇒ 只有 `.tabs.*` 归属链能把它判成页面窗（P2-03 分支）。 */
function pageContext(): unknown {
  return {
    status: 'ok',
    context: {
      windowInstanceId: HOST_WINDOW_ID,
      hostEpoch: 1,
      role: 'panel',
      mounts: [],
      layoutRevision: 2,
      pageIds: [],
      preferences: { language, theme: 'dark' },
      pendingTransfer: null
    }
  }
}

/** 面板快照只需形状合法（`mounts` 为空 ⇒ 不进入面板宿主分支）。 */
function panelSnapshot(): unknown {
  return {
    status: 'ok',
    snapshot: {
      layoutRevision: 2, activeWorkspaceInstanceKey: null,
      panels: [], pageLayouts: [], tabs: [], persistenceState: 'saved'
    }
  }
}

function tabSnapshot(mode: 'main' | 'detached'): Record<string, unknown> {
  return {
    workspaceInstanceKey: TAB_KEY,
    pageId: 'agents',
    menuKey: 'agents',
    open: true,
    order: 0,
    mode,
    bindingState: 'bound',
    windowInstanceId: mode === 'detached' ? HOST_WINDOW_ID : 'main',
    hostEpoch: 1
  }
}

type FakeTabs = { commands: Record<string, unknown>[]; install: (mode?: 'main' | 'detached') => void }

/** fake preload：`.tabs.*` 受控桥（getSnapshot = 页窗受控挂载点；command = 回停靠出口）。 */
function fakeTabs(): FakeTabs {
  const commands: Record<string, unknown>[] = []
  const state = { mode: 'detached' as 'main' | 'detached' }
  const snapshot = () => ({
    status: 'ok',
    snapshot: {
      layoutRevision: state.mode === 'detached' ? 2 : 3,
      activeWorkspaceInstanceKey: TAB_KEY,
      recentlyClosedCount: 0,
      tabs: [tabSnapshot(state.mode)]
    }
  })
  const install = (mode: 'main' | 'detached' = 'detached') => {
    state.mode = mode
    Reflect.set(window, 'platform', {
      workspace: {
        getHostContext: async () => pageContext(),
        getSnapshot: async () => panelSnapshot(),
        command: async () => ({ status: 'rejected', errorCode: 'invalid-request' }),
        onEvent: () => () => undefined,
        tabsGetSnapshot: async () => snapshot(),
        tabsCommand: async (request: unknown) => {
          const record = request as Record<string, unknown>
          commands.push(record)
          if (record.method === 'redockTab') state.mode = 'main'
          return { ...snapshot(), status: 'applied', workspaceInstanceKey: TAB_KEY }
        }
      }
    })
  }
  return { commands, install }
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

describe('P2-15：独立页面窗的回停靠悬浮入口', () => {
  it('⑤ 页窗右上角存在绝对定位的回停靠按钮，点击 redockTab 恰一次', async () => {
    const tabs = fakeTabs()
    tabs.install('detached')
    const view = await renderPageWindow()
    const shell = view.querySelector<HTMLElement>('[data-window-shell="page"]')
    expect(shell).not.toBeNull()
    const button = view.querySelector<HTMLButtonElement>(`[data-redock-tab="${TAB_KEY}"]`)
    expect(button).not.toBeNull()
    // 「不占布局高度」是判据：绝对定位的悬浮控件（P2-14 的填充链因此不受影响）
    expect(button?.style.position).toBe('absolute')
    expect(button?.getAttribute('aria-label')).toBe(labels.pageWindowRedock)
    expect(button?.getAttribute('title')).toBe(labels.pageWindowRedock)
    // 控件挂在页面窗根内部（不是另起一层壳），正文宿主仍是页面窗根的直接子节点（P2-14 判据）
    expect(shell?.contains(button ?? null)).toBe(true)
    expect(view.querySelector('.workspace-window-page > .workspace-page-host')).not.toBeNull()

    await act(async () => { button?.click() })
    await settle()
    const redock = tabs.commands.filter((record) => record.method === 'redockTab')
    expect(redock).toHaveLength(1)
    expect(redock[0]?.workspaceInstanceKey).toBe(TAB_KEY)
    // 回停靠后（mode:'main'）不再显示该入口，绝不留下幽灵按钮
    expect(view.querySelector(`[data-redock-tab="${TAB_KEY}"]`)).toBeNull()
  })

  it('页面窗不点击就不发任何命令（P2-09 的原生关闭回停靠仍由 Main 负责）', async () => {
    const tabs = fakeTabs()
    tabs.install('detached')
    const view = await renderPageWindow()
    expect(view.querySelector('[data-window-shell="page"]')).not.toBeNull()
    expect(tabs.commands).toEqual([])
  })
})
