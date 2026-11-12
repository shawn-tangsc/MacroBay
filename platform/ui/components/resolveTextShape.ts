import ts from 'typescript'

/**
 * `resolveText` 的**哨兵形状**：函数体用比较式把「键 → 另一句话」硬编码进去。
 *
 * 为什么抓这个而不是「内联 lambda 一律红」：平台各屏本来就合法地写
 * `resolveText={(key) => localMap[key] ?? ''}`。一刀切会把合规代码全打红，最后只会被加豁免。
 * 要抓的三类：
 * 1. 首个参数与**字符串字面量**做 `===` / `!==`（`key === 'briefingPush.stripInfo' ? … : …`）；
 * 2. 对首个参数 `switch`；
 * 3. 函数体就是恒等（`(key) => key`）——把键名直接当读屏名。
 *
 * **不红**：标识符 / 成员表达式（`resolveText={resolveKey}`、`props.resolveText`）、
 * 只查表或调解析器的函数体（`map[key] ?? ''`、`resolveProductTextKey(lang, key)`、`resolveX(key)`）。
 */
export type ResolveTextSentinel = Readonly<{
  /** 文件路径（调用方给的，报错时直接用）。 */
  path: string
  line: number
  /** `comparison` / `switch` / `identity`。 */
  shape: 'comparison' | 'switch' | 'identity'
}>

/** 收 `resolveText` 的同族组件：它们的读屏名/文案全都只收键，键到句子的映射必须来自文案表。 */
export const RESOLVE_TEXT_COMPONENTS = [
  'IconButton',
  'Popover',
  'Tabs',
  'Segmented',
  'StatusPill',
  'StateView',
  'Tooltip',
  'FilterChip',
  'InlineNotice',
  'DisabledHint',
  'SidePanel',
  'Drawer',
  'ToastHost'
] as const

function firstName(fn: ts.ArrowFunction | ts.FunctionExpression): string | undefined {
  const first = fn.parameters[0]
  return first !== undefined && ts.isIdentifier(first.name) ? first.name.text : undefined
}

function isFirstParam(node: ts.Node, name: string): boolean {
  return ts.isIdentifier(node) && node.text === name
}

function hasComparison(body: ts.Node, name: string): boolean {
  let found = false
  const walk = (node: ts.Node): void => {
    if (found) return
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind
      if (op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
        const left = node.left
        const right = node.right
        const literal = ts.isStringLiteral(left) ? left : ts.isStringLiteral(right) ? right : undefined
        const identifier = isFirstParam(left, name) ? left : isFirstParam(right, name) ? right : undefined
        if (literal !== undefined && identifier !== undefined) {
          found = true
          return
        }
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(body)
  return found
}

function hasSwitchOnFirstParam(body: ts.Node, name: string): boolean {
  let found = false
  const walk = (node: ts.Node): void => {
    if (found) return
    if (ts.isSwitchStatement(node) && isFirstParam(node.expression, name)) {
      found = true
      return
    }
    ts.forEachChild(node, walk)
  }
  walk(body)
  return found
}

function isIdentity(fn: ts.ArrowFunction | ts.FunctionExpression, name: string): boolean {
  const body = fn.body
  if (body !== undefined && isFirstParam(body, name)) return true
  if (body !== undefined && ts.isBlock(body)) {
    const statements = body.statements.filter((statement) => !ts.isReturnStatement(statement) || statement.expression !== undefined)
    if (statements.length === 1 && ts.isReturnStatement(statements[0]!)) {
      const expression = (statements[0] as ts.ReturnStatement).expression
      return expression !== undefined && isFirstParam(expression, name)
    }
  }
  return false
}

/** 单文件：找出所有「哨兵形状」的 `resolveText`。 */
export function sentinelResolveText(path: string, source: string): ReadonlyArray<ResolveTextSentinel> {
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const offenders: ResolveTextSentinel[] = []

  const walk = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && node.name.getText(file) === 'resolveText') {
      const initializer = node.initializer
      const expression = initializer !== undefined && ts.isJsxExpression(initializer) ? initializer.expression : undefined
      if (expression !== undefined && (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression))) {
        const name = firstName(expression)
        if (name !== undefined) {
          const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
          if (isIdentity(expression, name)) offenders.push({ path, line, shape: 'identity' })
          else if (hasSwitchOnFirstParam(expression.body, name)) offenders.push({ path, line, shape: 'switch' })
          else if (hasComparison(expression.body, name)) offenders.push({ path, line, shape: 'comparison' })
        }
      }
    }
    ts.forEachChild(node, walk)
  }

  walk(file)
  return offenders
}
