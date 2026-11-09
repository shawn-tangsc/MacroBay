/**
 * 样式声明的读取：给样式门禁共用的一小段，不重复实现。
 *
 * 两个「读样式」的门禁（字重、字号字面量）共用三件事：走一遍源码目录拿到文件、把 CSS 里某个
 * 属性**真实声明值**取出来、把 TSX 里内联的同一个属性取出来。各写一遍 regex 那天，就会一边把
 * 注释里的 `font-weight: 700` 算进去、一边不算——门禁自己先对不上自己。
 *
 * 三条口径固定在这里：
 * - **注释不算声明**。注释里写反例是文档的正当写法，把它算成违规，门禁第一天就带着一笔永远修不掉的账。
 * - **只认字面值**。`var(--x)` / `calc()` / `clamp()` / `em` / `rem` / `%` 不是字面值，交给
 *   `check:undefined-token` 和 token 文件去管；这里只回答「这一处是不是写死了一个数」。
 * - **两种写法都算**：`.css` 的声明与 `.tsx/.ts` 的 `fontSize:` / `fontWeight:` 内联样式。
 *   只扫 CSS 时，内联那几行就是静默通道（组件线实测就差在这里）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export type Declaration = Readonly<{ file: string; line: number; value: string }>

/** 仓库根：脚本从 `scripts/ui-scan/` 往上两级。 */
export const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function walk(directory: string, out: string[]): void {
  for (const name of readdirSync(directory)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(directory, name)
    if (statSync(full).isDirectory()) {
      walk(full, out)
      continue
    }
    if (name.endsWith('.css') || name.endsWith('.ts') || name.endsWith('.tsx')) out.push(full)
  }
}

/**
 * 源码树的全部文件，路径一律正斜杠（基线键在 Windows 上也一样）。
 *
 * 测试与夹具不进：它们不是读者看到的那份样式，把夹具里的 `fontSize: 12` 算进棘轮，
 * 只会让「改一条用例」变成「改一次基线」。
 */
export function sourceFilesUnder(roots: readonly string[], extensions: readonly string[]): string[] {
  const files: string[] = []
  for (const root of roots) {
    try {
      walk(join(REPOSITORY_ROOT, root), files)
    } catch {
      // 目录不存在（裁剪过的快照）：跳过，不让门禁红在一个与改动无关的原因上。
    }
  }
  return files
    .filter((file) => !file.includes('.test.') && !file.includes('.spec.'))
    .filter((file) => extensions.some((extension) => file.endsWith(extension)))
    .map((file) => relative(REPOSITORY_ROOT, file).split(sep).join('/'))
    .sort()
}

function withoutCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
}

/** `.css` 里某个属性的全部声明值，按文件顺序。`!important` 去掉，它不影响「是不是字面值」。 */
export function declarationsOf(file: string, property: string): Declaration[] {
  const css = withoutCssComments(readFileSync(join(REPOSITORY_ROOT, file), 'utf8'))
  const pattern = new RegExp(`(^|[;{\\s])${property}\\s*:\\s*([^;}]+)`, 'gu')
  const found: Declaration[] = []
  for (const match of css.matchAll(pattern)) {
    const raw = (match[2] ?? '').replace(/!important/iu, '').trim()
    if (raw === '') continue
    const offset = (match.index ?? 0) + (match[1] ?? '').length
    found.push({ file, line: css.slice(0, offset).split('\n').length, value: raw })
  }
  return found
}

/**
 * `.tsx/.ts` 里内联样式的字面值：`fontSize: 12`、`fontSize: '12px'`、`fontWeight: 700`。
 *
 * 只认数字与带 `px` 的字符串：`fontSize: size`、`fontWeight: values.bold` 这类变量是正当写法，
 * 不在这里判——它们的值来自 token 或 props，改一处就全改。
 */
export function inlineStyleValuesOf(file: string, property: string): Declaration[] {
  const source = readFileSync(join(REPOSITORY_ROOT, file), 'utf8')
  // 行注释只抹「整行就是注释」的写法：`//` 出现在字符串里（URL）时抹掉会连后面的声明一起丢。
  const text = withoutCssComments(source).replace(/^[ \t]*\/\/.*$/gmu, (line) => ' '.repeat(line.length))
  const pattern = new RegExp(`${property}\\s*:\\s*(?:'([^']*)'|"([^"]*)"|([0-9]+(?:\\.[0-9]+)?))`, 'gu')
  const found: Declaration[] = []
  for (const match of text.matchAll(pattern)) {
    const raw = (match[1] ?? match[2] ?? match[3] ?? '').trim()
    if (raw === '') continue
    found.push({ file, line: text.slice(0, match.index ?? 0).split('\n').length, value: raw })
  }
  return found
}

/** `font-size`/`fontSize` 的字面值是不是一个 px 数：`12` 与 `'12px'` 两种写法都认。 */
export function isPixelLiteral(value: string): boolean {
  return /^\d+(\.\d+)?(px)?$/u.test(value.trim())
}
