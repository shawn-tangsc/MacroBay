/**
 * 状态色「前景」门禁：`color: var(--danger)` 只许出现在已登记的地方。
 *
 * 判据是**基线 + 只禁新增**，不做用途分类：`color` 的用途无法从选择器名推出来
 * （`.btn-ghost` 是文字、`.pill` 可能是色块），按名字猜会把图标判成文字，然后有人为了让闸门过
 * 去改图标。分类是基线文件里的另一列，人工逐条填，不阻塞这条闸门。
 *
 * 基线与代码必须**逐条相等**：新增一处 → 红；偷偷删掉基线里的一条而不改代码 → 也红。
 * 后者是这条闸门的第五样交付物：基线文件本身要被断言覆盖，否则它会和代码慢慢失联。
 */
export type DangerColorUse = {
  file: string
  selector: string
  line: number
  /** 字面量门禁用：这条声明的值（例如 `#dc2626`）。 */
  value?: string
}

export type BaselineViolation =
  /** 该键超出基线：不知道该键里哪一行是新的，所以只报数量与该键全部行号。 */
  | { kind: 'over-quota'; file: string; selector: string; extra: number; lines: readonly number[] }
  | { kind: 'stale'; file: string; selector: string }
  /** 基线里有一条没有选择器：不能跳过，跳过就等于留一个永久盲区。 */
  | { kind: 'malformed'; file: string; selector: string }

const COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g

/**
 * 认「前景色 --danger」的声明，含三种容易漏的写法：
 * - 带兜底值：`var(--danger, #c00)`、`var(--danger, var(--text-strong))`；
 * - 括号内有空格：`var( --danger )`；
 * - 属性名大写：`COLOR:`（CSS 大小写不敏感）。
 *
 * 必须**不**命中：`--dangerous`、`--danger-soft`、`border-left-color`——子串匹配的老坑，
 * 反方向同样要防，所以 `--danger` 后面必须紧跟空格、逗号或右括号。
 */
const DANGER_COLOR_DECLARATION = /(?:^|;)\s*color:\s*var\(\s*--danger\s*(?:,(?:[^()]|\([^()]*\))*)?\)/im

export function stripCssComments(css: string): string {
  // 保留换行，行号才不会漂。
  return css.replace(COMMENT_PATTERN, (comment) => comment.replace(/[^\n]/g, ' '))
}

export function baselineKey(file: string, selector: string): string {
  return `${file} :: ${selector}`
}

/** 取出一个文件里所有 `color: var(--danger)` 的规则块。 */
export function scanDangerColor(css: string, file: string): DangerColorUse[] {
  const text = stripCssComments(css)
  const uses: DangerColorUse[] = []
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = rulePattern.exec(text)) !== null) {
    const selector = (match[1] ?? '').replace(/\s+/g, ' ').trim()
    const body = match[2] ?? ''
    const declaration = DANGER_COLOR_DECLARATION.exec(body)
    if (!declaration) continue
    const bodyOffset = match.index + (match[1] ?? '').length + 1
    // 报的是 `color` 这个词的位置，不是匹配串起点——否则行号会落在上一条声明上。
    const colorOffset = bodyOffset + declaration.index + declaration[0].search(/color:/i)
    const line = text.slice(0, colorOffset).split('\n').length
    uses.push({ file, selector, line })
  }
  return uses
}

/** 属性名必须正好是 `color`（不是 `border-color`），值是十六进制字面量。 */
const HEX_COLOR_DECLARATION = /(?:^|;)\s*color:\s*(#[0-9a-fA-F]{3,8})\b/im

export function scanHexColorLiteral(css: string, file: string): DangerColorUse[] {
  const text = stripCssComments(css)
  const uses: DangerColorUse[] = []
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = rulePattern.exec(text)) !== null) {
    const selector = (match[1] ?? '').replace(/\s+/g, ' ').trim()
    const body = match[2] ?? ''
    const declaration = HEX_COLOR_DECLARATION.exec(body)
    if (!declaration) continue
    const bodyOffset = match.index + (match[1] ?? '').length + 1
    const valueOffset = bodyOffset + declaration.index + declaration[0].search(/#/)
    const line = text.slice(0, valueOffset).split('\n').length
    uses.push({ file, selector, line, value: declaration[1] })
  }
  return uses
}

export function toBaseline(uses: readonly DangerColorUse[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const use of uses) {
    const key = baselineKey(use.file, use.selector)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

/**
 * 代码与基线逐条比对。`actual` 里多出来的算「新增」，基线里有而代码里没有的算「失效条目」，
 * 两者都要报——只报前者，基线就会慢慢变成一张没人维护的过期清单。
 */
export function compareWithBaseline(
  actual: readonly DangerColorUse[],
  baseline: Readonly<Record<string, number>>
): BaselineViolation[] {
  const violations: BaselineViolation[] = []
  const seen: Record<string, DangerColorUse[]> = {}
  for (const use of actual) {
    const key = baselineKey(use.file, use.selector)
    ;(seen[key] ??= []).push(use)
  }

  for (const [key, uses] of Object.entries(seen)) {
    const allowed = baseline[key] ?? 0
    if (uses.length <= allowed) continue
    const first = uses[0]
    violations.push({
      kind: 'over-quota',
      file: first?.file ?? key.split(' :: ')[0] ?? key,
      selector: first?.selector ?? '',
      extra: uses.length - allowed,
      lines: uses.map((use) => use.line).sort((left, right) => left - right)
    })
  }

  for (const [key, count] of Object.entries(baseline)) {
    const separator = key.indexOf(' :: ')
    const file = separator >= 0 ? key.slice(0, separator) : key
    const selector = separator >= 0 ? key.slice(separator + 4) : ''
    if (!selector.trim()) {
      violations.push({ kind: 'malformed', file, selector })
      continue
    }
    const actualCount = seen[key]?.length ?? 0
    for (let index = actualCount; index < count; index += 1) {
      violations.push({ kind: 'stale', file, selector })
    }
  }

  return violations
}

export function formatViolations(violations: readonly BaselineViolation[]): string {
  return violations
    .map((violation) => {
      if (violation.kind === 'over-quota') {
        // 比较是按计数做的：不知道该键里哪一行是新的，就别假装知道。
        return `  超配额：${violation.file}  选择器 \`${violation.selector}\` 比基线多 ${violation.extra} 处（该键全部行：${violation.lines.join(', ')}）`
      }
      if (violation.kind === 'malformed') {
        return `  基线缺选择器：${violation.file}（不能跳过——跳过会留下永久盲区）`
      }
      return `  失效基线：${violation.file}  选择器 \`${violation.selector}\`（代码里已不存在，请从基线删除）`
    })
    .join('\n')
}
