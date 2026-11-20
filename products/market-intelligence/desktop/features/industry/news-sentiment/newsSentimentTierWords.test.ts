import { describe, expect, it } from 'vitest'

import { OPEN_SENTIMENT_ACTION_KEY } from '../../../../contracts/notificationEventKeys'
import { newsArrivalTemplates } from '../../../../contracts/newsArrivalSentences'
import { sentimentAlertTemplates } from '../../../../contracts/sentimentAlertSentences'
import { marketIntelligenceNotificationCopy } from '../../../shared/i18n/text/notifications'
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
 *
 * 设置页那一行会在档位词后面补一句括号说明（「低（三档都推）」）——**词的比较只看开头那个词**，
 * 括号里是代价说明，不是第二个名字；把整串拿去比会把「补了句说明」误判成「换了词」。
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
        // 取开头那个词：中英都用空白或全角/半角括号分隔说明。
        const settingsTierWord = (settingsWord ?? '').split(/[\s（(]/)[0] ?? ''
        expect(settingsTierWord.toLowerCase()).toBe(alertWord.toLowerCase())
      }
    })
  }
})

/**
 * 桌面提醒（R40）与卡片用**同一套方向词**：读者在通知里读到「偏多」，进应用看到的也是「偏多」，
 * 两处换个说法就是两件事。英文那边一处是句子中间、一处是列表小字，所以只比词、不比大小写。
 */
describe('news arrival notice words', () => {
  const CARD_LABEL = { bullish: 'bullish', bearish: 'bearish', neutral: 'neutral', mixed: 'mixed' } as const
  const POLARITIES = ['bullish', 'bearish', 'neutral', 'mixed'] as const

  for (const language of ['zh-CN', 'en-US'] as const) {
    it(`uses the card's direction words in the desktop notice — ${language}`, () => {
      const card = productText[language].pages.intelligence.portal.newsSentiment.labels
      const notice = newsArrivalTemplates[language].polarity
      for (const polarity of POLARITIES) {
        expect(notice[polarity].toLowerCase()).toBe(card[CARD_LABEL[polarity]].toLowerCase())
      }
    })

    it(`labels the notice action by what it really does — ${language}`, () => {
      // 这一版只打开舆情页、不定位：标签只能是「打开舆情」。定位能力落地后才改「查看这条」。
      const label = marketIntelligenceNotificationCopy[language][OPEN_SENTIMENT_ACTION_KEY]
      expect(label).toBe(language === 'zh-CN' ? '打开舆情' : 'Open news')
      expect(label).not.toContain('查看这条')
      expect(label).not.toContain('View this')
    })
  }
})
