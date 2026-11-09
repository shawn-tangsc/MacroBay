import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/** 行高只有三档；间距只有主档六个值；标签列只有 160。多一个数就是有人又拧了一格。 */
const ROW_HEIGHTS = new Set([44, 60, 84])
const MAIN_STEPS = new Set([4, 6, 8, 10, 12, 16])
const LABEL_WIDTH = 160

const css = readFileSync(join(__dirname, 'intelligence-sources.css'), 'utf8')
// 用工作区相对路径读壳层样式：deep relative 从本文件数出去容易数错一层。
const shellCss = readFileSync(join(process.cwd(), 'apps/desktop-shell/src/renderer/src/styles.css'), 'utf8')

/** 取指定选择器的规则体（够用就行：这些类名在本文件里唯一）。 */
function rulesFor(source: string, selectorPart: string): string[] {
  const out: string[] = []
  for (const match of source.matchAll(/([^{}]+)\{([^}]*)\}/gu)) {
    if (!match[1]!.includes(selectorPart)) continue
    out.push(match[2]!)
  }
  return out
}

function pxValues(body: string, property: string): number[] {
  const re = new RegExp(`${property}\\s*:\\s*([^;]+)`, 'gu')
  return [...body.matchAll(re)]
    .flatMap((m) => [...m[1]!.matchAll(/(-?\d+(?:\.\d+)?)px/gu)].map((v) => Number(v[1])))
}

describe('settings row values stay on their steps', () => {
  it('keeps the row height on 44 / 60 / 84 and never invents a fourth', () => {
    // 合并只换结构来源，不改数：这三档是三处设置行共同的口径。
    const bodies = rulesFor(css, 'intelligence-setting-row')
    const heights = bodies.flatMap((body) => [...pxValues(body, 'min-height'), ...pxValues(body, 'height')])
    for (const height of heights) expect(ROW_HEIGHTS.has(height)).toBe(true)
  })

  it('keeps the label column at 160', () => {
    const bodies = rulesFor(css, 'intelligence-setting-label')
    const widths = bodies.flatMap((body) => pxValues(body, 'width'))
    for (const width of widths) expect(width).toBe(LABEL_WIDTH)
  })

  it('keeps spacing on the six main steps', () => {
    const bodies = [
      ...rulesFor(css, 'intelligence-setting-row'),
      ...rulesFor(css, 'source-provider-detail__row'),
      ...rulesFor(shellCss, 'notification-row')
    ]
    for (const body of bodies) {
      for (const property of ['gap', 'column-gap', 'row-gap', 'padding', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom']) {
        for (const value of pxValues(body, property)) expect(MAIN_STEPS.has(value)).toBe(true)
      }
    }
  })
})
