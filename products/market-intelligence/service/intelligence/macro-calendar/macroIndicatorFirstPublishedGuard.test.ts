import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 「较上期」的读数路径**不许读 `mi_macro_calendar_first_published`**。
 *
 * 那张表里只允许有「采集第一次看到这一期时」记下的数；它的本意是防修订值冒充首发布值。
 * 非农那次的 29 来自**旧源发布当时的观测**（`provider_previous`），不从这张表来。
 * 将来若有人「顺手」把读数改成读它，卡片会静默退化成「无法确认首发布值」——
 * 表面上不报错，读者只是突然看不到较上期，这类退化最难被发现。
 */
describe('较上期的读数路径', () => {
  it('不读首发布快照表', () => {
    for (const file of ['./macroIndicatorReadService.ts', './macroIndicatorCardFacts.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(source, file).not.toContain('first_published')
      expect(source, file).not.toContain('readFirstPublished')
      expect(source, file).not.toContain('firstPublished')
    }
  })
})
