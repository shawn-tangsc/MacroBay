// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

import { createWorkspacePageContentProvider } from './workspacePageContentProvider'

/**
 * Owner: apps/desktop-shell renderer / workspace 纵向约束链回归（P2-05）。
 * 权威：技术设计 §3、P1-03 尺寸裁决、P2-05 缺陷「Tab 条出现后纵向高度失控」。
 *
 * ## 为什么此前的测试全都抓不到这个缺陷（如实记录）
 *  1. happy-dom（以及 jsdom）**不做布局计算**：`height: auto`、百分比高度、grid 轨道拉伸一律不解析，
 *     所以「页面有没有吃满内容区」在组件层**无法观测**——只能断言链条本身。
 *  2. `.app-shell { height: 100%; overflow: hidden }` 让 `documentElement.scrollHeight === clientHeight`
 *     **恒成立**。任何「文档不溢出」的断言即使代码是坏的也会通过 ⇒ 那类断言是空断言，不能作为门。
 *  3. 缺陷只在**真机**出现，而且需要「页面内容确实高于内容区」才可见（产品页 6 图 + 每图 min-height 620px）：
 *     内容区高度链断在无样式包裹层 ⇒ 产品页根 `height: 100%` 退化为 `auto` ⇒ 页面长到内容高度。
 *
 * ## 因此本测试断言的是**链条契约**（可证伪、且与真机断言互补）
 *  内容区 = `.page-body` → `.workspace-tab-strip`（Tab 条 + 1fr）→ `.workspace-page-host`
 *  → `.workspace-page-host-panel` → `.workspace-page-body`（P2-03 新增包裹层）→ 页面根。
 *  **中间任何一层缺 `height`/`min-height: 0`，产品页的 `height: 100%` 就会退化为 `auto`**。
 *  同时禁止用全局 `overflow: hidden` 掩盖不可达内容：承载页面的有界层必须是**可滚动**容器。
 */

const workspaceCss = readFileSync(
  resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/workspace/workspaceLayout.css'),
  'utf8'
)
const shellCss = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/styles.css'), 'utf8')

/** 注释里可能带 `{}`（本仓库的注释很详尽），因此解析前先剥掉注释，避免把注释当规则。 */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** 取某个**单独**选择器的声明块（不做级联求解：这里只验证「链条被显式声明过」）。 */
function declarations(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = withoutComments(css).match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'))
  return match?.[1] ?? ''
}

function declaration(block: string, property: string): string | null {
  const match = block.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'm'))
  return match?.[1]?.trim() ?? null
}

let root: Root | undefined
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = undefined
  document.body.replaceChildren()
})

describe('P2-05：内容区纵向约束链', () => {
  it('Tab 条是内容区网格里的固定高度项，内容区因此拿到「视口 − 顶栏 − Tab 条」的确定高度', () => {
    const strip = declarations(workspaceCss, '.workspace-tab-strip')
    expect(strip).not.toBe('')
    // 第一行 auto（Tab 条自身高度）、第二行 minmax(0, 1fr)（页面宿主吃掉剩余高度，且可被压缩）
    expect(declaration(strip, 'grid-template-rows')).toBe('auto minmax(0, 1fr)')
    expect(declaration(strip, 'height')).toBe('100%')
    expect(declaration(strip, 'min-height')).toBe('0')

    const pageHost = declarations(workspaceCss, '.workspace-page-host')
    expect(declaration(pageHost, 'min-height')).toBe('0')
  })

  it('页面宿主面板是有界滚动容器（height:100% + overflow:auto），内容不可达时宁可滚动也不隐藏', () => {
    const panel = declarations(workspaceCss, '.workspace-page-host-panel')
    expect(declaration(panel, 'height')).toBe('100%')
    expect(declaration(panel, 'min-height')).toBe('0')
    const overflowY = declaration(panel, 'overflow') ?? declaration(panel, 'overflow-y')
    expect(overflowY).not.toBeNull()
    expect(overflowY).toMatch(/auto|scroll/)
  })

  /**
   * 缺陷根因（P2-05）：`.workspace-page-body` 是 P2-03 新增的包裹层，**此前没有任何 CSS 规则**，
   * 于是它是 `display: block; height: auto`。它夹在「确定高度的面板」与
   * `.settings-contribution-host { height: 100% }` 之间，把百分比高度链断掉：
   * 产品页根（`.market-page { height: 100% }`、`.mi-agent-portal { min-height: 100% }`）拿不到内容区高度，
   * 退化为内容高度 ⇒ 6 图上/下两行被窗口下沿裁掉。这一条在修复前**必然失败**。
   */
  it('内容区包裹层必须显式参与高度链（这是本次缺陷的那一层）', () => {
    const body = declarations(workspaceCss, '.workspace-page-body')
    expect(body).not.toBe('')
    expect(declaration(body, 'height')).toBe('100%')
    expect(declaration(body, 'min-height')).toBe('0')
    const overflowY = declaration(body, 'overflow') ?? declaration(body, 'overflow-y')
    expect(overflowY).toMatch(/auto|scroll/)
  })

  it('CSS 规则命中的 class 必须正是页面内容提供方渲染出来的 class（防止规则变死代码）', async () => {
    const provider = createWorkspacePageContentProvider({
      mounts: { assistants: () => null, agents: () => null, settings: () => null }
    })
    const content = provider.render({ pageId: 'assistants', menuKey: 'assistants', language: 'zh-CN', active: true })
    expect(content).not.toBeNull()
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(content as React.ReactElement)
    })
    expect(container.querySelector('.workspace-page-body')).not.toBeNull()
  })

  /**
   * 「不得用全局隐藏溢出掩盖内容不可达」的可证伪形式：承载页面的有界层若声明了 `overflow: hidden`，
   * 高于内容区的页面就会被裁掉且**无法滚动到**。有界层必须允许滚动（`auto`/`scroll`）。
   */
  it('产品页贡献宿主不得用 overflow:hidden 把高于内容区的页面变成不可达', () => {
    const host = declarations(shellCss, '.settings-contribution-host')
    expect(host).not.toBe('')
    expect(declaration(host, 'height')).toBe('100%')
    expect(declaration(host, 'min-height')).toBe('0')
    const overflowY = declaration(host, 'overflow') ?? declaration(host, 'overflow-y')
    expect(overflowY).not.toBeNull()
    expect(overflowY).toMatch(/auto|scroll/)
  })
})
