/**
 * 「HEAD 里引用到的每一份文件，也必须自己在 HEAD 里」——守的是一类事故，不是风格。
 *
 * 今晚同一个形状发生了三次：新写的文件只在磁盘上、没有进库，而引用它的那一笔照样提交了。
 * 结果是 HEAD 自己编译不过，可从**工作区**跑类型检查却是绿的（磁盘上有那个文件），
 * 于是下一个人（`git archive`、干净副本、CI）先把同一批红撞一遍，还要先花时间证明
 * 「不是我改坏的」。
 *
 * 为什么在 HEAD 上判、而不是在工作区上判：这一条要证明的是「这一笔提交自己是完整的」。
 * 工作区里同时有几条线在改，磁盘上有、库里没有是常态；只有 HEAD 上的缺件才是缺陷。
 * 所以输入全部来自 `git ls-tree` / `git grep` 的 HEAD 视图，一个字节都不读工作区。
 *
 * 只判能解析到仓库内的说明符（相对路径与 tsconfig 别名）；外部包交给包管理器。
 */

export type HeadTreeImport = Readonly<{
  /** 引用方，仓库相对路径（`git ls-tree` 的写法）。 */
  file: string
  line: number
  specifier: string
}>

export type AliasRule = Readonly<{ prefix: string; target: string }>

