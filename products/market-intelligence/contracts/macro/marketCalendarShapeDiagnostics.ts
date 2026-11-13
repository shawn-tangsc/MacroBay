/**
 * **形状不匹配的失败说明**（只给用例用，不在生产校验路径上）。
 *
 * 由来：`marketExact` 只返回 `false`，所以「页面被判非法」时我们只能人工比对两个数组，
 * 才找出漏了四个键。判据本身不该改（它在热路径上，多算一次键差没有意义），但**失败信息
 * 应该直接说清多了什么、缺了什么**。
 *
 * 这个函数**不做校验**：`validate` 传进来的是什么就是什么，它只负责在已经判定失败之后
 * 把两边的键差摆出来。
 */
export function explainShapeMismatch(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = []
): string {
  if (typeof value !== 'object' || value === null) return `期望对象，实际 ${value === null ? 'null' : typeof value}`
  const actual = Object.keys(value as Record<string, unknown>)
  const allowed = new Set([...required, ...optional])
  const missing = required.filter((key) => !actual.includes(key))
  const unexpected = actual.filter((key) => !allowed.has(key))
  if (missing.length === 0 && unexpected.length === 0) return '键集完全匹配（失败在取值，不在键集）'
  const parts: string[] = []
  // 缺的排在前面：漏字段通常是「新加的字段没进白名单」，那是最容易发生的错。
  if (missing.length > 0) parts.push(`缺少键：${missing.join(', ')}`)
  if (unexpected.length > 0) parts.push(`多余键：${unexpected.join(', ')}`)
  return parts.join('；')
}
