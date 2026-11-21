import type { ChannelInboundPayload } from '../../ai/agent-platform/channels/ChannelInboundContracts'

/**
 * 「只带附件、没有配文」的入站消息，交给助手的那一句。
 *
 * 为什么需要：这种消息原来变成**空回合**——助手什么都没拿到，聊天里也看不出「收到过」，
 * 读者分不清「没发」「发了没处理」「处理了没结果」。这一段把「收到了什么」说清楚，
 * 并把每条附件的**稳定引用**写进去：助手能据此回一句「收到这张图」，也留得下可核对的东西。
 *
 * 为什么单独一个文件：装配那个文件贴着 500 行硬线，这句文案不该挤在接线里；而且它是纯函数，
 * 中英两套能单独测（不新开一份「可见文案表」——它只服务通道入站这一处，不进界面词表）。
 *
 * 边界：**只在没有配文时用它**。有配文的消息逐字照旧，不追加任何附件说明——否则每一轮历史消息
 * 都会变样。回执里也不放字节、不放临时链接：稳定引用本身不是可下载地址，写出去也不泄数据。
 */
export function channelAttachmentTurnText(
  language: string,
  attachments: ChannelInboundPayload['attachments']
): string {
  if (attachments.length === 0) return ''
  const zh = language === 'zh-CN'
  const images = attachments.filter((attachment) => attachment.kind === 'image').length
  const onlyOneImage = attachments.length === 1 && images === 1
  const head = zh
    ? onlyOneImage ? '收到一张图片，没有文字。' : `收到 ${attachments.length} 个附件，没有文字。`
    : onlyOneImage ? 'An image arrived, with no text.' : `${attachments.length} attachments arrived, with no text.`
  const label = zh ? '附件：' : 'Attachments:'
  // 每条附件一行：名字（没有就用格式）· 稳定引用。引用是核对用的，不是可点链接。
  const lines = attachments.map((attachment) => `- ${attachment.name ?? attachment.mimeType} · ${attachment.stableRef}`)
  return [head, label, ...lines].join('\n')
}