/** 运行审计码闭集：类型与数组**同源**，新增一个码要同时改这里、描述表与文案表。 */
export type ChannelInboundAuditCode =
  | 'channel-policy-denied'
  | 'channel-mention-required'
  | 'channel-content-rejected'
  | 'channel-receipt-without-work-item'
  | 'channel-stale-generation'
  | 'channel-agent-missing'
  | 'channel-work-capacity-exhausted'
  | 'channel-lifecycle-fenced'
  | 'channel-inbound-failed'
  /** 频道换了助手：这个对话已切到新助手的会话（不是故障，是读者的主动动作）。 */
  | 'channel-conversation-switched'

/**
 * 运行审计码的闭集。设置页的日志面板据此把码转成人话，**查不到的写「没有更多说明」**，
 * 原始码一个字都不上屏；新增一个码要同时改这里与文案表，否则界面上只会出现兜底句。
 */
export const channelInboundAuditCodes = [
  'channel-policy-denied',
  'channel-mention-required',
  'channel-content-rejected',
  'channel-receipt-without-work-item',
  'channel-stale-generation',
  'channel-agent-missing',
  'channel-work-capacity-exhausted',
  'channel-lifecycle-fenced',
  'channel-inbound-failed',
  'channel-conversation-switched'
] as const satisfies readonly ChannelInboundAuditCode[]

export function isChannelInboundAuditCode(value: string): value is ChannelInboundAuditCode {
  return (channelInboundAuditCodes as readonly string[]).includes(value)
}
