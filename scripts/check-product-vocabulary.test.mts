import { describe, expect, it } from 'vitest'

import { compareWithBaseline, isProductVocabulary } from './check-product-vocabulary.mts'

/**
 * 两个方向都要红：
 * - **新增**：有人把产品概念又写进平台侧 —— 这是这条规则要防的全部；
 * - **过期**：清单里的文件已经清干净却没删掉 —— 不清就变成「只增不减」的假账，
 *   和文件体积基线一个道理。
 */

describe('产品词守卫', () => {
  it('认得产品概念：事件 id、产品包名、模块名、资产缩写', () => {
    expect(isProductVocabulary("import { x } from '@products/market-intelligence/product.manifest'")).toBe(true)
    expect(isProductVocabulary("eventTypeId: 'market-intelligence.briefing.failed'")).toBe(true)
    expect(isProductVocabulary("moduleId: 'OI'")).toBe(true)
    expect(isProductVocabulary("const asset = 'ETF'")).toBe(true)
  })

  it('不误伤通用词：platform 前缀、普通英文、缩写只在独立成词时算', () => {
    expect(isProductVocabulary("eventTypeId: 'platform.job.failed-terminal'")).toBe(false)
    expect(isProductVocabulary('const taskName = user name value')).toBe(false)
    // `VOID` / `OFFER` 里的 OI / ET 不该被当成资产缩写。
    expect(isProductVocabulary('const VOIDED = OFFERING')).toBe(false)
  })

  it('新增命中即红', () => {
    expect(compareWithBaseline(['platform/a.ts', 'platform/b.ts'], ['platform/a.ts'])).toEqual({
      added: ['platform/b.ts'],
      stale: []
    })
  })

  it('清干净却没删清单也要红', () => {
    expect(compareWithBaseline(['platform/a.ts'], ['platform/a.ts', 'platform/c.ts'])).toEqual({
      added: [],
      stale: ['platform/c.ts']
    })
  })
})
