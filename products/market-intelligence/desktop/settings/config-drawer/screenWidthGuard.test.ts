import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 宽度只由骨架定义一次，屏一律不写。双向判据：
 * 1. **屏的 CSS 里不许出现 `max-width`**（单列、分栏、表格都一样：前两类吃满、单列由骨架那条给）；
 * 2. **骨架里 `max-width: 840px` 只允许出现一次**——删掉它也是错（「没有任何上限」同样不对）。
 *
 * 反向用例都写在下面：塞一条屏内 max-width 必须红；骨架那条删了也必须红。
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

  it('counts the skeleton limit, and fails when it is gone', () => {
    expect(skeletonLimitCount('.config-drawer__single { max-width: 840px; }')).toBe(1)
    expect(skeletonLimitCount('.config-drawer__single { width: 100%; }')).toBe(0)
  })

  it('keeps every screen css free of max-width', () => {
    const offenders = SCREEN_CSS.flatMap((path) => {
      try { return screenWidthOffenders(readFileSync(join(process.cwd(), path), 'utf8'), path) } catch { return [] }
    })
    expect(offenders).toEqual([])
  })

  it('keeps exactly one 840 limit in the skeleton', () => {
    expect(skeletonLimitCount(readFileSync(join(process.cwd(), SKELETON), 'utf8'))).toBe(1)
  })

  it('does not let the drawer css pick up a second screen file', () => {
    // 抽屉目录里除骨架外的 css 都算「屏的 css」：扫一遍，避免新屏又自写一条。
    const files = readdirSync(join(process.cwd(), DRAWER)).filter((name) => name.endsWith('.css') && name !== 'configDrawer.css')
    const offenders = files.flatMap((name) => screenWidthOffenders(readFileSync(join(process.cwd(), DRAWER, name), 'utf8'), `${DRAWER}/${name}`))
    expect(offenders).toEqual([])
  })
})
