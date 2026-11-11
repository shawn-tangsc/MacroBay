import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 用户定：**所有屏吃满可用宽度，不设内容区上限**。
 *
 * 双向判据：
 * 1. **屏的 CSS 里不许出现 `max-width`**（谁都不许自己收窄）；
 * 2. **骨架里也不许再出现内容区上限**（原来的「840 恰好一处」改成「**0 处**」）——
 *    谁把上限加回来就红，避免「有人觉得太宽」再收一次。
 */
const DRAWER = 'products/market-intelligence/desktop/settings/config-drawer'
const SCREEN_CSS = [
  `${DRAWER}/briefingSettingsScreen.css`,
  `${DRAWER}/PlatformScreen.css`
]
const SKELETON = `${DRAWER}/configDrawer.css`

export function screenWidthOffenders(source: string, path: string): string[] {
  return source.split('\n').flatMap((line, index) => (/max-width\s*:/u.test(line) ? [`${path}:${index + 1} max-width`] : []))
}

export function skeletonLimitCount(source: string): number {
  return (source.match(/max-width:\s*840px/gu) ?? []).length
}

describe('one width rule, in the skeleton only', () => {
  it('flags a screen that writes its own max-width', () => {
    expect(screenWidthOffenders('.x { max-width: 720px; }', 'screens/briefing.css')).toEqual(['screens/briefing.css:1 max-width'])
  })

  it('counts the skeleton limit, so a re-added cap is visible', () => {
    expect(skeletonLimitCount('.config-drawer__single { max-width: 840px; }')).toBe(1)  // 夹具：只要出现就计数
    expect(skeletonLimitCount('.config-drawer__single { width: 100%; }')).toBe(0)
  })

  it('keeps every screen css free of max-width', () => {
    const offenders = SCREEN_CSS.flatMap((path) => {
      try { return screenWidthOffenders(readFileSync(join(process.cwd(), path), 'utf8'), path) } catch { return [] }
    })
    expect(offenders).toEqual([])
  })

  it('keeps no content-width limit in the skeleton at all', () => {
    // 0 处：所有屏吃满。谁加回上限，这条红。
    expect(skeletonLimitCount(readFileSync(join(process.cwd(), SKELETON), 'utf8'))).toBe(0)
  })

  it('does not let the drawer css pick up a second screen file', () => {
    // 抽屉目录里除骨架外的 css 都算「屏的 css」：扫一遍，避免新屏又自写一条。
    const files = readdirSync(join(process.cwd(), DRAWER)).filter((name) => name.endsWith('.css') && name !== 'configDrawer.css')
    const offenders = files.flatMap((name) => screenWidthOffenders(readFileSync(join(process.cwd(), DRAWER, name), 'utf8'), `${DRAWER}/${name}`))
    expect(offenders).toEqual([])
  })
})
