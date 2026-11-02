/**
 * 本线提示允许出现的键：闭合联合。
 *
 * 它不约束 `Tooltip.labelKey`（那是 `string`，静态守卫管形状），但调用点与用例都用它标注，
 * 写错一处编译就红——比事后在界面上发现一句空提示便宜。
 */
export type AgentTooltipKey =
  | 'messages.navigateTop'
  | 'messages.navigatePrevious'
  | 'messages.navigateNext'
  | 'messages.navigateBottom'
  | 'navbar.hideSidebar'
  | 'navbar.showSidebar'
  | 'navbar.openSessions'
  | 'navbar.createAgent'
  | 'navbar.search'
  | 'messageNavigation.none'
  | 'settingsDrawer.narrowMode'
  | 'navbar.agentSettings'
  | 'chatNavbar.agentConfig'
  | 'chatNavbar.openWorkspace'
  | 'chatNavbar.clearMessages'
  | 'chatNavbar.taskCenter'
  | 'chatNavbar.chatSettings'
  | 'chatNavbar.openInExternalAppMenu'
  | 'chatNavbar.openInExternalApp'
  | 'sessionItem.deleteShortcut'
  | 'sessionItem.more'
  | 'messages.copy'
  | 'messages.resend'
  | 'messages.delete'

/**
 * 提示文案的点分键解析。
 *
 * `Tooltip` 只收键（`labelKey`），句子由调用点注入的 `resolveText` 给出；而 `AgentText` 是一棵
 * 嵌套对象，不是键表。这里把两者接起来：键就是文案表里的真实路径（`messages.navigateTop`），
 * 逐段取值即可——**不做 kebab→camel 之类的改名**，否则同一句话会有两个名字。
 *
 * 未知键返回空串——`Tooltip` 据此整条不渲染，绝不把键名念给读者。
 *
 * 第一个参数收 `object` 而不是整棵 `AgentText`：消息组手里只有 `messages/input/runtimeText/…`
 * 这几支（`Pick<AgentText, …>`），逼它去拼一整棵文案表才能解析一个键，是把类型当门禁用错了地方。
 * 取值本身就是逐段走对象，任何对象都成立。
 */
export function resolveAgentTextKey(text: object, key: string): string {
  let current: unknown = text
  for (const segment of key.split('.')) {
    if (current === null || typeof current !== 'object') return ''
    current = (current as Record<string, unknown>)[segment]
  }
  return typeof current === 'string' ? current : ''
}

/** 提示键是闭集（四个导航提示），走同一份取值实现。 */
export function resolveAgentTooltipText(text: object, key: AgentTooltipKey): string {
  return resolveAgentTextKey(text, key)
}
