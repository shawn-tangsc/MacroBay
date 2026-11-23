import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 通知中心顶部那句动作回执要黏在抽屉正文顶边。
 *
 * 病（用户 2026-11-24 报的同一个缺陷的下半截）：抽屉正文是滚动容器，读者滚到列表下面点
 * 「看原文」，失败提示渲染在列表上方——屏幕外，症状和「点了没反应」一样。
 *
 * 行为证据是**无头 Chrome 里量出来的**（真 styles.css + drawer.css，滚动 260 与 900 后
 * 提示条 `rect.top = 0`、仍在视口、空隙带上命中的是提示条自己）。这里守的是**两个数字的耦合**，
 * 因为它们分处两个文件，改一边另一边不会红：
 *
 * ① 黏顶偏移必须与负上边距同值。sticky 的偏移作用在**外边距盒**上，而上边距是负的：
 *    只写 `top: 0` 会让边框盒反而下移一个内边距（实测 rect.top 16），滚过的行正好从那条缝
 *    里穿过去。两个 `calc(-1 * var(--notice-bleed))` 缺一个，提示条就"黏了个寂寞"。
 * ② `--notice-bleed` 必须等于抽屉正文自己的内边距，否则盖不住那条带、或者多盖进内容区。
 *
 * 这是防漂移守卫，不是布局红证：布局只认无头量下来的数。
 */
const styles = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/styles.css'), 'utf8')
const drawerCss = readFileSync(resolve(process.cwd(), 'platform/ui/components/drawer/drawer.css'), 'utf8')

function noticeBlock(): string {
  return /\.notification-center-notice\s*\{([^}]*)\}/.exec(styles)?.[1] ?? ''
}

describe('通知中心的动作回执黏在抽屉正文顶边', () => {
  it('是黏顶的，且底色走 token，不许写死颜色', () => {
    const block = noticeBlock()
    expect(block).toContain('position: sticky')
    expect(block).toMatch(/background:\s*var\(--surface-strong\)/)
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/)
  })

  it('黏顶偏移与负上边距同值——缺一个，边框盒就被外边距盒顶下去一个内边距', () => {
    const block = noticeBlock()
    expect(block).toContain('top: calc(-1 * var(--notice-bleed))')
    expect(block).toContain('margin: calc(-1 * var(--notice-bleed)) 0 0')
  })

  it('盖住的那条带宽度就是抽屉正文自己的内边距', () => {
    const bleed = /--notice-bleed:\s*(\d+)px/.exec(noticeBlock())?.[1]
    const bodyPadding = /\.drawer__panel--default\s+\.ant-drawer-body\s*\{\s*padding:\s*(\d+)px/.exec(drawerCss)?.[1]

    expect(bleed).toBeDefined()
    expect(bodyPadding).toBeDefined()
    expect(bleed).toBe(bodyPadding)
  })
})
