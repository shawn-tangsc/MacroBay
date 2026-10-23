// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { theme as antdTheme } from 'antd'
import { afterEach, describe, expect, it } from 'vitest'

import { WorkspaceWindowRoot, type WorkspaceWindowRootProps } from './WorkspaceWindowRoot'

/**
 * Owner: apps/desktop-shell renderer / workspace（**PLAT-39 ②**：分离窗与应用主窗**颜色风格一致**）。
 *
 * 用户实测（PM 追加判据）：「颜色风格都要一致」——分离窗（页窗 + 面板窗）不得出现浅色/白色不一致。
 * 三条判据，全部只用可复算的数字/字符串：
 *  ①根属性**逐字相同**：主窗写 `data-theme`/`data-theme-mode`/`data-accent`（`toThemeAttributes`），
 *    分离窗此前只写 `data-theme` ⇒ 缺项即不一致；
 *  ②antd 面**同一套 token**：主窗正文在 `ConfigProvider`（darkAlgorithm + 具名 token）里渲染；分离窗此前
 *    **没有** `ConfigProvider` ⇒ 产品页里的 antd 组件走 antd 默认**浅色**算法 ⇒ 深色应用里的白面；
 *  ③**首帧**即成立：属性必须在正文首次 layout 之前写好（不是首次绘制后由 `useEffect` 补写）。
 *
 * 本文件只断言「本窗根/本窗内容」的证据；主窗与分离窗的**逐项对照表**由真机 harness 的 parity 证据给出
 * （`PLAT-39-分离窗颜色风格` / `PLAT-39-分离窗 antd 面一致`）。
 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const WINDOW_ID = 'window-panel-plat39'
const HOST_EPOCH = 3
const WORKSPACE_KEY = 'workspace_plat39'
const PANEL_KEY = 'panel_plat39'
const PANEL_ID = 'sample.panel-plat39'
const FLUSH_TURNS = 12

/** 主窗 `getAntdTheme()` 在同一主题下产出的具名 token（断言分离窗内容拿到的是**同一套**）。 */
const DARK_TOKENS = { background: '#14171c', text: '#e7e9ee', border: '#252a33' } as const
const LIGHT_TOKENS = { background: '#ffffff', text: '#20221f', border: '#dedfd8' } as const

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

type AppAppearance = { themeMode: 'system' | 'dark' | 'light'; accentColor: 'lime' | 'cyan' | 'violet' }

type FakePanelWindow = {
  state: { settingsCalls: number; contextCalls: number }
  setAppearance: (next: Partial<AppAppearance>) => void
  setContextTheme: (next: string) => void
  emit: (event: unknown) => void
}

/** 面板窗的 fake preload：与真机同形（同一个 `platform.workspace` 命名空间 + 既有 `platform.settings`）。 */
function installPanelWindow(appearance: AppAppearance, contextTheme: string): FakePanelWindow {
  const current = { ...appearance }
  let theme = contextTheme
  const state = { settingsCalls: 0, contextCalls: 0 }
  const listeners = new Set<(event: unknown) => void>()
  const panel = () => ({
    workspaceInstanceKey: WORKSPACE_KEY, panelInstanceKey: PANEL_KEY, panelId: PANEL_ID,
    open: true, mode: 'detached', presentation: 'normal', bindingState: 'unavailable',
    lastValidDock: 'embedded', windowInstanceId: WINDOW_ID, hostEpoch: HOST_EPOCH
  })
  const mount = () => ({
    workspaceInstanceKey: WORKSPACE_KEY, panelInstanceKey: PANEL_KEY, panelId: PANEL_ID,
    open: true, mode: 'detached', bindingState: 'unavailable'
  })
  Reflect.set(window, 'platform', {
    settings: { get: async () => { state.settingsCalls += 1; return { ...current } } },
    workspace: {
      getHostContext: async () => {
        state.contextCalls += 1
        return {
          status: 'ok',
          context: {
            windowInstanceId: WINDOW_ID, hostEpoch: HOST_EPOCH, role: 'panel', mounts: [mount()],
            layoutRevision: 2, pageIds: [], pendingTransfer: null,
            preferences: { language: 'en-US', theme }
          }
        }
      },
      getSnapshot: async () => ({
        status: 'ok',
        snapshot: {
          layoutRevision: 2, activeWorkspaceInstanceKey: WORKSPACE_KEY, panels: [panel()],
          pageLayouts: [{ workspaceInstanceKey: WORKSPACE_KEY, panelOrder: [PANEL_KEY], activePanels: {} }],
          tabs: [], persistenceState: 'saved'
        }
      }),
      command: async () => ({ status: 'rejected', errorCode: 'invalid-request' }),
      onEvent: (listener: (event: unknown) => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      }
    }
  })
  return {
    state,
    setAppearance: (next) => { Object.assign(current, next) },
    setContextTheme: (next) => { theme = next },
    emit: (event) => { for (const listener of [...listeners]) listener(event) }
  }
}

/** 首帧探针：记录**首次 layout**（早于任何 `useEffect`）时根节点上已经存在的属性值。 */
function firstFrameProbe(seen: (string | null)[]): ReactElement {
  return createElement(function FirstFrameProbe() {
    useLayoutEffect(() => {
      seen.push(document.documentElement.getAttribute('data-accent'))
    }, [])
    return createElement('span', { 'data-probe': 'first-frame' })
  })
}

