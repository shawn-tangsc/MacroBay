import { describe, expect, it, vi } from 'vitest'

import { createNotificationCopyPort } from '@platform/notifications/contracts/notificationCopyPort'
import { createNotificationEventCatalog } from '@platform/notifications/contracts/notificationEventCatalog'
import { NOTIFICATION_EVENT_POLICY } from '@platform/notifications/contracts/notificationEventPolicy'
import { PLATFORM_NOTIFICATION_EVENTS } from '@platform/notifications/contracts/platformNotificationEvents'
import { notificationCopy } from '@platform/i18n/notificationCopy'

import { marketIntelligenceNotificationCopy } from '../../../desktop/shared/i18n/text/notifications'
import { marketIntelligenceProductManifest } from '../../../product.manifest'
import { buildMacroEventLandedRequest, type MacroEventLanding } from './macroEventLandedNotifier'

/**
 * 宏观落地通知的**句子层**（情报需求 §十二）：哪个国家、哪个指标、高了还是低了，三个数并排。
 *
 * 判据全在这里：国家不许留空、不许印源站 `countryName`；已注册指标查表、自由文本用原文；
 * 口径认得出才写、写不出就不加括号；数字照用源串、不重新格式化。
 */
const catalog = createNotificationEventCatalog({
  policy: NOTIFICATION_EVENT_POLICY,
  sources: [
    { productId: 'platform', events: PLATFORM_NOTIFICATION_EVENTS },
    { productId: 'market-intelligence', events: marketIntelligenceProductManifest.notificationEvents }
  ]
})
const port = createNotificationCopyPort({
  platform: notificationCopy,
  products: { 'market-intelligence': marketIntelligenceNotificationCopy }
})
const entry = catalog.get('market-intelligence.macro.event-landed')!

function landing(overrides: Partial<MacroEventLanding> = {}): MacroEventLanding {
  return {
    eventId: 'US.CPI.RELEASE.2026-M08',
    releaseAt: '2026-09-10T10:00:00.000Z',
    countryCode: 'US',
    title: 'CPI (YoY)',
    actual: '3.1%',
    consensus: '2.9%',
    previous: '3.0%',
    comparison: 'above',
    periodicity: 'yoy',
    ...overrides
  }
}

function render(input: MacroEventLanding, language: 'zh-CN' | 'en-US'): { title: string | undefined; body: string | undefined } {
  const rendered = buildMacroEventLandedRequest(input)!.rendered![language]!
  return { title: rendered.title, body: rendered.body }
}

describe('macro event landed sentences', () => {
  it('names the country, the registered indicator and the direction, with three values in a row', () => {
    const zh = render(landing({ eventNameKey: 'cpi' }), 'zh-CN')
    expect(zh.title).toBe('美国 消费者物价指数（CPI） 高于预期')
    expect(zh.body).toBe('实际 3.1%，预期 2.9%，前值 3.0%（同比）')

    const en = render(landing({ eventNameKey: 'cpi' }), 'en-US')
    expect(en.title).toBe('US CPI above forecast')
    expect(en.body).toBe('Actual 3.1% vs 2.9% forecast; previous 3.0% (YoY)')
  })

  it('shows the code when the country is not in the table, and never leaves the country out', () => {
    const zh = render(landing({ countryCode: 'JP', eventNameKey: undefined, title: 'Initial Jobless Claims', periodicity: undefined }), 'zh-CN')
    // 自由文本走原文（中文界面出现英文指标名是已知欠账，不许用兜底句顶掉）。
    expect(zh.title).toBe('JP Initial Jobless Claims 高于预期')
    expect(zh.title).not.toContain('United States')
    expect(zh.title?.startsWith('JP ')).toBe(true)
  })

  it('translates a free-text title that is in the table, and keeps the raw title when it is not', () => {
    // 表里的自由文本（出处：本机 2026-10 采集到的美国「政府预算」标题）→ 中文名。
    const known = render(
      landing({ countryCode: 'US', title: 'Government Budget (billion USD)(Sep)', periodicity: undefined }),
      'zh-CN'
    )
    expect(known.title).toBe('美国 政府预算（十亿美元） 高于预期')

    // 表外的自由文本 → 原文照用；**整条不许降级成兜底句**（标题里必须还有国家与方向）。
    const unknown = render(
      landing({ countryCode: 'US', title: 'Some Unlisted Release (Sep)', periodicity: undefined }),
      'zh-CN'
    )
    expect(unknown.title).toBe('美国 Some Unlisted Release (Sep) 高于预期')
    expect(unknown.title).not.toBe('有一条新通知')
    expect(unknown.body).not.toBeNull()
  })

  it('switches the sentence when the previous value is missing, with no dash and no empty brackets', () => {
    const zh = render(landing({ previous: undefined }), 'zh-CN')
    expect(zh.body).toBe('实际 3.1%，预期 2.9%，前值没有公布（同比）')
    expect(zh.body).not.toContain('—')
    expect(zh.body).not.toContain('（）')
    expect(zh.body).not.toContain('前值 —')
  })

  it('writes the direction as a word, never as a difference in points', () => {
    const zh = render(landing({ comparison: 'below', eventNameKey: 'cpi' }), 'zh-CN')
    expect(zh.title).toBe('美国 消费者物价指数（CPI） 低于预期')
    expect(zh.title).not.toContain('个百分点')
    expect(zh.body).not.toContain('个百分点')
  })

  it('carries both languages, and never lets an internal id or a bare placeholder into the sentence', () => {
    const request = buildMacroEventLandedRequest(landing({ eventNameKey: 'cpi' }))!
    // 两份都在：只给一份就会把语言钉死在提交那一刻。
    expect(Object.keys(request.rendered!).sort()).toEqual(['en-US', 'zh-CN'])
    for (const language of ['zh-CN', 'en-US'] as const) {
      const parts = request.rendered![language]!
      for (const part of [parts.title, parts.body, parts.reason]) {
        expect(part).not.toMatch(/\{\w+\??\}/u)
        expect(part).not.toMatch(/cpi|macro\.event-landed|market-intelligence/u)
        expect(part).not.toMatch(/点开|打开|查看|click to|tap to/u)
      }
    }
    // 缺预期那条今天不可达（筛选要求可比的一对），骨架留着、不造用例：
    // 结构里必须还在，否则那一天要改的是结构而不是句子。
    expect(entry.bodyKeyByVariant?.noForecast).toBeDefined()
  })

  it('does not ask the copy port to assemble anything: the sentence is already finished', () => {
    // 新记录的判据是「解析端口零调用」——否则「兼容」会变成两套都在跑，改文案时一半新一半旧。
    const spy = vi.fn(() => ({ text: null, missingParams: [] }))
    const original = port.resolveDetailed
    ;(port as { resolveDetailed: typeof original }).resolveDetailed = spy
    try {
      buildMacroEventLandedRequest(landing({ eventNameKey: 'cpi' }))
      buildMacroEventLandedRequest(landing({ previous: undefined }))
    } finally {
      ;(port as { resolveDetailed: typeof original }).resolveDetailed = original
    }
    expect(spy).not.toHaveBeenCalled()
  })

  it('keeps the provider’s own string: no reformatting, no extra percent sign', () => {
    const zh = render(landing({ actual: '3.4', consensus: '1.2M', previous: '250K', periodicity: undefined }), 'zh-CN')
    expect(zh.body).toBe('实际 3.4，预期 1.2M，前值 250K')
    expect(zh.body).not.toContain('%%')
    expect(zh.body).not.toContain('3.40')
  })
})
