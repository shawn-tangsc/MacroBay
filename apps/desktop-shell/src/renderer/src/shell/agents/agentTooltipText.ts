import type { AgentText } from './agentText'

/**
 * 提示文案的点分键解析。
 *
 * `Tooltip` 只收键（`labelKey`），句子由调用点注入的 `resolveText` 给出；而 `AgentText` 是一棵
 * 嵌套对象，不是键表。这里把两者接起来：键写成**小写点分**（`tooltip` 守卫要求的形状，例如
 * `messages.navigate-top`），逐段转成对象的驼峰名（`messages.navigateTop`）后取值。
 *
 * 不做成「每个调用点各写一张 键→句子 的映射」：那样同一个句子会有两份，改文案时改一处、漏一处。
 * 段名里的连字符只用来满足守卫的键形状，它不改变取值的路径，所以对象结构一改，这里跟着改一处。
 *
 * 未知键返回空串——`Tooltip` 据此整条不渲染，绝不把键名念给读者。
 */
export function toCamelSegment(segment: string): string {
  return segment.replace(/-([a-z0-9])/g, (_match, next: string) => next.toUpperCase())
}

export function resolveAgentTooltipText(text: AgentText, key: string): string {
  let current: unknown = text
  for (const segment of key.split('.')) {
    if (current === null || typeof current !== 'object') return ''
    current = (current as Record<string, unknown>)[toCamelSegment(segment)]
  }
  return typeof current === 'string' ? current : ''
}
