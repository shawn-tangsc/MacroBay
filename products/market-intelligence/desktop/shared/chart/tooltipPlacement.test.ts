import { describe, expect, it } from 'vitest'

import { tooltipLeft } from './tooltipPlacement'

/**
 * 翻转规则（界面设计 2026-11-24 的尺子）：
 * `W − x ≥ FIT` → 右侧 `x + offset`；否则 `x ≥ FIT` → 左侧 `x − FLIP`；两边都放不下才兜底并夹进
 * `[inset, W − SPAN]`。FIT = offset + width + inset、FLIP = offset + width、SPAN = width + inset。
 *
 * 228 = 12 + 210 + 6，不是 222：按 222 判会在剩余 223–228 那段把浮层摆出框外 6px，
 * 正是跨资产图那笔修掉的「最后几个像素被裁」。
 */
const UST = { width: 210, offset: 12, inset: 6 } as const
/** 另一组参数（资金面那档的量级）：证明 210/12/6 只是入参，不是规则的一部分。 */
const OTHER = { width: 214, offset: 14, inset: 4 } as const
/** 更窄的一档：同样能翻、能兜底。 */
const NARROW = { width: 160, offset: 8, inset: 4 } as const

const place = (x: number, boxWidth: number, style: Readonly<{ width: number; offset: number; inset: number }> = UST): number =>
  tooltipLeft({ x, boxWidth, ...style })

describe('浮层横向位置', () => {
  const BOX = 800

  it('光标在左半边：留在右侧，与光标留 offset 的间距', () => {
    expect(place(300, BOX)).toBe(312)
  })

  it('最右一列：翻到光标左边，右缘不越界，也不压住被读的那一列', () => {
    const left = place(700, BOX)
    expect(left).toBe(478)
    expect(left + UST.width + UST.inset).toBeLessThanOrEqual(BOX - UST.inset)
    expect(left).toBeLessThanOrEqual(700 - UST.offset)
  })

  it('阈值含等号：W − x = FIT 仍放右侧，少 1 才翻到左侧', () => {
    // 右侧那一点：left = W − SPAN，右边缘正好 W − inset。
    expect(place(BOX - 228, BOX)).toBe(BOX - 228 + 12)
    expect(place(BOX - 228, BOX) + UST.width).toBe(BOX - UST.inset)
    expect(place(BOX - 227, BOX)).toBe(BOX - 227 - 222)
  })

  it('左侧那条边的边界：x = FIT 时左边缘正好贴 inset；右侧放得下时右侧优先', () => {
    // W=400、x=228：右余 172 放不下，左侧候选正好 228 − 222 = 6，不再夹。
    expect(place(228, 400)).toBe(6)
    // 同一对坐标放进 800 宽的框里，右侧放得下（800 − 228 = 572 ≥ 228），所以仍是右侧：
    // 「右侧优先」这件事也钉住，免得下一个人把两条条件写反。
    expect(place(228, 800)).toBe(240)
  })

  it('两边都放不下时兜底：先取更宽的一侧，再夹进 [inset, W − SPAN]', () => {
    // W=400、光标在中部：两侧剩余各 200（并列取右侧），212 夹到上限 184。
    expect(place(200, 400)).toBe(184)
    // 光标略偏左：右侧更宽，187 夹到上限 184。
    expect(place(175, 400)).toBe(184)
    // 光标略偏右：左侧更宽，3 夹到下限 6。
    expect(place(225, 400)).toBe(6)
    // 紧贴左侧边界：x=227 两边都不够（右余 173、左 227），候选 227 − 222 = 5 夹到 6。
    expect(place(227, 400)).toBe(6)
  })

  it('换一组参数照样成立：阈值与翻边点都从 width / offset / inset 算出来', () => {
    // FIT = 14 + 214 + 4 = 232：800 − 700 = 100 放不下，x=700 ≥ 232 → 700 − 228 = 472。
    expect(place(700, 800, OTHER)).toBe(472)
    expect(place(700, 800, OTHER) + OTHER.width).toBeLessThanOrEqual(800 - OTHER.inset)
    // 阈值含等号那一格：800 − 568 = 232 → left = 568 + 14，右缘正好 796 = W − 4。
    expect(place(800 - 232, 800, OTHER)).toBe(800 - 232 + 14)
    expect(place(800 - 232, 800, OTHER) + OTHER.width).toBe(800 - OTHER.inset)
    expect(place(800 - 231, 800, OTHER)).toBe(800 - 231 - 228)
    // 窄牌：FIT = 8 + 160 + 4 = 172；右余 100 放不下 → 500 − 168 = 332。
    expect(place(500, 600, NARROW)).toBe(332)
  })

  it('任何输入下 left ≥ inset，且框够宽时右边缘不越界', () => {
    for (const style of [UST, OTHER, NARROW]) {
      const span = style.width + style.inset
      for (const boxWidth of [span + style.inset, 240, 300, 400, 456, 464, 600, 800, 1000]) {
        for (let x = 0; x <= boxWidth; x += 7) {
          const left = place(x, boxWidth, style)
          const at = `w=${style.width} W=${boxWidth} x=${x}`
          expect(left, at).toBeGreaterThanOrEqual(style.inset)
          // 兜底夹位保证右缘不越界；框再窄下去也只剩「允许压住光标」这一条。
          if (boxWidth >= span + style.inset) {
            expect(left + style.width, at).toBeLessThanOrEqual(boxWidth - style.inset)
          }
        }
      }
    }
  })
})
