import { describe, expect, it } from 'vitest'

import { findMissingNotificationEventCopy } from '@platform/notifications/contracts/notificationEventCopyGate'

import { marketIntelligenceProductManifest } from '../../../../product.manifest'
import {
  MARKET_INTELLIGENCE_NOTIFICATION_EVENT_IDS as IDS,
  notificationEventActionKey
} from '../../../../contracts/notificationEventKeys'
import { marketIntelligenceNotificationCopy } from './notifications'

const lookup = (language: 'zh-CN' | 'en-US', key: string): string | undefined =>
  marketIntelligenceNotificationCopy[language][key]

describe('market intelligence notification copy', () => {
  it('has every sentence the 8 declarations point at, in both languages', () => {
    // 缺键的界面直接把键名印给读者，而且不报错——所以这条断言按事件 id + 键 + 语言点名。
    expect(findMissingNotificationEventCopy(marketIntelligenceProductManifest.notificationEvents, lookup)).toEqual([])
  })

  it('names the two source actions, because those events require the reader to act', () => {
    for (const eventTypeId of [IDS.sourceConsecutiveFailed, IDS.sourceStale]) {
      for (const language of ['zh-CN', 'en-US'] as const) {
        expect(lookup(language, notificationEventActionKey(eventTypeId)), `${eventTypeId} ${language}`).toBeTruthy()
      }
    }
  })

  it('keeps the body variants in step with the declaration', () => {
    const failed = marketIntelligenceProductManifest.notificationEvents.find(
      (event) => event.id === IDS.briefingFailed
    )
    expect(Object.keys(failed?.bodyKeyByVariant ?? {})).toEqual(['not-generated', 'editorial-missing'])
  })
})
