// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { WorkspaceWindowChromePolicy } from '@platform/workspace/policies'
import { placeholderAdapter, placeholderRegistration, WorkspaceDetachedPanelSurface } from './workspaceWindowSurfaces'
import type { WorkspacePanelView } from './WorkspacePanelHost'

/**
 * Owner: apps/desktop-shell renderer / workspace（**PLAT-37**：分离面板窗不填充）。
 *
 * 缺陷（PLAT-32R 真机证据）：面板窗的 `.workspace-panel-surface` 高度 = **内容高度**（约 34px），
 * `surfaceFillsWindow:false`；页窗（P2-14/PLAT-39）早已是「内容区 = 窗高 − 顶栏高」。
 *
 * 根因（CSS 可证，不是推测）：面板窗根 `.workspace-panel-window` 只声明了
 * `grid-template-rows: var(--topbar-height) minmax(0, 1fr)`，**没有任何 height**。
 * 于是这个 grid 容器的高度是 `auto`（内容尺寸），`minmax(0, 1fr)` 的 1fr 行在 auto 高度的容器里
 * 退化成**内容高度**（实测 34px）—— 与页窗根 `.workspace-window-page { height: 100% }` 的差别只有这一条。
 *
 * 本文件能断言什么（与 P2-05/P2-14 同一纪律，如实记录）：
 *  happy-dom 不做布局计算，所以「是否真的吃满」在组件层无法直接观测；这里断言**链条契约**
 *  （缺任一声明即失败）+ 真实组件渲染出的 DOM 结构，判据与页窗逐字同构：
 *    #root(100%) → `.workspace-panel-window`（height:100% + grid rows = 顶栏 + minmax(0,1fr)）
 *    → `.workspace-panel-surface`（height:100% + min-height:0 + 有界滚动）
 *  ⇒ 内容区 = **窗高 − 顶栏高**（顶栏高走命名策略 `WorkspaceWindowChromePolicy.topBarHeightVar`）。
 *  真机上「面板根是否吃满内容区」仍由真机验收取证；本包不启动 Electron、不臆造真机结论。
 */

const workspaceCss = readFileSync(
  resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/workspace/workspaceLayout.css'),
  'utf8'
)
const shellCss = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/styles.css'), 'utf8')

/** 注释里可能带 `{}`（本仓库注释很详尽），解析前先剥掉注释，避免把注释当规则。 */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** 取某个**单独**选择器的声明块（不做级联求解：这里只验证「链条被显式声明过」）。 */
function declarations(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = withoutComments(css).match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'))
  return match?.[1] ?? ''
}

function declaration(block: string, property: string): string {
  const match = block.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'm'))
  return match?.[1]?.trim() ?? ''
}

const PANEL_WINDOW_ROOT = '.workspace-panel-window'
const PANEL_SURFACE = '.workspace-panel-window > .workspace-panel-surface'
const PAGE_WINDOW_ROOT = '.workspace-window-page'

/** 两窗（页窗/面板窗）的**行模板**必须逐字相同：顶栏一行 + 其余全部给正文。 */
const EXPECTED_ROWS = `var(${WorkspaceWindowChromePolicy.topBarHeightVar}) minmax(0, 1fr)`

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  document.body.replaceChildren()
})

const MOUNT = {
  workspaceInstanceKey: 'workspace-panel-window', panelInstanceKey: 'panel-plat37', panelId: 'sample.panel-plat37',
  open: true, mode: 'detached', bindingState: 'unavailable'
} as const

function views(): Record<string, WorkspacePanelView> {
  return {
    'panel-plat37': {
      // 注册信息走平台的安全占位注册（与生产缺注入时的同一条路径），只覆盖本地化标题
      registration: {
        ...placeholderRegistration('sample.panel-plat37'),
        title: { 'en-US': 'Inspector', 'zh-CN': '检查器' }
      },
      title: 'Inspector',
      content: createElement('p', null, 'panel body'),
      adapter: placeholderAdapter()
    }
  }
}