/** antd token 探针：读**最近一层 `ConfigProvider`** 解析出的 token（没有 Provider 时即 antd 默认浅色）。 */
function tokenProbe(): ReactElement {
  return createElement(function TokenProbe() {
    const { token } = antdTheme.useToken()
    return createElement('span', {
      'data-probe': 'antd-token',
      'data-probe-background': token.colorBgContainer,
      'data-probe-text': token.colorText,
      'data-probe-border': token.colorBorder
    })
  })
}

async function renderPanelWindow(appearance: AppAppearance, contextTheme: string, seen: (string | null)[] = []): Promise<HTMLDivElement & { fake?: FakePanelWindow }> {
  const fake = installPanelWindow(appearance, contextTheme)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const current = root
  await act(async () => {
    current.render(createElement(WorkspaceWindowRoot, {
      renderPanelContent: () => createElement('div', { 'data-probe': 'panel-content' },
        firstFrameProbe(seen), tokenProbe())
    } as WorkspaceWindowRootProps))
  })
  await settle()
  return Object.assign(container, { fake })
}

const probeAttribute = (view: HTMLDivElement, name: string): string | null =>
  view.querySelector<HTMLElement>('[data-probe="antd-token"]')?.getAttribute(name) ?? null

describe('PLAT-39 ②①：分离窗根属性必须与主窗**逐字相同**（data-theme/data-theme-mode/data-accent）', () => {
  it('受控主题=dark + 应用设置 dark/violet ⇒ 三项根属性全部写出（此前只写 data-theme）', async () => {
    await renderPanelWindow({ themeMode: 'dark', accentColor: 'violet' }, 'dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme-mode')).toBe('dark')
    expect(document.documentElement.getAttribute('data-accent')).toBe('violet')
  })

  it('受控主题=light + 应用设置 light/cyan ⇒ 三项根属性同样逐字写出（不臆造、不改名）', async () => {
    await renderPanelWindow({ themeMode: 'light', accentColor: 'cyan' }, 'light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(document.documentElement.getAttribute('data-theme-mode')).toBe('light')
    expect(document.documentElement.getAttribute('data-accent')).toBe('cyan')
  })

  it('受控上下文主题不可解析（system）⇒ 主题值仍不臆造，但主题模式/强调色仍与主窗一致', async () => {
    await renderPanelWindow({ themeMode: 'system', accentColor: 'lime' }, 'system')
    expect(document.documentElement.getAttribute('data-theme-mode')).toBe('system')
    expect(document.documentElement.getAttribute('data-accent')).toBe('lime')
  })
})

describe('PLAT-39 ②③：根属性必须在正文**首次 layout** 之前写好（不是首帧之后补写）', () => {
  it('内容里第一个 layout effect 观察到的 data-accent 已是应用设置值', async () => {
    const seen: (string | null)[] = []
    await renderPanelWindow({ themeMode: 'dark', accentColor: 'violet' }, 'dark', seen)
    expect(seen.length).toBeGreaterThan(0)
    expect(seen[0]).toBe('violet')
  })
})

describe('PLAT-39 ②②：分离窗内容必须在与主窗**同一套 antd token** 下渲染（深色应用不得出现白面）', () => {
  it('受控主题=dark ⇒ 内容拿到的 colorBgContainer/colorText/colorBorder 是主窗暗色 token', async () => {
    const view = await renderPanelWindow({ themeMode: 'dark', accentColor: 'lime' }, 'dark')
    expect(probeAttribute(view, 'data-probe-background')).toBe(DARK_TOKENS.background)
    expect(probeAttribute(view, 'data-probe-text')).toBe(DARK_TOKENS.text)
    expect(probeAttribute(view, 'data-probe-border')).toBe(DARK_TOKENS.border)
  })

  it('受控主题=light ⇒ 同一探针拿到浅色 token（双向一致，不是把深色写死）', async () => {
    const view = await renderPanelWindow({ themeMode: 'light', accentColor: 'lime' }, 'light')
    expect(probeAttribute(view, 'data-probe-background')).toBe(LIGHT_TOKENS.background)
    expect(probeAttribute(view, 'data-probe-text')).toBe(LIGHT_TOKENS.text)
    expect(probeAttribute(view, 'data-probe-border')).toBe(LIGHT_TOKENS.border)
  })
})

describe('PLAT-39 ②④：外观跟读**有界**（绝不自持环、绝不按事件数放大）', () => {
  it('挂载后设置恰读一次；一次偏好事件至多再读一次；此后无自持环', async () => {
    const view = await renderPanelWindow({ themeMode: 'dark', accentColor: 'lime' }, 'dark')
    const fake = view.fake as FakePanelWindow
    const callsAfterMount = fake.state.settingsCalls
    expect(callsAfterMount).toBeGreaterThanOrEqual(1)
    expect(callsAfterMount).toBeLessThanOrEqual(2)

    // 一次受控偏好事件（既有事件词汇）：至多一次上下文重取 + 至多一次设置重读
    fake.setContextTheme('light')
    fake.setAppearance({ themeMode: 'light' })
    await act(async () => { fake.emit({ type: 'snapshot', layoutRevision: 3, scope: { workspaceInstanceKey: WORKSPACE_KEY } }) })
    await settle()
    const callsAfterOneEvent = fake.state.settingsCalls
    expect(callsAfterOneEvent).toBeGreaterThanOrEqual(callsAfterMount)
    expect(callsAfterOneEvent).toBeLessThanOrEqual(callsAfterMount + 2)

    // 静置若干轮：值未变 ⇒ 绝不再读（无自持环、无忙轮询）
    await settle()
    await settle()
    expect(fake.state.settingsCalls).toBe(callsAfterOneEvent)
  })
})
