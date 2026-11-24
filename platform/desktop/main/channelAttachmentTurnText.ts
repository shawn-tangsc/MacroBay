import type { ChannelInboundPayload } from '../../ai/agent-platform/channels/ChannelInboundContracts'

/**
 * 「只带附件、没有配文」的入站消息：读者看到什么（`displayText`）、模型这一轮拿到什么（`text`）。
 *
 * 为什么要分成两半：这句话显示在**读者自己的气泡**里，所以它只能描述发生了什么事——不能替读者
 * 表态（「这一版还看不到内容」那种话，读者会以为是自己说的）；而「拿到的只是引用、没有画面」
 * 是**给模型的约束**，必须进提示词，不能进气泡。
 *
 * 为什么不再把附件引用写进气泡：引用（`qq:file:…`）是机器用的身份，读者看了没有用；
 * 平台本来就有 `displayText`（气泡）+ `text`（模型）这条缝，按它走，别自己造一条。
 *
 * 形状（数字形式是刻意的：单条与多条同一个句式，读起来不像两个人写的）：
 * - 气泡：`收到 1 张图片，没有文字。` / `收到 3 个附件，没有文字。`
 * - 模型：上面那句 + 引用块 + 一条**要求**（不是句式守卫：只说「不许描述画面」这条事实约束）。
 *
 * 边界：这条只在**没有配文**时用。有配文的消息逐字照旧，不追加任何附件说明——否则每一轮历史
 * 消息都会变样。回执里不放字节、不放临时链接：稳定引用本身不是可下载地址，写出去也不泄数据。
 */
export type ChannelAttachmentOnlyTurn = {
  /** 读者气泡里的那一句：只描述发生了什么，不替读者表态。 */
  displayText: string
  /** 交给模型的内容：同一句 + 每条附件的稳定引用 + 「只确认收到、不许描述画面」这条要求。 */
  text: string
}

export function channelAttachmentOnlyTurn(
  language: string,
  attachments: ChannelInboundPayload['attachments']
): ChannelAttachmentOnlyTurn {
  const zh = language === 'zh-CN'
  const images = attachments.filter((attachment) => attachment.kind === 'image').length
  const displayText = attachments.length === 1 && images === 1
    ? zh ? '收到 1 张图片，没有文字。' : 'Received 1 image, with no text.'
    : zh ? `收到 ${attachments.length} 个附件，没有文字。` : `Received ${attachments.length} attachments, with no text.`

  const references = attachments.map((attachment) => {
    // 名字（没有就用格式）· 稳定引用。引用是核对用的，不是可点链接。
    return `- ${attachment.name ?? attachment.mimeType} · ${attachment.stableRef}`
  })
  // 提示词里的**要求**（不是句式名单）：这一轮只有引用、没有像素，模型只能确认收到并说明读不到内容。
  const rule = '[channel attachment] This turn carries attachment references only; no image or file content was downloaded. '
    + 'Acknowledge receipt and state that the content cannot be read in this version. '
    + 'Do not describe or guess what the picture shows.'
  return {
    displayText,
    text: [displayText, '[attachments]', ...references, '', rule].join('\n')
  }
}