import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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
  it('builds every event key from the id: no hand-written `notification.event.` literal', () => {
    // 手写全串的问题不是难看：事件改名时正文跟着变、标题不会，标题静默降级成兜底句而没人报错。
    // 这条守卫把「同一类键两种造法」挡在提交前。
    const offenders = sourceFiles(join(process.cwd(), 'products'))
      .filter((file) => /'notification\.event\./.test(readFileSync(file, 'utf8')))
      .map((file) => file.replace(`${process.cwd()}/`, ''))
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

  it('leaves the action label to the platform key instead of inventing a product one', () => {
    // 来源两条要求读者动手，动作标签取平台闭集的「去设置」；产品文案表里不该再有一份同名句子。
    expect(Object.keys(marketIntelligenceNotificationCopy['zh-CN']).some((key) => key.endsWith('.action'))).toBe(false)
    expect(marketIntelligenceNotificationCopy['en-US']).toBeDefined()
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

  it('never tells the reader to tap something: the push surface has nothing to tap', () => {
    // 动作由界面按钮承担。手机那条是纯文本，写「点开…」就是一句做不到的承诺。
    // 扫的是**最终文案表**，不是模板写法——模板可以改，句子不能骗人。
    // 中文直接挡动作词；英文只挡**祈使/带宾语**的用法：`open interest`、`open orders` 这类
    // 「未平仓 / 未成交」是领域名词，按单词 `open` 挡会把最该保住的那条信号标题判红。
    // 判据是「名词不受影响」，不是「某一句不受影响」——所以这里不摘任何固定短语，靠句法形态判。
    const instructions = [/点开/u, /打开/u, /查看/u, /点击/u, /\btap\b/iu, /\bclick\b/iu, /\bopen\s+(it|this|that|the|your|these|those|them)\b/iu]
    const offenders = (['zh-CN', 'en-US'] as const).flatMap((language) =>
      Object.entries(marketIntelligenceNotificationCopy[language])
        .filter(([, sentence]) => instructions.some((pattern) => pattern.test(sentence)))
        .map(([key, sentence]) => `${language} ${key}: ${sentence}`)
    )
    expect(offenders).toEqual([])

    // 正面样本：专有名词不因这条守卫而需要改。以后出现别的名词（`open orders`）也照样通过。
    for (const noun of ['BTC open interest dropped', 'BTC open orders rose', 'Open interest climbed']) {
      for (const pattern of instructions) expect(noun).not.toMatch(pattern)
    }
  })

  it('keeps the body variants in step with the declaration', () => {
    const failed = marketIntelligenceProductManifest.notificationEvents.find(
      (event) => event.id === IDS.briefingFailed
    )
    expect(Object.keys(failed?.bodyKeyByVariant ?? {})).toEqual(['not-generated', 'editorial-missing'])
  })
})
