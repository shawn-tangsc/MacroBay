import { describe, expect, it } from 'vitest'

import { findMissingNotificationEventCopy } from '@platform/notifications/contracts/notificationEventCopyGate'

import { marketIntelligenceProductManifest } from '../../../../product.manifest'
import {
  MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS as IDS,
  notificationEventBodyKey,
  notificationEventReasonKey,
  notificationEventTitleKey
} from '../../../../contracts/notificationEventKeys'
import { marketIntelligenceNotificationCopy } from './notifications'

const lookup = (language: 'zh-CN' | 'en-US', key: string): string | undefined =>
  marketIntelligenceNotificationCopy[language][key]

/** 已按 §28 删除的完成类事件 id；留成字面量才能证明「它真的不在表里」。 */
const REMOVED_READY_EVENT_ID = 'market-intelligence.briefing.ready'

describe('market intelligence notification copy', () => {
  it('has every sentence the 7 declarations point at, in both languages', () => {
    // 缺键的界面直接把键名印给读者，而且不报错——所以这条断言按事件 id + 键 + 语言点名。
    expect(findMissingNotificationEventCopy(marketIntelligenceProductManifest.notificationEvents, lookup)).toEqual([])
  })

  it('leaves no sentence behind for the completion notice it no longer declares', () => {
    // 声明删了、句子留着，就是一句没人能触达的文案：下一次有人「补回声明」时它会让门禁变绿，
    // 于是一条被否决过的通知借着旧句子复活。所以两边一起删。
    for (const language of ['zh-CN', 'en-US'] as const) {
      expect(Object.keys(marketIntelligenceNotificationCopy[language]).filter((key) => key.includes(REMOVED_READY_EVENT_ID))).toEqual([])
    }
  })

  it('names the missing sentences when a completion declaration is put back', () => {
    // 反向用例（Chief 的验收标准：把它改坏，用例必须红）。有人把声明加回来而没写句子，
    // 门禁必须点名这条事件——否则「加回来」是静默的，第二天界面上就会出现一行键名。
    const readded = {
      id: REMOVED_READY_EVENT_ID,
      titleKey: notificationEventTitleKey(REMOVED_READY_EVENT_ID),
      bodyKey: notificationEventBodyKey(REMOVED_READY_EVENT_ID),
      reasonKey: notificationEventReasonKey(REMOVED_READY_EVENT_ID)
    }

    const gaps = findMissingNotificationEventCopy([...marketIntelligenceProductManifest.notificationEvents, readded], lookup)

    // 标题 / 正文 / 理由 × 中英两套 = 6 格全空。
    expect(gaps).toHaveLength(6)
    expect(new Set(gaps.map((gap) => gap.eventTypeId))).toEqual(new Set([REMOVED_READY_EVENT_ID]))
  })

  it('leaves the action label to the platform key instead of inventing a product one', () => {
    // 来源两条要求读者动手，动作标签取平台闭集的「去设置」；产品文案表里不该再有一份同名句子。
    expect(Object.keys(marketIntelligenceNotificationCopy['zh-CN']).some((key) => key.endsWith('.action'))).toBe(false)
    expect(marketIntelligenceNotificationCopy['en-US']).toBeDefined()
  })

  it('claims exactly the two job handlers whose failures this product reports', () => {
    // 少一个 → 一次坏源收两条（平台任务失败 + 本产品来源事件）；多一个 → 平台静默丢一条别人的通知。
    expect([...marketIntelligenceProductManifest.notificationProducerClaims].sort()).toEqual([
      'market-intelligence.collectSource',
      'market-intelligence.dailyBriefing'
    ])
  })

  it('keeps the body variants in step with the declaration', () => {
    const failed = marketIntelligenceProductManifest.notificationEvents.find(
      (event) => event.id === IDS.briefingFailed
    )
    expect(Object.keys(failed?.bodyKeyByVariant ?? {})).toEqual(['not-generated', 'editorial-missing'])
  })
})
