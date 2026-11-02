import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 气泡的四条上限（契约 §8 / 界面设计 2026-11-02）：**≤4 条、单条 ≤60 字、宽 ≤360、高 ≤320**。
 *
 * 为什么要有守门人：这四条原先只是文档口径。永续那张卡的 120 字长文塞进气泡、盖住半张图，
 * 就是在「上限写了、但没人挡」的状态下发生的。文档不挡人，组件和守卫才挡。
 *
 * 分两半，按**机械能否判定**切开，不假装都能自动验：
 *
 * - **能判的**：宽/高是组件常量（读源码），条数是调用点上的字面量数组（数元素）。这两半在这里红。
 * - **不能判的**：单条 ≤60 字。键 → 句子是运行时按语言解析出来的，源码里只有键；要机械化就得在
 *   DEV 渲染时抛错——那是今天刚在 `IconButton` 上否掉的形态（一个文案超长会让整块界面消失）。
 *   所以这一条留在评审口径里，由界面设计/架构师按句子判，本文件不假装守住了它。
 */

const ROOT = resolve(__dirname, '../../../..')
const COMPONENT = resolve(__dirname, 'Popover.tsx')
const DEBT_FILE = resolve(ROOT, 'scripts/migration-debt/popover-limits.json')
const SCANNED_ROOTS = ['apps', 'products']
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'out', 'coverage', '.git', 'build', 'release'])

/** 上限本身：宽由规格给，高由规格给。改这里必须同时改契约，否则两处说法会分叉。 */
const MAX_WIDTH_LIMIT = 360
const MAX_HEIGHT_LIMIT = 320
const MAX_LINE_ITEMS = 4

/** 从组件源码里读常量。读不到就抛——兜底静默降级会让这条红在别处无声失效。 */
export function componentCaps(source: string): { width: number; height: number } {
  const width = /const MAX_WIDTH = (\d+)/u.exec(source)?.[1]
  const height = /const MAX_HEIGHT = (\d+)/u.exec(source)?.[1]
  if (width === undefined || height === undefined) {
    throw new Error('Popover must declare MAX_WIDTH and MAX_HEIGHT; the guard reads them from source')
  }
  return { width: Number(width), height: Number(height) }
}

/**
 * 数一个 `lines={[ … ]}` 字面量里有几项。
 *
 * 按括号深度数顶层逗号：项本身是 `{ labelKey: … }` 对象，对象里的逗号不能算。
 * 返回 `null` 表示这份文件里的 `lines` 不是字面量数组（来自常量或 map），源码判不了条数。
 */
export function literalLineItems(source: string): number | null {
  const start = source.indexOf('lines={[')
  if (start === -1) return null
  let square = 0
  let brace = 0
  let items = 1
  for (let index = source.indexOf('[', start); index < source.length; index += 1) {
    const char = source[index]
    if (char === '[') square += 1
    else if (char === ']') {
      square -= 1
      if (square === 0) return items
    } else if (char === '{') brace += 1
    else if (char === '}') brace -= 1
    else if (char === ',' && square === 1 && brace === 0) items += 1
  }
  throw new Error('unterminated lines={[ … ]} literal')
}

function readDebt(): ReadonlySet<string> {
  if (!existsSync(DEBT_FILE)) {
    throw new Error(
      `popover limits list missing: ${DEBT_FILE}\n` +
        'It lives in scripts/migration-debt/ so a call site can strike its own line without touching the component directory.'
    )
  }
  const parsed = JSON.parse(readFileSync(DEBT_FILE, 'utf8')) as { entries?: Record<string, number> }
  if (parsed.entries === undefined) throw new Error(`${DEBT_FILE} has no "entries"`)
  return new Set(Object.keys(parsed.entries))
}

function sourceFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue
      found.push(...sourceFiles(join(dir, entry.name)))
      continue
    }
    if (!/\.tsx$/u.test(entry.name) || /\.test\.tsx$/u.test(entry.name)) continue
    found.push(join(dir, entry.name))
  }
  return found
}

const DEBT = readDebt()
/** 只看真的把 `Popover` 当组件用的文件（`<Popover`），不是提到这个名字的注释或 `AntPopover`。 */
const SITES = SCANNED_ROOTS.flatMap((root) => {
  try {
    return sourceFiles(join(ROOT, root))
  } catch {
    return []
  }
})
  .map((file) => ({ file, source: readFileSync(file, 'utf8') }))
  .filter((entry) => /<Popover\b/u.test(entry.source))
  .map((entry) => ({ file: relative(ROOT, entry.file).replace(/\\/gu, '/'), overCap: literalLineItems(entry.source) }))
  .filter((entry): entry is { file: string; overCap: number } => entry.overCap !== null && entry.overCap > MAX_LINE_ITEMS)

describe('Popover limits', () => {
  it('keeps the bubble inside the contract box: at most 360 wide and 320 tall', () => {
    const caps = componentCaps(readFileSync(COMPONENT, 'utf8'))
    expect(caps.width).toBeLessThanOrEqual(MAX_WIDTH_LIMIT)
    expect(caps.height).toBe(MAX_HEIGHT_LIMIT)
    // 上限必须真的写在内容元素上，否则常量只是个数字。
    const source = readFileSync(COMPONENT, 'utf8')
    expect(source).toContain('maxWidth: MAX_WIDTH')
    expect(source).toContain('maxHeight: MAX_HEIGHT')
  })

  it('keeps every literal lines array at four items or fewer, and nothing else', () => {
    expect(SITES.filter((entry) => !DEBT.has(entry.file)).map((entry) => `${entry.file} ×${entry.overCap}`)).toEqual([])
  })

  it('shrinks the list: a site folded back to four items must have its line deleted', () => {
    const stale = [...DEBT].filter((file) => {
      const site = SITES.find((entry) => entry.file === file)
      return site === undefined || site.overCap <= MAX_LINE_ITEMS
    })
    expect(stale).toEqual([])
  })

  it('reads the caps and the item count from real shapes, so neither check can pass vacuously', () => {
    // 改一处就红：宽度超限、高度改小、条数多一条。
    expect(() => componentCaps('const MAX_WIDTH = 400\nconst MAX_HEIGHT = 320')).not.toThrow()
    expect(componentCaps('const MAX_WIDTH = 400\nconst MAX_HEIGHT = 320').width).toBeGreaterThan(MAX_WIDTH_LIMIT)
    expect(() => componentCaps('const MAX_WIDTH = 360')).toThrow(/MAX_WIDTH and MAX_HEIGHT/)
    expect(literalLineItems("<Popover lines={[{ labelKey: 'a' }, { labelKey: 'b' }]} />")).toBe(2)
    expect(literalLineItems("<Popover lines={[{ labelKey: 'a', params: { x: '1' } }]} />")).toBe(1)
    expect(literalLineItems('<Popover lines={keys.map((labelKey) => ({ labelKey }))} />')).toBeNull()
    expect(literalLineItems("<Popover lines={[{ labelKey: 'a' }, { labelKey: 'b' }, { labelKey: 'c' }, { labelKey: 'd' }, { labelKey: 'e' }]} />")).toBe(5)
  })
})