/** `import x from 'y'`、`export {x} from 'y'`、`import('y')`、`require('y')` 四种写法。 */
const SPECIFIER_PATTERN = /\b(?:from|import|require)\s*\(?\s*(['"])([^'"\n]+)\1/g

/**
 * 位置是否落在字符串或模板字面量里。
 *
 * 这一条不是洁癖：仓库里有一整类用例是**把源码文本当证据来断言**的
 * （`expect(source).toContain("from '../../window/rendererProcessDiagnostics'")`），
 * 它们写的是别人文件里的一句 import。不判字符串，这些断言会各自变成一条假 red，
 * 而假 red 会把真 red 一起淹掉。引号奇偶就够了：真 import 前面不该有未闭合的引号。
 */
function insideStringLiteral(text: string, index: number): boolean {
  let open: string | null = null
  for (let cursor = 0; cursor < index; cursor += 1) {
    const character = text[cursor]
    if (character === '\\') {
      cursor += 1
      continue
    }
    if (open === null) {
      if (character === '"' || character === "'" || character === '`') open = character
    } else if (character === open) {
      open = null
    }
  }
  return open !== null
}

/**
 * 从源码里取出说明符。
 *
 * 注释里的 `from '…'` 仍会被取到（不做词法分析）；这是有意的偷懒——多的那一条读一眼就知道是
 * 注释。字符串与模板字面量里的不算，理由见 `insideStringLiteral`：那不是「顺手多报」，
 * 是仓库里真实存在的一大类断言用例。
 */
export function parseImportSpecifiers(file: string, source: string): HeadTreeImport[] {
  const found: HeadTreeImport[] = []
  const lines = source.split('\n')
  for (const [index, text] of lines.entries()) {
    SPECIFIER_PATTERN.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = SPECIFIER_PATTERN.exec(text)) !== null) {
      const specifier = match[2]
      if (specifier === undefined) continue
      // 模板字面量拼出来的路径（`'../${id}/x'`）本来就不是静态可判的。
      if (specifier.includes('${')) continue
      if (insideStringLiteral(text, match.index)) continue
      found.push({ file, line: index + 1, specifier: stripQuery(specifier) })
    }
  }
  return found
}

/** `./slice?raw`、`./theme.css?url`：查询串是打包器的，不是路径的一部分。 */
function stripQuery(specifier: string): string {
  const queryAt = specifier.indexOf('?')
  return queryAt === -1 ? specifier : specifier.slice(0, queryAt)
}

export function aliasRulesFromTsconfigPaths(
  paths: Readonly<Record<string, readonly string[]>>
): AliasRule[] {
  return Object.entries(paths)
    .filter(([pattern, targets]) => pattern.endsWith('/*') && targets.length > 0 && targets[0] !== undefined)
    .map(([pattern, targets]) => {
      // `@platform/*` → 前缀 `@platform/`、目标 `platform/`：两边的 `*` 都要摘掉，
      // 只摘一边会拼出 `platform/*ui/kept` 这种谁都不认识的路径。
      const target = targets[0] as string
      return { prefix: pattern.slice(0, -1), target: target.endsWith('*') ? target.slice(0, -1) : target }
    })
    .sort((left, right) => right.prefix.length - left.prefix.length)
}

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.mjs', '.js', '.jsx', '.css', '.json'] as const

/**
 * 解析一个说明符可能对应的所有路径。
 *
 * 覆盖 `foo`、`foo.ts`、`foo/index.ts` 三种落法；另外把 `.js`/`.mjs` 写法映回 `.ts`/`.mts`，
 * 因为 ESM 风格的脚本按编译后的扩展名写 import 是合法的。
 */
export function candidatePaths(base: string): string[] {
  const candidates = [base]
  for (const extension of SOURCE_EXTENSIONS) candidates.push(base + extension)
  for (const extension of SOURCE_EXTENSIONS) candidates.push(`${base}/index${extension}`)
  if (base.endsWith('.js')) {
    const stem = base.slice(0, -3)
    candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}/index.ts`, `${stem}/index.tsx`)
  }
  if (base.endsWith('.mjs')) {
    const stem = base.slice(0, -4)
    candidates.push(`${stem}.mts`, `${stem}.ts`)
  }
  return candidates
}

/** 仓库相对路径的拼接；不用 `node:path`，因为它按平台分隔符走，而 git 树永远是 `/`。 */
function joinRepoPath(directory: string, relative: string): string {
  const parts: string[] = directory === '' || directory === '.' ? [] : directory.split('/')
  for (const segment of relative.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  return parts.join('/')
}

/**
 * 说明符指向的候选路径；`null` 表示「不该由本守卫判」（外部包）。
 */
export function resolveSpecifier(
  fromFile: string,
  specifier: string,
  aliasRules: readonly AliasRule[]
): string[] | null {
  if (specifier.startsWith('.')) {
    const directory = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')) : ''
    return candidatePaths(joinRepoPath(directory, specifier))
  }
  for (const rule of aliasRules) {
    if (specifier.startsWith(rule.prefix)) {
      const rest = specifier.slice(rule.prefix.length)
      return candidatePaths(joinRepoPath('', rule.target + rest))
    }
  }
  return null
}

/**
 * HEAD 里解析不到目标的引用。
 *
 * `tracked` 是 HEAD 的文件集合；`imports` 是从 HEAD 的树里取出的引用。
 * 返回值按「引用方 → 行号」排序，好让人照着改。
 */
export function findUnresolvedImports(
  imports: readonly HeadTreeImport[],
  tracked: ReadonlySet<string>,
  aliasRules: readonly AliasRule[]
): HeadTreeImport[] {
  const unresolved: HeadTreeImport[] = []
  for (const entry of imports) {
    const candidates = resolveSpecifier(entry.file, entry.specifier, aliasRules)
    if (candidates === null) continue
    if (candidates.some((candidate) => tracked.has(candidate))) continue
    unresolved.push(entry)
  }
  return unresolved.sort((left, right) =>
    left.file === right.file ? left.line - right.line : left.file < right.file ? -1 : 1
  )
}

/** 一句话人话版，给报错用：读者不需要记得住守卫的实现。 */
export function describeUnresolved(entry: HeadTreeImport): string {
  return `${entry.file}:${entry.line} 引用 '${entry.specifier}'，而该文件不在 HEAD 里（只在磁盘上？先 git add -N 再和引用它的那一笔同批提交）`
}
