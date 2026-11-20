import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { marketCalendarPublicPolicy } from './marketCalendarQueryContracts'

/**
 * `coverage` 的取值是**闭集**，且只有一处定义（`marketCalendarPublicPolicy.coverage`）。
 *
 * 为什么需要这条守卫：抽屉小月历遇到不认识的档位会**整行不收**（缺省不许默认成「未核验」）。
 * 那是安全的方向，但如果哪天有人给 `coverage` 新增一档、却没补消费侧的显式分支，
 * 抽屉里那些行会**悄悄消失**——没人会收到红色。这条守卫要求「新增档位」与「补齐消费点」同笔发生：
 * 加档位而不改消费侧 → 下面的闭集断言红；消费侧自己写死字面量而不走闭集 → 也红。
 */
const COVERAGE_CONSUMER = 'products/market-intelligence/desktop/pages/intelligence/useCalendarMonthReleases.ts'

describe('the coverage closed set', () => {
  it('is defined once, as the two levels the product actually has', () => {
    expect([...marketCalendarPublicPolicy.coverage]).toEqual(['available', 'observed-unverified'])
  })

  it('has every consumer read it from the policy instead of hardcoding levels', () => {
    const source = readFileSync(COVERAGE_CONSUMER, 'utf8')
    // 消费侧不许出现档位字面量：新增一档时它必须回到策略表，而不是继续只认两档。
    expect(source, 'consumer must not hardcode a coverage level').not.toMatch(/'observed-unverified'|'available'/)
    expect(source, 'consumer must read the closed set').toContain('marketCalendarPublicPolicy.coverage')
  })

  it('keeps the contract validator reading the same closed set', () => {
    const source = readFileSync('products/market-intelligence/contracts/macro/marketCalendarQueryContracts.ts', 'utf8')
    expect(source).toContain('marketCalendarPublicPolicy.coverage as readonly unknown[]')
  })
})
