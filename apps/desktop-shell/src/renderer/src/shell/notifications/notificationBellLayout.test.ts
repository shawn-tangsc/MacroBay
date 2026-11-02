import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 这一块没有任何 jsdom 用例能覆盖：`overflow: hidden` 裁掉角标属于布局计算，jsdom 不算布局。
 * 所以守的是**规则本身**——锚点有没有被显式定高、角标的偏移是不是跟着行高变量走。
 *
 * 出过的事：`.topbar-actions` 是 flex 且没写 `align-items`，`.notification-bell` 因此被 stretch
 * 拉到 42px；角标的 `top: -3px` 相对的是那个被拉高的盒子，于是整颗落到顶栏上沿之外被裁掉。
 * 代码看着完全正确（`top:-3px` 没毛病），错的是它参照的盒子。
 */
const css = readFileSync(join(__dirname, '../../styles.css'), 'utf8')

/** 取一条规则块；选择器里的点需要转义，只取第一个匹配。 */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css.replace(/\n\s*/g, '\n'))
  if (match === null) throw new Error(`no rule for ${selector}`)
  return match[1]!
}

/** 顶栏行高的唯一来源；写死在别处的数值一律不认。 */
const rowHeight = Number(/--topbar-height:\s*(\d+)px/.exec(css)?.[1])
/** `IconButton` 的 `md` 档盒高（22/24 两档，这里只可能是 24）。 */
const ICON_BOX_PX = 24
/** 角标压住图标盒顶多少：设计给的 3px，是本例唯一允许的「目测值」。 */
const OVERLAP_PX = 3

describe('未读角标的锚点', () => {
  it('铃铛自己定高，不把盒高交给父级 flex 的 stretch', () => {
    const bell = rule('.notification-bell')

    // 不写 height 就等于把参照盒子交给 `.topbar-actions` 的默认值，而那正是这次被裁的原因。
    expect(bell).toMatch(/\bheight:\s*\S+/)
  })

  it('角标偏移跟着 --topbar-height 走，并且完整落在顶栏之内', () => {
    const top = /(?:^|\n)\s*top:\s*([^;]+);/.exec(rule('.notification-bell-badge'))?.[1]?.trim()
    expect(top).toBeDefined()

    // 不写死 42：顶栏一旦改高，写死的数字立刻错位；跟着 token 走才不会被下一个人改成"保险值"。
    expect(top).toContain('var(--topbar-height)')
    expect(top).toMatch(/-\s*24px/)
    expect(top).toMatch(/-\s*3px/)

    expect(Number.isFinite(rowHeight)).toBe(true)
    expect(rowHeight).toBeGreaterThan(ICON_BOX_PX)

    // 逐项算一遍，替不了浏览器，但能拦住"把 3 改成 30"这类会让角标再次出界的手。
    const badgeTop = (rowHeight - ICON_BOX_PX) / 2 - OVERLAP_PX
    const badgeHeight = Number(/height:\s*(\d+)px/.exec(rule('.notification-bell-badge'))?.[1])

    expect(badgeTop).toBeGreaterThanOrEqual(0)
    expect(badgeTop + badgeHeight).toBeLessThanOrEqual(rowHeight)
  })
})
