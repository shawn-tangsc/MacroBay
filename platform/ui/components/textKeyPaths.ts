import ts from 'typescript'

/**
 * 从源码里收集「**声明过**的文案键」——按 AST 的对象属性路径，不按「文件里出现过这个字符串」。
 *
 * 为什么必须按属性路径判：哨兵解析器自己就把键写在比较式里
 * （`key === 'briefingPush.stripInfo' ? … : …`），按「出现过」判它一定绿；按「某个对象的属性名」
 * 判它才红。这个区别就是本模块存在的理由。
 *
 * 收三样东西：
 * 1. **对象字面量的属性路径**（`assistants: { copyMessage: … }` → `assistants.copyMessage`；
 *    字符串字面量属性名 `'ui.drawer.close': …` 原样收）；
 * 2. **语言标签那一层剥掉**：`{ 'zh-CN': { assistants: … } }` 收成 `assistants.…`——
 *    调用点写的是键本身，不是「zh-CN 开头的路径」；
 * 3. **字符串字面量类型的成员**（`type P = 'messages.navigateTop' | …`）与
 *    `const X_KEY = '…'` 的初值：这两处都是「声明了这条键」，不是把它当句子用。
 *
 * 已知残差（写在这里而不是偷偷放宽）：键是**运行时拼出来**的字符串时这里收不到——那类只允许
 * 登记例外，默认没有例外。
 */
const LANGUAGE_TAGS = new Set(['zh-CN', 'en-US'])

function propertyName(node: ts.PropertyName | undefined): string | undefined {
  if (node === undefined) return undefined
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text
  if (ts.isIdentifier(node)) return node.text
  return undefined
}

/** 单文件：收集这份源码里声明过的键。 */
export function declaredTextKeys(source: string, kind: 'ts' | 'tsx' = 'tsx'): Set<string> {
  const keys = new Set<string>()
  const file = ts.createSourceFile('source.' + kind, source, ts.ScriptTarget.Latest, true, kind === 'tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

  const walk = (node: ts.Node, prefix: string): void => {
    if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) {
        const name = propertyName(prop.name)
        if (name === undefined) {
          ts.forEachChild(prop, (child) => walk(child, prefix))
          continue
        }
        // 语言标签层不参与键：`{ 'zh-CN': { assistants: … } }` 的键就是 `assistants.…`。
        if (LANGUAGE_TAGS.has(name)) {
          ts.forEachChild(prop, (child) => walk(child, prefix))
          continue
        }
        const path = prefix === '' ? name : `${prefix}.${name}`
        keys.add(path)
        ts.forEachChild(prop, (child) => walk(child, path))
      }
      return
    }
    // 字符串字面量类型的成员：`'messages.navigateTop' | …` 也是「声明过这条键」。
    if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) {
      keys.add(node.literal.text)
      return
    }
    ts.forEachChild(node, (child) => walk(child, prefix))
  }

  walk(file, '')
  return keys
}

/** 多文件：并集。`sources` 是 `{ path, text }`，路径只用于报错定位。 */
export function declaredTextKeysIn(sources: ReadonlyArray<Readonly<{ path: string; text: string }>>): Set<string> {
  const all = new Set<string>()
  for (const source of sources) {
    for (const key of declaredTextKeys(source.text, source.path.endsWith('.tsx') ? 'tsx' : 'ts')) all.add(key)
  }
  return all
}

/** `ariaLabelKey="…"` / `ariaLabelKey={'…'}` 的字面量取值。 */
export function literalAriaLabelKeys(source: string): ReadonlyArray<Readonly<{ key: string; line: number }>> {
  const found: Array<{ key: string; line: number }> = []
  const pattern = /ariaLabelKey\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*['"]([^'"]*)['"]\s*\})/g
  for (const match of source.matchAll(pattern)) {
    const key = match[1] ?? match[2] ?? match[3] ?? ''
    const line = source.slice(0, match.index ?? 0).split('\n').length
    found.push({ key, line })
  }
  return found
}
