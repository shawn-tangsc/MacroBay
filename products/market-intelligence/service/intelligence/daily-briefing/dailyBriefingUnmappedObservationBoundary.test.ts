import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 用户 2026-11-16 定的边界：**非标准表（未映射观测）只在日历组件里显示，不进简报、不进 AI 分析。**
 *
 * 日历线为此会加一个只给渲染层用的只读接口（名字里带 `unmapped`，例如
 * `listUnmappedCalendarObservationsForRendering`）。简报这一侧要做的是「守」：一旦有人把它接进
 * 简报依赖，这条断言当场红——而不是等读者在日报里看到一条没有身份、不参与发布判断的行。
 *
 * 为什么用静态扫描而不是行为用例：那种数据今天可能一条都没有，行为用例会绿；而「接进来」这个
 * 动作在 import 那一行就发生了，静态断言才拦得住。
 */
const ROOT = join(process.cwd(), 'products/market-intelligence/service/intelligence/daily-briefing')

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) { yield* walk(full); continue }
    if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) yield full
  }
}

/** 去掉注释再扫：注释里提一句「不许读 unmapped」不该让守卫红，真正接进来的代码才该红。 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

const unmappedSpecifier = /from\s+['"]([^'"]*unmapped[^'"]*)['"]/i
const unmappedIdentifier = /\b(?:list|read|query|get|fetch)?Unmapped[A-Za-z0-9_]*/

describe('unmapped observations stay out of the daily briefing', () => {
  it('no briefing file imports or names the rendering-only unmapped interface', () => {
    const offenders: string[] = []
    for (const file of walk(ROOT)) {
      const code = stripComments(readFileSync(file, 'utf8'))
      code.split('\n').forEach((line, index) => {
        if (unmappedSpecifier.test(line) || unmappedIdentifier.test(line)) {
          offenders.push(`${file.slice(ROOT.length + 1)}:${index + 1}: ${line.trim()}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })

  it('still reads the calendar from the standard table only', () => {
    const localize = readFileSync(join(ROOT, 'dailyBriefingRenderLocalize.ts'), 'utf8')
    // 简报的日历事件来源是标准表的月查询；这条断言与「未映射不进简报」是同一件事的两面。
    expect(localize).toContain('queryMarketCalendarMonth')
  })
})
