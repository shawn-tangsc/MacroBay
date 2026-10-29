import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 页面根的高度契约。
 *
 * 看板与日历的根都写着 `height: 100%`，它们的滚动条各自属于 pane；只有每一层父级都给出确定高度，
 * 这条链才成立。示例模式在页面最外层加了一层 `.mi-sample-surface`，它一旦没有高度，整页（看板 + 右栏）
 * 就会被宿主一起滚 —— 读者 2026-10-27 的「滚动会带着右边一起滚动」正是这样出现的。
 *
 * 这条守卫把两半都钉住：宿主那一层（shell 的 `.workspace-page-body`）与产品这一层（surface）。
 */
const surfaceStyles = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/sampleMode.css'), 'utf8')
const shellStyles = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/shell/workspace/workspaceLayout.css'), 'utf8')

function cssBlock(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker)
  const blockStart = source.indexOf('{', markerIndex)
  if (markerIndex < 0 || blockStart < 0) return ''

  let depth = 0
  for (let index = blockStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(blockStart + 1, index)
  }

  return ''
}

describe('sample mode page surface', () => {
  it('keeps the shell height contract that the page roots rely on', () => {
    const pageBody = cssBlock(shellStyles, '.workspace-page-body {')

    expect(pageBody).toContain('height: 100%')
    expect(pageBody).toContain('min-height: 0')
  })

  it('passes that height through instead of collapsing to content height', () => {
    const surface = cssBlock(surfaceStyles, '.mi-sample-surface {')

    // 没有 `height: 100%`，子页面的 `height: 100%` 全部退化成 auto，滚动就会跑到外层宿主。
    expect(surface).toContain('height: 100%')
    expect(surface).toContain('min-height: 0')
    expect(surface).toContain('display: flex')
    expect(surface).toContain('flex-direction: column')
  })

  it('bounds the pages that scroll inside their own panes and leaves the document page alone', () => {
    expect(surfaceStyles).toContain('.mi-sample-surface > .mi-analysis-dashboard-layout,')
    expect(surfaceStyles).toContain('.mi-sample-surface > .mi-economic-calendar,')

    const bounded = surfaceStyles.slice(surfaceStyles.indexOf('.mi-sample-surface > .mi-analysis-dashboard-layout,'))
    expect(bounded).toContain('flex: 1 1 0')
    expect(bounded).toContain('min-height: 0')

    // Agent 入口靠宿主滚动，被压缩会让它的内容不可达。
    const portal = cssBlock(surfaceStyles, '.mi-sample-surface > .mi-agent-portal {')
    expect(portal).toContain('flex: 0 0 auto')
  })
})
