import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'


import { findMissingNotificationEventCopy } from '@platform/notifications/contracts/notificationEventCopyGate'

import { OPEN_BRIEFING_ACTION_KEY } from '../../../../contracts/notificationEventKeys'
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

/** 2026-11-04 用户翻案恢复的完成类事件 id：它现在**在**表里，且默认不勾。 */
const READY_EVENT_ID = 'market-intelligence.briefing.ready'

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      sourceFiles(full, found)
      continue
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(full)
  }
  return found
}

describe('market intelligence notification copy', () => {
  it('builds every product event key from the id: no hand-written `notification.event.<product>.` literal', () => {
    // 手写全串的问题不是难看：事件改名时正文跟着变、标题不会，标题静默降级成兜底句而没人报错。
    // 这条守卫把「同一类键两种造法」挡在提交前。
    //
    // **只管产品自己的键**：`notification.event.platform.…` 是平台闭集里的固定成员（动作标签
    // 那几条也在里面），它没有「按产品事件 id 派生」这回事，写字面量就是唯一写法——
    // 把它们也判红，会逼着下一个人把平台键也造一套工厂，那才是第二种造法。
    const offenders = sourceFiles(join(process.cwd(), 'products')).flatMap((file) => {
      const hits = readFileSync(file, 'utf8').match(/'notification\.event\.(?!platform\.)[^']*'/gu) ?? []
      return hits.map((hit) => `${file.replace(`${process.cwd()}/`, '')}: ${hit}`)
    })
    expect(offenders).toEqual([])
  })

  it('has every sentence the 8 declarations point at, in both languages', () => {
    // 缺键的界面直接把键名印给读者，而且不报错——所以这条断言按事件 id + 键 + 语言点名。
    expect(findMissingNotificationEventCopy(marketIntelligenceProductManifest.notificationEvents, lookup)).toEqual([])
  })

  it('declares the completion notice the reader asked back, with all its sentences', () => {
    // 翻案前这条被整条移除；现在它回来了，声明与句子必须同时在——少一边，界面就会印键名或静默不推。
    expect(marketIntelligenceProductManifest.notificationEvents.map((event) => event.id)).toContain(READY_EVENT_ID)
    for (const language of ['zh-CN', 'en-US'] as const) {
      const keys = Object.keys(marketIntelligenceNotificationCopy[language]).filter((key) => key.includes(READY_EVENT_ID))
      // 标题 + 正文 + 理由，三格。
      expect(keys).toHaveLength(3)
    }
  })

  it('still names the missing sentences when a declaration has no copy', () => {
    // 反向用例（Chief 的验收标准：把它改坏，用例必须红）。用一个**没有文案**的声明喂进去，
    // 门禁必须点名它——否则「加一条事件」是静默的，第二天界面上就会出现一行键名。
    const undeclared = {
      id: 'market-intelligence.copy-gate-fixture',
      titleKey: notificationEventTitleKey('market-intelligence.copy-gate-fixture'),
      bodyKey: notificationEventBodyKey('market-intelligence.copy-gate-fixture'),
      reasonKey: notificationEventReasonKey('market-intelligence.copy-gate-fixture')
    }

    const gaps = findMissingNotificationEventCopy([...marketIntelligenceProductManifest.notificationEvents, undeclared], lookup)

    // 标题 / 正文 / 理由 × 中英两套 = 6 格全空。
    expect(gaps).toHaveLength(6)
    expect(new Set(gaps.map((gap) => gap.eventTypeId))).toEqual(new Set([undeclared.id]))
  })

  it('carries the action label of its own buttons, not a second copy of a platform sentence', () => {
    // v2.58 起产品动作的标签住在这里（`notification.action.<productId>.<actionId>`），
    // 平台表里那一行只服务历史记录。句子与搬家前逐字相同，中英各一份。
    expect(marketIntelligenceNotificationCopy['zh-CN'][OPEN_BRIEFING_ACTION_KEY]).toBe('打开日报')
    expect(marketIntelligenceNotificationCopy['en-US'][OPEN_BRIEFING_ACTION_KEY]).toBe('Open briefing')
    // 「去设置」仍是平台动作，产品表不复制它。
    expect(Object.keys(marketIntelligenceNotificationCopy['zh-CN'])).not.toContain('notification.action.open-settings')
  })

  it('is carried by the manifest, so the platform resolves these keys without importing this file', () => {
    // 少这一行不会报错，只会让每条事件文案回退成兜底句并记 copy-unresolved——所以用断言钉住。
    expect(marketIntelligenceProductManifest.notificationCopy).toBe(marketIntelligenceNotificationCopy)
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
