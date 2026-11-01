import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 码表只有一处权威：`StateView.tsx` 的四个 `*ReasonCode` 联合。
 *
 * 公开文档两份（英文、中文）各有一张 `(state, reasonCode)` 表，和类型是**同一个事实的两个落点**。
 * 今晚已经出现过一次「文档说 12、代码说 12、名字对不上」：台账记了一份，组件里是另一份，
 * 两边都觉得自己对。这类漂移靠纪律挡不住，因为写码的人和写文档的人中间隔着一笔提交。
 *
 * 所以断言集合相等，两个方向都要红：
 * - 往文档里加一行、类型里不加 → 红；
 * - 类型加码、文档里不加 → 红。
 *
 * 每个方向各配一个夹具，用真文件内容改一处再跑一遍解析——**没红过的守卫，等于没有守卫**。
 */

const ROOT = process.cwd()
const SOURCE = join(ROOT, 'platform/ui/components/state/StateView.tsx')
const DOCS = [
  join(ROOT, 'docs/development/ui-state-components.md'),
  join(ROOT, 'docs/development/ui-state-components.zh-CN.md')
]

/** 联合类型名到 `state` 字面量的唯一映射。 */
const UNION_TO_STATE: Record<string, string> = {
  EmptyReasonCode: 'empty',
  ErrorReasonCode: 'error',
  DisabledReasonCode: 'disabled',
  PermissionReasonCode: 'permission'
}

/** 从源码里取出 `state/reasonCode` 对，顺序无关。 */
function pairsFromSource(text: string): string[] {
  const pairs: string[] = []

  for (const [unionName, state] of Object.entries(UNION_TO_STATE)) {
    const start = text.indexOf(`export type ${unionName} =`)
    if (start < 0) throw new Error(`missing union: ${unionName}`)

    // 联合体到下一个 `export ` 为止：`| 'a'` 多行与 `= 'a' | 'b'` 单行两种写法都要吃得下。
    const rest = text.slice(start)
    const next = rest.indexOf('\nexport ')
    const body = next < 0 ? rest : rest.slice(0, next)
    for (const match of body.matchAll(/'([a-z][a-z-]*)'/g)) {
      pairs.push(`${state}/${match[1]}`)
    }
  }

  return pairs
}

/** 从公开文档的两列表里取出同样的对。 */
function pairsFromDoc(text: string): string[] {
  const pairs: string[] = []

  for (const line of text.split('\n')) {
    const match = /^\|\s*`(empty|error|disabled|permission)`\s*\|\s*`([a-z][a-z-]*)`\s*\|/.exec(line)
    if (match) pairs.push(`${match[1]}/${match[2]}`)
  }

  return pairs
}

/** 双向差集：返回「多出来」与「缺掉的」两栏，空两栏才算相等。 */
function drift(actual: string[], expected: string[]): { extra: string[]; missing: string[] } {
  const a = new Set(actual)
  const e = new Set(expected)
  return {
    extra: [...a].filter((item) => !e.has(item)).sort(),
    missing: [...e].filter((item) => !a.has(item)).sort()
  }
}

const source = readFileSync(SOURCE, 'utf8')
const docTexts = DOCS.map((path) => ({ path, text: readFileSync(path, 'utf8') }))
const sourcePairs = pairsFromSource(source)

describe('StateView 码表与公开文档一致', () => {
  it('源码里四个联合都能解析到码', () => {
    expect(sourcePairs.length).toBeGreaterThan(0)
    expect(new Set(sourcePairs).size).toBe(sourcePairs.length)
  })

  it.each(docTexts)('$path 的码表与类型集合相等', ({ path, text }) => {
    const docPairs = pairsFromDoc(text)

    expect(drift(docPairs, sourcePairs), `${path} 与 StateView.tsx 的码表漂了`).toEqual({
      extra: [],
      missing: []
    })
  })

  it('红夹具：文档多一行、类型没有 → 必须报出来', () => {
    const doctored = docTexts[0].text.replace(
      '| `empty` | `not-yet` |',
      '| `empty` | `invented-code` | required: try | A code the type does not have. |\n| `empty` | `not-yet` |'
    )

    expect(drift(pairsFromDoc(doctored), sourcePairs)).toEqual({
      extra: ['empty/invented-code'],
      missing: []
    })
  })

  it('红夹具：类型多一个码、文档没有 → 必须报出来', () => {
    const doctored = source.replace(
      'export type ErrorReasonCode =',
      "export type ErrorReasonCode =\n  | 'invented-error'"
    )

    expect(drift(pairsFromDoc(docTexts[0].text), pairsFromSource(doctored))).toEqual({
      extra: [],
      missing: ['error/invented-error']
    })
  })
})
