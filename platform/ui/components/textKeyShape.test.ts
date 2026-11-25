import { describe, expect, it } from 'vitest'

import { expandSameFileConstants, judgeTextKey, looksLikeTextKey } from './textKeyShape'

/**
 * 「键形状」判据的**先展开、再判**（2026-11-22 修的真假阳性）。
 *
 * 现场：`SentimentOptionsCard.tsx` 第 19 行 `const TEXT_PREFIX = 'pages.intelligence.portal.dashboard.defensivePremium'`，
 * 五个调用点写 `${TEXT_PREFIX}.stale.pill` 这种模板键。守卫正则抓到的是一整个模板体，`looksLikeTextKey`
 * 见到 `${` 判不合格——但 `textKeyShape` 的口径本来就写着「**不判「是不是字面量」**，正则看不进变量」，
 * 所以这是守卫的假阳性，不是调用点的问题。
 *
 * 判据分三档：展开后合格（pass）、展开后是句子（reject）、展开不了（skip，与传变量同级）。
 * **不许偷懒成「含 `${` 就放行」**——第二条用例就是钉这个：展开后是句子时必须仍然红。
 */
const SOURCE = [
  "const TEXT_PREFIX = 'pages.intelligence.portal.dashboard.defensivePremium'",
  "const OTHER_PREFIX = 'pages.intelligence.portal.dashboard.other' as const"
].join('\n')

describe('先展开同文件字符串常量，再判键形状', () => {
  it('passes a template key whose prefix is a same-file string constant', () => {
    expect(judgeTextKey(SOURCE, '${TEXT_PREFIX}.stale.pill')).toBe('pass')
    expect(judgeTextKey(SOURCE, '${OTHER_PREFIX}.titleInfo')).toBe('pass')
    // 展开的结果也要能直接看：不是把整段模板当成一句放过去。
    expect(expandSameFileConstants(SOURCE, '${TEXT_PREFIX}.stale.pill'))
      .toBe('pages.intelligence.portal.dashboard.defensivePremium.stale.pill')
  })

  it('still rejects a sentence that was only reachable through expansion', () => {
    // 「含 `${` 就放行」会在这里绿——那等于放行任何人拼一句话进来。
    expect(judgeTextKey(SOURCE, '${TEXT_PREFIX}.这是一句话')).toBe('reject')
    expect(judgeTextKey(SOURCE, '${TEXT_PREFIX}.has space')).toBe('reject')
  })

  it('skips what it cannot expand, exactly like a variable argument', () => {
    // 前缀没声明。
    expect(judgeTextKey(SOURCE, '${UNDECLARED}.stale.pill')).toBe('skip')
    // 声明了但不是字符串常量。
    expect(judgeTextKey('const PREFIX = 42', '${PREFIX}.stale.pill')).toBe('skip')
    // 模板里还有别的表达式（成员访问、函数调用）。
    expect(judgeTextKey(SOURCE, '${config.prefix}.stale.pill')).toBe('skip')
    expect(judgeTextKey(SOURCE, '${prefix()}.stale.pill')).toBe('skip')
    // 常量本身又是模板。
    expect(judgeTextKey("const PREFIX = `${base}.x`", '${PREFIX}.stale.pill')).toBe('skip')
  })

  it('leaves the existing shape rules exactly as they were', () => {
    expect(looksLikeTextKey('pages.intelligence.portal.dashboard.defensivePremium.stale.pill')).toBe(true)
    expect(looksLikeTextKey('先检查来源，再重新采集')).toBe(false)
    expect(looksLikeTextKey('pages.intelligence.来源')).toBe(false)
    // 转义换行仍是「一句话被折成两行」：反斜杠不在允许字符里，继续判不合格。
    expect(judgeTextKey('', 'pages.intelligence.help.first\\nsecond')).toBe('reject')
  })
})
