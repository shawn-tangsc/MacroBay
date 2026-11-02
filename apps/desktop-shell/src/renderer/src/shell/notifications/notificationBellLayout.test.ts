import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 这一块没有 jsdom 用例能覆盖：`overflow: hidden` 裁掉角标属于布局计算，jsdom 不算布局。
 * 所以守的是**规则本身**——锚点有没有等于它定位的那个盒子，角标有没有落在行内。
 *
 * 出过的事：`.topbar-actions` 是 flex 且没写 `align-items`，`.notification-bell` 因此被 stretch
 * 到 42px；角标的 `top: -3px` 相对的是那个被拉高的盒子，于是整颗落到顶栏上沿之外被裁掉。
 * 代码看着完全正确（`top:-3px` 没毛病），错的是它参照的盒子。
 */
const css = readFileSync(join(__dirname, '../../styles.css'), 'utf8')

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)
  if (match === null) throw new Error(`no rule for ${selector}`)
  return match[1]!
}

const rowHeight = Number(/--topbar-height:\s*(\d+)px/.exec(css)?.[1])
/** `IconButton` 的 `md` 档盒高：铃铛图标就被包在这个盒子里。 */
const ICON_BOX_PX = 24
/** 角标压住图标盒顶多少（设计给的数）。 */
const OVERLAP_PX = 3

describe('未读角标的锚点', () => {
  it('锚点高度等于图标盒，而不是跟着父级 stretch', () => {
    const bell = rule('.notification-bell')
    const height = /(?:^|\n)\s*height:\s*(\d+)px;/.exec(bell)?.[1]

    // `height: 100%` 或干脆不写，都会让盒高回到父级的默认值（42），角标就又出界。
    expect(Number(height)).toBe(ICON_BOX_PX)
    expect(bell).toMatch(/align-self:\s*center/)
  })

  it('角标相对图标盒偏移，并且完整落在顶栏之内', () => {
    const top = /(?:^|\n)\s*top:\s*(-?\d+)px;/.exec(rule('.notification-bell-badge'))?.[1]
    expect(top).toBeDefined()

    expect(Number.isFinite(rowHeight)).toBe(true)
    // 图标盒在行内居中：盒顶 = (行高 - 盒高) / 2；角标再往上压 OVERLAP。
    const badgeTop = (rowHeight - ICON_BOX_PX) / 2 - Math.abs(Number(top))
    const badgeHeight = Number(/height:\s*(\d+)px;/.exec(rule('.notification-bell-badge'))?.[1])

    expect(badgeTop).toBeGreaterThanOrEqual(0)
    expect(badgeTop + badgeHeight).toBeLessThanOrEqual(rowHeight)
  })
})
