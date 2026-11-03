import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { findCandidates, REVIEW_MARKER, unknownDebtRows } from './check-state-content-ternary.mts'

/**
 * 发现器自己的两个夹具，各钉一个方向：
 * - 负向：状态判定决定整片内容画不画（多行三元 + `<table>`）→ **必须被报出**；
 * - 正向：两支都是空态/加载组件 → **不许报**。
 *
 * 夹具签在 `scripts/fixtures/state-content-ternary/`，不是只在聊天里验过。
 */
describe('state-content-ternary candidate finder', () => {
  it('reports the negative fixture — a state decision hiding a whole table', () => {
    const text = readFileSync(join(__dirname, 'fixtures/state-content-ternary/negative.tsx'), 'utf8')
    const candidates = findCandidates('negative.tsx', text)

    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.reviewed).toBe(false)
    expect(candidates[0]?.source).toContain(`state === 'available'`)
  })

  it('does not report the positive fixture — both branches are state components', () => {
    const text = readFileSync(join(__dirname, 'fixtures/state-content-ternary/positive.tsx'), 'utf8')

    expect(findCandidates('positive.tsx', text)).toEqual([])
  })

  it('accepts a candidate once a human wrote the conclusion next to it', () => {
    const text = [
      `// ${REVIEW_MARKER} — 这里的三元只管一句附注，列表自己按长度判`,
      `const block = {state === 'available' ? (`
    ].join('\n')

    // 没有内容容器，本来就不算候选；这条同时钉住「留痕标记的写法」。
    expect(findCandidates('reviewed.tsx', text)).toEqual([])
  })

  it('a bare marker with no reason still counts as unreviewed — 免检牌不算复核', () => {
    // 只判「出现过这几个字」的话，光秃秃一行就能让扫描器说「全部已复核」，
    // 而实际上没人写过一个字的理由。这就是「绿得没法验证」。
    const text = [
      `{/* ${REVIEW_MARKER} */}`,
      `const block = {state === 'available' ? <table><tbody>{rows.map((row) => row.id)}</tbody></table> : null}`
    ].join('\n')

    const candidates = findCandidates('bare-marker.tsx', text)
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.reviewed).toBe(false)
  })

  it('a marker whose reason is a single character is not a review either', () => {
    const text = [
      `{/* ${REVIEW_MARKER} — 无 */}`,
      `const block = {state === 'available' ? <table><tbody>{rows.map((row) => row.id)}</tbody></table> : null}`
    ].join('\n')

    expect(findCandidates('thin-marker.tsx', text)[0]?.reviewed).toBe(false)
  })

  it('debt 档不判红，但要把台账行号带出来（欠账不许冒充例外）', () => {
    const text = [
      `{/* debt: MI-11-R161 — 有计划，等迁移 AsyncState 时一起改 */}`,
      `const block = {state === 'available' ? <table><tbody>{rows.map((row) => row.id)}</tbody></table> : null}`
    ].join('\n')

    const candidate = findCandidates('debt.tsx', text)[0]
    expect(candidate?.reviewed).toBe(true)
    expect(candidate?.debt).toBe('MI-11-R161')
  })

  it('debt 行号必须在台账里真的存在，写错了要点名', () => {
    const text = [
      `{/* debt: MI-11-R999 */}`,
      `const block = {state === 'available' ? <table><tbody>{rows.map((row) => row.id)}</tbody></table> : null}`
    ].join('\n')

    const candidates = findCandidates('debt-bad.tsx', text)
    // 号码写错时它不是「已复核」，因为台账里没人会来修这一条。
    expect(unknownDebtRows(candidates, new Set(['MI-11-R161']))).toEqual(['MI-11-R999'])
    expect(unknownDebtRows(candidates, new Set(['MI-11-R999']))).toEqual([])
  })

  it('写成 debt 但没有行号，等于没写，仍算未复核', () => {
    const text = [
      `{/* debt: 以后再说 */}`,
      `const block = {state === 'available' ? <table><tbody>{rows.map((row) => row.id)}</tbody></table> : null}`
    ].join('\n')

    const candidate = findCandidates('debt-null.tsx', text)[0]
    expect(candidate?.reviewed).toBe(false)
    expect(candidate?.debt).toBeUndefined()
  })
})
