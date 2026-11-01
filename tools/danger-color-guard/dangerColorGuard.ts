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
}

export type BaselineViolation =
  | { kind: 'added'; file: string; selector: string; line: number }
  | { kind: 'stale'; file: string; selector: string }
  /** 基线里有一条没有选择器：不能跳过，跳过就等于留一个永久盲区。 */
  | { kind: 'malformed'; file: string; selector: string }

const COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g

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
    const declaration = /(?:^|;)\s*color:\s*var\(--danger\)/m.exec(body)
    if (!declaration) continue
    const bodyOffset = match.index + (match[1] ?? '').length + 1
    // 报的是 `color` 这个词的位置，不是匹配串起点——否则行号会落在上一条声明上。
    const colorOffset = bodyOffset + declaration.index + declaration[0].indexOf('color')
    const line = text.slice(0, colorOffset).split('\n').length
    uses.push({ file, selector, line })
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
    for (const use of uses.slice(allowed)) {
      violations.push({ kind: 'added', file: use.file, selector: use.selector, line: use.line })
    }
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
      if (violation.kind === 'added') {
        return `  新增：${violation.file}:${violation.line}  选择器 \`${violation.selector}\``
      }
      if (violation.kind === 'malformed') {
        return `  基线缺选择器：${violation.file}（不能跳过——跳过会留下永久盲区）`
      }
      return `  失效基线：${violation.file}  选择器 \`${violation.selector}\`（代码里已不存在，请从基线删除）`
    })
    .join('\n')
}
