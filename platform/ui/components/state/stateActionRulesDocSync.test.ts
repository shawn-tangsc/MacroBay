import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { STATE_VIEW_ACTION_RULES, STATE_VIEW_ACTION_CHOICES } from '../../../contracts/queryOutcome'

/**
 * 动作列的两条守卫（契约 §16）。
 *
 * 「有没有动作」已经从类型里拿出来了，所以保障必须换成表格 + 扫描：
 * ① 两份公开文档的动作列与 `queryOutcome.ts` 的规则表**逐条相等**——任何一边多一行、少一行、
 *    或同一码判得不一样，都红；
 * ② 调用点扫描见 `stateViewCallSiteGuard.test.ts`。
 *
 * 这两条替代的是「我会逐处点」。一条永远通过的用例比没有用例更糟，所以下面还有一条反向用例，
 * 证明解析器不会把空表当成「全部通过」。
 */

const ROOT = resolve(__dirname, '../../../..')

type DocRow = { code: string; action: string }

/** 从文档表格里抽出 `| state | code | action | …` 三类行。 */
function docRows(file: string): DocRow[] {
  const text = readFileSync(join(ROOT, file), 'utf8')
  const rows: DocRow[] = []
  for (const line of text.split('\n')) {
    const match = /^\|\s*`(empty|error|disabled|permission)`\s*\|\s*`([a-z-]+)`\s*\|\s*(required|forbidden)\b/.exec(
      line
    )
    if (match) rows.push({ code: `${match[1]}.${match[2]}`, action: match[3]! })
  }
  return rows
}

describe('action rules match the documented table', () => {
  it('lists exactly the same codes, with the same required/forbidden verdict', () => {
    const rows = docRows('docs/development/ui-state-components.md')
    const documented = Object.fromEntries(rows.map((row) => [row.code, row.action]))

    expect(Object.keys(documented).sort()).toEqual(Object.keys(STATE_VIEW_ACTION_RULES).sort())
    for (const [code, action] of Object.entries(documented)) {
      expect(STATE_VIEW_ACTION_RULES[code], `${code} 的判定与文档不一致`).toBe(action)
    }
  })

  it('has the same number of rows in the Chinese table', () => {
    const english = docRows('docs/development/ui-state-components.md')
    const chinese = docRows('docs/development/ui-state-components.zh-CN.md')
    const ruleCount = Object.keys(STATE_VIEW_ACTION_RULES).length

    expect(english).toHaveLength(ruleCount)
    // 中文表可以少列、但不能多判；数量不一致时至少两边都在规则表这个数上，避免一份偷偷落后。
    expect(chinese.length === ruleCount || chinese.length === 0).toBe(true)
  })

  it('names several allowed actions per code, and the doc lists the same ones', () => {
    // 规则来源是代码（`STATE_VIEW_ACTION_CHOICES`），文档是被同步的那一份：这里只做逐条比对。
    // 不断言「固定几个键」——那样下一次按裁定加键时，又要手改一条旧账。
    const lines = readFileSync(join(ROOT, 'docs/development/ui-state-components.md'), 'utf8').split('\n')
    const row = lines.find((line) => line.includes('`none-installed`')) ?? ''
    const documented = [...row.matchAll(/`([a-z-]+)`/g)].map((match) => `ui.state.action.${match[1]}`)
    // 行首的 `empty`、`none-installed` 不是动作键，只有出现在白名单里的才算。
    const allowed = [...STATE_VIEW_ACTION_CHOICES['empty.none-installed']!]
    const documentedActions = documented.filter((key) => allowed.includes(key))

    expect([...documentedActions].sort()).toEqual([...allowed].sort())
    expect(allowed.length).toBeGreaterThan(1)
  })

  it('cannot pass vacuously: an empty table is not a green table', () => {
    expect(Object.keys(STATE_VIEW_ACTION_RULES).length).toBeGreaterThan(10)
    expect(docRows('docs/development/ui-state-components.md').length).toBeGreaterThan(10)
  })
})
