import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Owner: apps/desktop-shell（**键盘焦点环只定义一次**）。
 *
 * 全仓历史上有几十处各写一份 `:focus-visible`，形状还不一致（1px/负 offset、2px/正 offset、
 * 只改背景色）。换一批控件就少一处，于是「键盘看不见焦点」反复出现。
 * 现在兜底在 `styles.css` 的一条零特异性全局规则上，组件需要更贴边的效果可以自己覆盖。
 *
 * 断言两件事：
 * 1. 那条全局规则存在，且用 token 与规范值（不是字面量颜色、不是随手一个尺寸）；
 * 2. **不许出现第二套「裸元素」焦点环**——再写一条 `button:focus-visible` 就是第二个默认值，
 *    两条会互相覆盖，没人知道哪条生效。组件自己的规则必须带类或属性前缀。
 */

const ROOT = process.cwd()
const GLOBAL_STYLES = 'apps/desktop-shell/src/renderer/src/styles.css'
const SKIP_DIRS = new Set(['node_modules', 'dist', 'out', 'build', 'coverage'])
const GLOBAL_SELECTOR =
  ":where(a[href], button, [role='button'], [role='tab'], [role='switch'], [tabindex]:not([tabindex='-1'])):focus-visible"

function collectStyleFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const absolute = join(dir, name)
    if (statSync(absolute).isDirectory()) {
      collectStyleFiles(absolute, out)
      continue
    }
    if (!name.endsWith('.css')) continue
    out.push(relative(ROOT, absolute).replace(/\\/g, '/'))
  }
  return out
}

const stylesheets = ['apps', 'products', 'platform'].flatMap((root) => collectStyleFiles(resolve(ROOT, root)))

/** 选择器不以类/属性前缀开头，直接命中原生元素。 */
function isGenericFocusSelector(line: string): boolean {
  const selector = line.trim()
  if (!selector.includes(':focus-visible')) return false
  if (selector.includes(':where(')) return false
  // 真正的「裸元素」是元素名紧跟 `:focus-visible` 或逗号（选择器组）；`button.foo` 属于带前缀的组件规则。
  return /^(a|button|input|select|textarea|summary)(:focus-visible|\s*,)/.test(selector)
}

describe('键盘焦点环只定义一次', () => {
  it('全局规则在 styles.css 里，零特异性，且用 token 与规范值', () => {
    const global = readFileSync(resolve(ROOT, GLOBAL_STYLES), 'utf8')

    expect(global).toContain(GLOBAL_SELECTOR)
    expect(global).toContain('outline: 2px solid var(--accent);')
    expect(global).toContain('outline-offset: 2px;')
  })

  it('没有第二套裸元素焦点环（组件的规则必须带类或属性前缀）', () => {
    const offenders = stylesheets
      .filter((file) => file !== GLOBAL_STYLES)
      .filter((file) => readFileSync(resolve(ROOT, file), 'utf8').split('\n').some(isGenericFocusSelector))

    expect(offenders).toEqual([])
  })
})