describe('PLAT-37：分离面板窗根必须自己具名声明完整高度链', () => {
  it('面板窗根声明 height:100% + grid 两行（顶栏 + minmax(0,1fr)），与页窗行模板逐字一致', () => {
    const panelWindow = declarations(workspaceCss, PANEL_WINDOW_ROOT)
    expect(panelWindow).not.toBe('')
    expect(declaration(panelWindow, 'display')).toBe('grid')
    // 根因判据：容器自己没有高度 ⇒ 1fr 行退化成内容高度（34px）
    expect(declaration(panelWindow, 'height')).toBe('100%')
    expect(declaration(panelWindow, 'min-height')).toBe('0')
    expect(declaration(panelWindow, 'min-width')).toBe('0')
    expect(declaration(panelWindow, 'grid-template-rows')).toBe(EXPECTED_ROWS)
    expect(declaration(panelWindow, 'grid-template-columns')).toBe('minmax(0, 1fr)')
    // 有界：不允许靠溢出把内容推向窗口之外
    expect(declaration(panelWindow, 'overflow')).toBe('hidden')

    // 与页窗判据一致：同一个行模板（内容区 = 窗高 − 顶栏高）
    const pageWindow = declarations(workspaceCss, PAGE_WINDOW_ROOT)
    expect(declaration(pageWindow, 'grid-template-rows')).toBe(declaration(panelWindow, 'grid-template-rows'))
  })

  it('正文面自己声明 height:100% + min-height:0 + 有界滚动（不吃内容尺寸）', () => {
    const surface = declarations(workspaceCss, PANEL_SURFACE)
    expect(surface).not.toBe('')
    expect(declaration(surface, 'height')).toBe('100%')
    expect(declaration(surface, 'min-height')).toBe('0')
    expect(declaration(surface, 'min-width')).toBe('0')
    expect(declaration(surface, 'overflow')).toBe('auto')
    // PLAT-08 判据不放宽：正文面不加 padding / 上边框（真机窄屏证据要求 0）
    expect(declaration(surface, 'padding')).toBe('')
    expect(declaration(surface, 'border-top')).toBe('')
  })

  it('顶栏高度只有命名来源（--topbar-height = WorkspaceWindowChromePolicy.topBarHeight），不出现匿名 42', () => {
    const rootDeclarations = withoutComments(shellCss).match(/:root\s*\{([^}]*)\}/m)?.[1] ?? ''
    expect(declaration(rootDeclarations, '--topbar-height')).toBe(`${WorkspaceWindowChromePolicy.topBarHeight}px`)
    const panelWindow = declarations(workspaceCss, PANEL_WINDOW_ROOT)
    expect(panelWindow).not.toMatch(/\b42px\b/)
  })

  it('真实组件渲染：根 → 顶栏 → 正文面（正文面是 1fr 行的直接 grid 子项，无内联高度/内边距）', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const reactRoot = createRoot(host)
    root = reactRoot
    await act(async () => {
      reactRoot.render(createElement(WorkspaceDetachedPanelSurface, {
        mounts: [MOUNT], views: views(), timeZone: 'UTC'
      }))
    })

    // 面板窗根必须是唯一顶层节点：不得有游离文本节点（注释/占位文本会被真实渲染出来）
    expect(host.childNodes).toHaveLength(1)
    const panelWindow = host.querySelector<HTMLElement>('.workspace-panel-window')
    expect(panelWindow).not.toBeNull()
    const children = [...(panelWindow?.children ?? [])]
    expect(children.map((child) => child.className)).toEqual([
      'workspace-window-topbar',
      'workspace-panel-surface'
    ])
    const surface = children[1] as HTMLElement
    expect(surface.getAttribute('data-panel-key')).toBe('panel-plat37')
    // 布局链只由 CSS 承载：内联样式不得再声明高度/内边距（否则两处来源）
    expect(surface.style.height).toBe('')
    expect(surface.style.minHeight).toBe('')
    expect(surface.style.overflow).toBe('')
    expect(panelWindow?.style.height).toBe('')
    expect(panelWindow?.style.display).toBe('')
  })
})
