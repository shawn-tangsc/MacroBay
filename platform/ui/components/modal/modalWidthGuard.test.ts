import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 弹窗宽度的档位守卫：**产品与壳层的 CSS 不许给 `.ant-modal` 写 `width`**。
 *
 * 为什么值得守：宽度是闭集（`compact` 420 / `standard` 520 / `expanded` 720 / `maximum` 860 /
 * `full` 1280），`full` 出现之前宽表塞不下，于是有人用
 * `.ant-modal.mi-catalog-dialog { width: min(1400px, 92vw) !important }` 从 CSS 里把弹窗撑宽——
 * 档位契约被绕开，而且那条覆盖在 1280 窗口下（92vw＝1178）比 `full`（实得 1248）还**窄** 70px。
 * 写在文档里没人拦得住下一次，所以写成守卫。
 *
 * 只挡「给弹窗盒子写 `width`」这一件事：
 * - `max-width` 用主题 token **不算**——它只能把弹窗收窄，永远不能把档位放宽；
 * - `.ant-modal-content` / `.ant-modal-body` 上的宽度**不算**——那不是弹窗盒子，改的是内容；
 * - `.ant-modal .table { width: 100% }` 这类后代选择器**不算**——宽度落在后代身上。
 *
 * 已知例外记在 `scripts/migration-debt/modal-width.json`（只减不增，两个方向都红）。
 */

const ROOT = resolve(__dirname, '../../../..')
const SCANNED_ROOTS = ['apps', 'products']
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'out', 'coverage', '.git', 'build', 'release', 'release-notes'])

const DEBT_FILE = resolve(ROOT, 'scripts/migration-debt/modal-width.json')

/** 读不到就抛，不吞：静默降级会让这条红在快照/CI 里无声失效。 */
function readDebt(): ReadonlyMap<string, number> {
  const parsed = JSON.parse(readFileSync(DEBT_FILE, 'utf8')) as { entries?: Record<string, number> }
  if (parsed.entries === undefined) throw new Error(`${DEBT_FILE} has no "entries"`)
  return new Map(Object.entries(parsed.entries))
}

type CssRule = { selector: string; body: string }

function matchingBrace(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function collectRules(text: string, start: number, end: number, out: CssRule[]): void {
  let index = start
  let preludeStart = start
  while (index < end) {
    const char = text[index]
    if (char === '{') {
      const prelude = text.slice(preludeStart, index).trim()
      const close = matchingBrace(text, index)
      if (close === -1 || close > end) return
      if (prelude.startsWith('@')) {
        // `@media` / `@supports` / `@container` / `@keyframes` 内部继续找规则。
        collectRules(text, index + 1, close, out)
      } else {
        out.push({ selector: prelude, body: text.slice(index + 1, close) })
      }
      index = close + 1
      preludeStart = index
      continue
    }
    if (char === '}') preludeStart = index + 1
    index += 1
  }
}

/** 注释先剥掉：注释里的 `.ant-modal { width }` 是说明，不是规则。 */
export function cssRules(css: string): CssRule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: CssRule[] = []
  collectRules(text, 0, text.length, rules)
  return rules
}

/** 选择器里最后一个复合选择器——`width` 落在它命中的元素上。 */
function lastCompound(selector: string): string {
  const parts = selector.trim().split(/[\s>+~]+/)
  return parts[parts.length - 1] ?? ''
}

/** 只认本层声明：嵌套块（`&:hover { … }`）里的宽度不算这条规则的。 */
function declaresWidth(body: string): boolean {
  const own = body.split('{')[0] ?? ''
  return own.split(';').some((declaration) => /^\s*width\s*:/.test(declaration))
}

/**
 * 返回这个 CSS 文本里「给弹窗盒子写 `width`」的规则选择器。
 *
 * 一个多选择器规则只算一处：`.a, .ant-modal { width }` 是同一处宽度，不是两处。
 */
export function modalWidthOverrides(css: string): string[] {
  const hits: string[] = []
  for (const rule of cssRules(css)) {
    const targets = rule.selector
      .split(',')
      .map((part) => part.trim())
      .filter((part) => /\.ant-modal(?![\w-])/.test(lastCompound(part)))
    if (targets.length === 0) continue
    if (!declaresWidth(rule.body)) continue
    hits.push(targets.join(', '))
  }
  return hits
}

function cssFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue
      found.push(...cssFiles(join(dir, entry.name)))
      continue
    }
    if (entry.name.endsWith('.css')) found.push(join(dir, entry.name))
  }
  return found
}

function relativeToRoot(file: string): string {
  return relative(ROOT, file).replace(/\\/g, '/')
}

const DEBT = readDebt()

const OBSERVED = new Map<string, string[]>()
for (const root of SCANNED_ROOTS) {
  const files = (() => {
    try {
      return cssFiles(join(ROOT, root))
    } catch {
      return []
    }
  })()
  for (const file of files) {
    const hits = modalWidthOverrides(readFileSync(file, 'utf8'))
    if (hits.length > 0) OBSERVED.set(relativeToRoot(file), hits)
  }
}

describe('Modal 宽度档位', () => {
  it('keeps every .ant-modal width on the shrinking list, and nothing else', () => {
    const offenders = [...OBSERVED].flatMap(([file, hits]) => {
      const allowed = DEBT.get(file) ?? 0
      if (hits.length <= allowed) return []
      return [`${file} ×${hits.length}（清单 ${allowed}）：${hits.join(' / ')}`]
    })
    // 宽表用 `full`（1280，1280 窗口下实得 1248）+ 内容自己的横向滚动；从 CSS 撑宽就绕开了档位。
    expect(offenders, '产品/壳层 CSS 给 `.ant-modal` 写了 width：档位是闭集，宽度只能在 Modal.tsx 的表里').toEqual([])
  })

  it('shrinks the list: a removed override must have its line deleted too', () => {
    const stale = [...DEBT].flatMap(([file, allowed]) => {
      const actual = OBSERVED.get(file)?.length ?? 0
      return actual < allowed ? [`${file}：清单 ${allowed}，实际 ${actual}——覆盖已经删掉，同笔删掉这一行`] : []
    })
    // 只减不增的另一半：豁免被还清了还留着，就是一个永远不会被发现的洞。
    expect(stale, '这份清单里有条目已经过期：删掉覆盖的那笔提交里把对应行一起删掉').toEqual([])
  })

  it('catches each shape, so the guard cannot pass vacuously', () => {
    // ① 真正要挡的形状：产品侧把弹窗撑宽（今天那条就是这样）。
    expect(modalWidthOverrides('.ant-modal.mi-catalog-dialog { width: min(1400px, 92vw) !important; max-width: 92vw; }'))
      .toEqual(['.ant-modal.mi-catalog-dialog'])
    // ② 只收窄不算：max-width 用主题 token 是允许的。
    expect(modalWidthOverrides('.mi-dialog.ant-modal { max-width: var(--mi-dialog-width); }')).toEqual([])
    expect(modalWidthOverrides('.ant-modal { min-width: 320px; }')).toEqual([])
    // ③ 后代与内容节点不算：宽度不落在弹窗盒子上。
    expect(modalWidthOverrides('.ant-modal .mi-table { width: 100%; }')).toEqual([])
    expect(modalWidthOverrides('.ant-modal-content { width: 100%; }')).toEqual([])
    expect(modalWidthOverrides('.ant-modal-body { width: 720px; }')).toEqual([])
    // ④ 注释里的示例不是规则。
    expect(modalWidthOverrides('/* .ant-modal { width: 1400px } */')).toEqual([])
    expect(modalWidthOverrides('.ant-modal { padding: 8px; }')).toEqual([])
    // ⑤ 套在 @media 里照样抓；多选择器只算一处。
    expect(modalWidthOverrides('@media (min-width: 1200px) { .ant-modal { width: 1400px; } }')).toEqual(['.ant-modal'])
    expect(modalWidthOverrides('.x, .ant-modal { width: 900px; }')).toEqual(['.ant-modal'])
    // ⑥ 嵌套块里的宽度不冒充本规则的宽度。
    expect(modalWidthOverrides('.ant-modal { &:hover { width: 10px; } }')).toEqual([])
  })
})