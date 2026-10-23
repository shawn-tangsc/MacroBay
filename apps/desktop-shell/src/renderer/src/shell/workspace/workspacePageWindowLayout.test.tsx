// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import type { WorkspaceTabState } from '@platform/workspace/contracts'
import { WorkspacePageHost } from './WorkspacePageHost'

/**
 * Owner: apps/desktop-shell renderer / workspace（P2-14 focused）。
 * 权威：技术设计 §4「独立页面窗只渲染正文」、P2-14 真机缺陷「页面窗正文只有左上角一小块 / 没吃满窗口」。
 *
 * 缺陷（修复前，CSS 可证）：页面窗根**复用**了准备期/错误壳的 `.workspace-window-shell`：
 *   `.workspace-window-shell { display:flex; flex-direction:column; align-items:center; justify-content:center;
 *    padding:24px; text-align:center }`
 * 于是页面宿主 `.workspace-page-host`（在 P2-05 的链里只有 `min-height:0`）作为**居中 flex 项**退化为内容尺寸：
 * 它没有 `height:100%`，其子 `.workspace-page-host-panel { height:100% }` 因此对 `auto` 高度解析成 `auto`，
 * `.workspace-page-body { height:100% }` 同样退化 —— 产品页根拿不到窗口高度，正文缩成一块并居中。
 *
 * ## 本文件能断言什么（与 P2-05 同一纪律，如实记录）
 *  happy-dom 不做布局计算，所以「正文是否真的吃满窗口」在组件层**无法直接观测**；这里断言的是
 *  **链条契约**（缺任一声明即失败），并用源码护栏 + 真实组件渲染保证规则命中的 class 不是死代码：
 *   页面窗根 `.workspace-window-page`（`height:100%` + `min-height:0` + 不再居中/不留 24px 内边距）
 *   → `.workspace-page-host`（`height:100%` + `min-width/min-height:0`）
 *   → `.workspace-page-host-panel`（`height:100%` + 有界滚动，P2-05 既有）
 *   → `.workspace-page-body`（`height:100%` + 有界滚动，P2-05 既有）。
 *  真机上「页面根是否吃满内容区」由另一条真机验收线程（P2-06T）取证，本包不臆造真机结论。
 */

const workspaceCss = readFileSync(
  resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/workspace/workspaceLayout.css'),
  'utf8'
)
/**
 * 页面窗根与正文宿主的**渲染点**：PLAT-39 ② 按 PLAT-02 行数纪律把这一面从 `WorkspaceWindowRoot.tsx`
 * 抽到 `WorkspacePageWindowSurface.tsx`（DOM/class/结构逐字不变）⇒ 护栏读**两个文件**，
 * 判据本身不放松（class 仍必须存在，且 `<WorkspacePageHost>` 仍必须在其之后）。
 */
const windowRootSource = [
  readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/workspace/WorkspaceWindowRoot.tsx'), 'utf8'),
  readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/workspace/WorkspacePageWindowSurface.tsx'), 'utf8')
].join('\n')

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

const PAGE_WINDOW_ROOT = '.workspace-window-page'
const PAGE_WINDOW_PAGE_HOST = '.workspace-window-page > .workspace-page-host'

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = undefined
  document.body.replaceChildren()
})

describe('P2-14：独立页面窗根的纵向/横向链条', () => {
  it('页面窗根必须自己具名声明完整高度链（height:100% + min-height:0），不得只靠居中 flex 壳', () => {
    const pageWindow = declarations(workspaceCss, PAGE_WINDOW_ROOT)
    expect(pageWindow).not.toBe('')
    expect(declaration(pageWindow, 'height')).toBe('100%')
    expect(declaration(pageWindow, 'min-height')).toBe('0')
  })

  it('页面窗根不得沿用准备期/错误壳的居中与内边距（正文必须从窗口左上角开始并吃满）', () => {
    const pageWindow = declarations(workspaceCss, PAGE_WINDOW_ROOT)
    // 居中 flex 项 ⇒ 正文按内容尺寸缩成一块；shell 的 24px 内边距 + 2px 顶边框再吃掉一圈
    expect(declaration(pageWindow, 'display')).toMatch(/^(grid|block|flex)$/)
    expect(declaration(pageWindow, 'align-items')).toBe('stretch')
    expect(declaration(pageWindow, 'padding')).toBe('0')
    expect(declaration(pageWindow, 'border-top')).toBe('0')
    expect(declaration(pageWindow, 'text-align')).toBe('start')
  })
  it('页面宿主必须显式参与页面窗的尺寸链（height:100% + min-width/min-height:0）', () => {
    const host = declarations(workspaceCss, PAGE_WINDOW_PAGE_HOST)
    expect(host).not.toBe('')
    expect(declaration(host, 'height')).toBe('100%')
    expect(declaration(host, 'min-height')).toBe('0')
    expect(declaration(host, 'min-width')).toBe('0')
  })

  it('规则命中的 class 与结构必须正是页面窗渲染出来的（防止规则变死代码）', async () => {
    // 源码护栏：页窗根 class 与 WorkspacePageHost 的父子关系由唯一渲染点决定
    expect(windowRootSource).toContain('className="workspace-window-shell workspace-window-page"')
    expect(windowRootSource.indexOf(`<WorkspacePageHost`)).toBeGreaterThan(
      windowRootSource.indexOf('className="workspace-window-shell workspace-window-page"')
    )
    // 真实组件：宿主根 class 与其面板子节点都被上面的选择器命中
    const state: WorkspaceTabState = Object.freeze({
      layoutRevision: 1,
      activeWorkspaceInstanceKey: 'ws-1',
      tabs: Object.freeze([{
        workspaceInstanceKey: 'ws-1', pageId: 'agents', menuKey: 'agents', open: true, order: 0,
        mode: 'main' as const, bindingState: 'bound' as const, windowInstanceId: 'main', hostEpoch: 1
      }]),
      recentlyClosedCount: 0
    })
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        <div className="workspace-window-page">
          <WorkspacePageHost language="zh-CN" state={state} renderPage={() => <p>page</p>} />
        </div>
      )
    })
    expect(container.querySelector('.workspace-window-page > .workspace-page-host')).not.toBeNull()
    expect(container.querySelector('.workspace-page-host > .workspace-page-host-panel')).not.toBeNull()
  })
})
