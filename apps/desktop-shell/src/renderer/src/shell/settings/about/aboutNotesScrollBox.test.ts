import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 说明块「固定高度 + 块内滚动」的样式契约。
 *
 * 为什么要有这份测试：这条已经翻车过一次——组件里 `className="about-notes-scroller"` 写好了、
 * `tabIndex`/`role` 也写好了、提交说明也写着「块高 `min(360px, 46vh)`」，**但 styles.css 里
 * 一条规则都没有**。结果是：页面看得见正文，框却不存在，正文照样把整页撑长。
 * jsdom 不跑布局，任何渲染测试都发现不了「类名有、规则没有」，只有对着样式文件查才查得出。
 *
 * 所以这里断言的是**契约**（有这几个声明），不是具体像素长相：
 * - 块高封顶 360，矮窗按 46vh 收（保证下面的链接块仍在首屏）；
 * - 块内滚（`overflow-y: auto`），到底继续滚带动外层页面（`overscroll-behavior-y: auto`）；
 * - 渐隐遮罩**不吃点击**（`pointer-events: none`），并且贴在滚动区上（viewport 是定位父级）。
 */
describe('about notes scroll box', () => {
  it('caps the box height and shortens it on short windows', () => {
    const scroller = cssRule('.about-notes-scroller')
    expect(scroller).toContain('max-height: min(360px, 46vh)')
  })

  it('scrolls inside the box and hands the wheel back to the page at the end', () => {
    const scroller = cssRule('.about-notes-scroller')
    expect(scroller).toContain('overflow-y: auto')
    // 到底卡住的话，读者滚不到下面的链接块——`auto` 才是「到底继续带着页面走」。
    expect(scroller).toContain('overscroll-behavior-y: auto')
  })

  it('puts the fade over the scroll box without eating clicks', () => {
    expect(cssRule('.about-notes-viewport')).toContain('position: relative')
    const fade = cssRule('.about-notes-fade')
    expect(fade).toContain('position: absolute')
    expect(fade).toContain('pointer-events: none')
  })
})

function cssRule(selector: string): string {
  const css = readFileSync(resolve(process.cwd(), 'apps/desktop-shell/src/renderer/src/styles.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(',').map((entry) => entry.trim())
    if (selectors.includes(selector)) return match[2]
  }
  throw new Error(`Missing CSS rule for ${selector}`)
}
