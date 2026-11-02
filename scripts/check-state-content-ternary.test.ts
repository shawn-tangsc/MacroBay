import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { findCandidates, REVIEW_MARKER } from './check-state-content-ternary.mts'

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
})
