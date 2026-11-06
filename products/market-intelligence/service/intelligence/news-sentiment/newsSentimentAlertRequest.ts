import type { NotificationContentByLanguage, NotificationDedupeVars } from '@platform/notifications/contracts/notificationContracts'

import { MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS as EVENT_IDS } from '../../../contracts/notificationEventKeys'
import { renderSentimentAlert, type SentimentAlertLocale, type SentimentAlertStrength } from '../../../contracts/sentimentAlertSentences'

/**
 * N10 的提交内容：**源头拼成品**（契约 v2.56），中英各一份，平台只挑一份转发。
 *
 * 三块固定，且**正文里没有链接**：`url` 只走 `open-external` 动作，手机末尾那一行由平台
 * `formatPushText(content, externalUrl?)` 附。产品把 URL 拼进正文，中心那条就会被两行截断，
 * 而且会造出「正文一个链接、按钮另一个」的第二份地址。
 *
 * 缺来源名就不提交：契约要求三段齐全，空串会被文案门禁拒成 `copy-missing`——与其让平台拒，
 * 不如源头就不发（这也是「缺字段不推」的原样延续）。
 *
 * **装配待定**：`open-external` 这个动作类型平台代码里还没有（契约 §7.5 ⑫ 已定、代码未落），
 * 所以这里先只产出内容与去重参数，不产出 `NotificationSubmitRequest`，也不声明事件——
 * 声明了就必须有人发（生产者门禁），接一条动作表达不出来的提交等于假可用。
 */
export type SentimentAlertContent = Readonly<{
  eventTypeId: string
  rendered: NotificationContentByLanguage
  dedupeVars: NotificationDedupeVars
  severity: 'info'
  occurredAt: string
}>

export function buildSentimentAlertContent(input: {
  storyKey: string
  strength: SentimentAlertStrength
  /** 新闻原标题：数据，不翻译、不改写。 */
  headline: string
  /** 来源显示名：数据。缺它就不提交。 */
  sourceName?: string
  /** 发布时刻（读者看到的“什么时候发生”）。 */
  publishedAt: string
}): SentimentAlertContent | undefined {
  const headline = input.headline.trim()
  const sourceName = input.sourceName?.trim()
  const storyKey = input.storyKey.trim()
  if (!headline || !sourceName || !storyKey) return undefined

  const locales: SentimentAlertLocale[] = ['zh-CN', 'en-US']
  const rendered: NotificationContentByLanguage = {}
  for (const locale of locales) {
    const sentences = renderSentimentAlert({ locale, strength: input.strength, headline, sourceName })
    rendered[locale] = sentences
  }

  return {
    eventTypeId: EVENT_IDS.sentimentAlert,
    rendered,
    // 同一件事一条：键由 `storyKey` 构成，平台按声明里的模板内插；重复提交由平台合并计数。
    dedupeVars: { builder: 'template', vars: { storyKey } },
    severity: 'info',
    occurredAt: input.publishedAt
  }
}
