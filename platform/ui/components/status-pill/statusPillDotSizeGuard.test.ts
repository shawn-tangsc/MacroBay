import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 状态点的尺寸只能有一个来源。
 *
 * 五档两两形状不同（实心圆／空心环／方块／横条／小圆点）是**第二通道**，而它有个隐藏前提：
 * 尺寸够大。5px 上 1.5px 描边的空心环内孔只剩 2px，灰度里读起来与实心圆一样——那个尺寸上的
 * 形状编码是装饰冒充编码。今天浅色下 `ok`/`info` 分不清，就是这么被发现的。
 *
 * 于是尺寸收成 `statusPill.css` 里 `.status-pill` 上的自定义属性，形状规则只引用变量。
 * 这条守卫管两件事，缺一不可：
 *
 * 1. **组件自己不许写死**：形状规则里出现裸的 `width: 6px` 就红，否则「一个常量」只是一句话。
 * 2. **页面不许在别处重定义**：产品线为了紧凑，最省事的做法是在自己样式表里补一条
 *    `.status-pill__dot { width: 4px }`——形状编码当场退回第一通道，而界面上看不出错。
 *    这类覆盖一律红。
 */

const ROOT = resolve(__dirname, '../../../..')
const COMPONENT_CSS = resolve(__dirname, 'statusPill.css')
const SCANNED_ROOTS = ['apps', 'products']
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'out', 'coverage', '.git', 'build', 'release'])

/** 尺寸变量的名字：新增一档点形状时在这里加，别在规则里写数字。 */
const SIZE_VARIABLES = [
  '--pill-dot-size',
  '--pill-dot-small',
  '--pill-dot-bar-width',
  '--pill-dot-bar-height',
  '--pill-dot-stroke'
] as const

/** 去掉注释：本仓库的注释很长，且里面会写「5px」这种例子。 */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//gu, '')
}

/** 取某个选择器的声明块。 */
function block(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const match = withoutComments(css).match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'mu'))
  return match?.[1] ?? ''
}

function cssFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue
      found.push(...cssFiles(join(dir, entry.name)))
      continue
    }
    if (/\.css$/u.test(entry.name)) found.push(join(dir, entry.name))
  }
  return found
}

const COMPONENT_RULES = withoutComments(readFileSync(COMPONENT_CSS, 'utf8'))

describe('status pill dot size', () => {
  it('declares every dot size once, on the pill itself', () => {
    const root = block(COMPONENT_RULES, '.status-pill')
    for (const name of SIZE_VARIABLES) {
      expect(root, `${name} must be declared on .status-pill`).toContain(name)
    }
    // 声明只许有一处：出现两次就等于有人在中途改了某个形状的尺寸。
    for (const name of SIZE_VARIABLES) {
      const declarations = COMPONENT_RULES.match(new RegExp(`${name}\\s*:`, 'gu')) ?? []
      expect(declarations, `${name} must be declared exactly once`).toHaveLength(1)
    }
  })

  it('never writes a raw size inside a dot shape rule', () => {
    // 形状规则只许引用变量：`width: 6px` 这类裸数字出现在这里，常量就被绕开了。
    for (const shape of ['circle', 'ring', 'square', 'bar', 'small']) {
      const rule = block(COMPONENT_RULES, `.status-pill__dot[data-dot-shape='${shape}']`)
      expect(rule, `shape ${shape} must exist`).not.toBe('')
      expect(rule, `shape ${shape} hardcodes a width`).not.toMatch(/(^|;|\s)width:\s*\d/u)
      expect(rule, `shape ${shape} hardcodes a height`).not.toMatch(/(^|;|\s)height:\s*\d/u)
    }
    // 空心环的描边同理：1.5px 也得走变量，否则「点尺寸」只收了一半。
    const ring = block(COMPONENT_RULES, ".status-pill__dot[data-dot-shape='ring']")
    expect(ring).toContain('border: var(--pill-dot-stroke) solid var(--pill-tone)')
  })

  it('rejects a page that resizes the dot in its own stylesheet', () => {
    const offenders: string[] = []
    for (const root of SCANNED_ROOTS) {
      let files: string[] = []
      try {
        files = cssFiles(join(ROOT, root))
      } catch {
        continue
      }
      for (const file of files) {
        const rules = withoutComments(readFileSync(file, 'utf8'))
        // 只看「作用到状态点」的规则：选择器里带 `.status-pill__dot` 且改尺寸/重定义变量。
        for (const match of rules.matchAll(/([^{}]*\.status-pill__dot[^{}]*)\{([^}]*)\}/gu)) {
          const [, selector, body] = match
          if (/(^|;|\s)(width|height):\s*\d/u.test(body ?? '') || (body ?? '').includes('--pill-dot')) {
            offenders.push(`${relative(ROOT, file)} :: ${(selector ?? '').trim()}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('catches both shapes, so neither half passes vacuously', () => {
    // 反向实测：写死的尺寸与被页面重定义的点，都必须被判出来。
    expect(/(^|;|\s)width:\s*\d/u.test('width: 6px;')).toBe(true)
    expect(/(^|;|\s)width:\s*\d/u.test('width: var(--pill-dot-size);')).toBe(false)
    expect(/([^{}]*\.status-pill__dot[^{}]*)\{([^}]*)\}/u.test('.mi-card .status-pill__dot { width: 4px }')).toBe(true)
  })
})
