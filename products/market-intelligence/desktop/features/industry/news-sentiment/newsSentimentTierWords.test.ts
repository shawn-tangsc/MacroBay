import { describe, expect, it } from 'vitest'

import { sentimentAlertTemplates } from '../../../../contracts/sentimentAlertSentences'
import { intelligenceNotificationText } from '../../../settings/intelligence-notification/text'
import { productText } from '../../../shared/i18n/productText'

/**
 * 同一档位在三个地方出现：手机推送的标题（`【高】…`）、卡片与抽屉里的强度小字、设置页那一行
 * 「最低强度」。读者按同一个词理解同一件事，所以三处必须逐词相同。
 *
 * 契约键名两边不一样（推送用 `low/medium/high`，卡片用 `weak/medium/strong`），**键名不改**：
 * 那是内部标识。这里只比给读者看的字。
 *
 * 英文明细里是小写（句子中间），手机标题在方括号里首字母大写——所以只比词本身，不比大小写。
 */
const CARD_KEY = { low: 'weak', medium: 'medium', high: 'strong' } as const
const TIERS = ['low', 'medium', 'high'] as const

describe('news sentiment tier words', () => {
  for (const language of ['zh-CN', 'en-US'] as const) {
    it(`uses one set of words across phone title, card and settings — ${language}`, () => {
      const card = productText[language].pages.intelligence.portal.newsSentiment.drawer.detail.strengthLevels
      const alert = sentimentAlertTemplates[language].strength
      const settings = intelligenceNotificationText[language]
      for (const tier of TIERS) {
        const cardWord = card[CARD_KEY[tier]]
        const alertWord = alert[tier]
        const settingsWord = settings[`pages.intelligence.notification.threshold.${tier === 'high' ? 'high' : tier}`]
        expect(cardWord.toLowerCase()).toBe(alertWord.toLowerCase())
        expect(settingsWord?.toLowerCase()).toBe(alertWord.toLowerCase())
      }
    })
  }
})
