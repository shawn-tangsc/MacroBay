import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { findActionDirective } from '@platform/notifications/contracts/actionDirective'
import { createNotificationCopyPort } from '@platform/notifications/contracts/notificationCopyPort'
import { createNotificationEventCatalog } from '@platform/notifications/contracts/notificationEventCatalog'
import { NOTIFICATION_EVENT_POLICY } from '@platform/notifications/contracts/notificationEventPolicy'
import { PLATFORM_NOTIFICATION_EVENTS } from '@platform/notifications/contracts/platformNotificationEvents'
import { notificationCopy } from '@platform/i18n/notificationCopy'

import { marketIntelligenceNotificationCopy } from '../../../desktop/shared/i18n/text/notifications'
import { marketIntelligenceProductManifest } from '../../../product.manifest'
import { moduleSignalPolicy, type ModuleSignal } from '../../../contracts/moduleSignal'
import { etfFlowPolicy } from '../../../contracts/etfFlows'
import { buildEtfOutflowSignalRequest } from './etfOutflowNotifier'
import { buildOpenInterestSignalRequest } from './openInterestSignalNotifier'
import { buildEtfOutflowSignal } from './etfOutflowSignal'

/**
 * 信号通知的**句子层**（契约 v2.56）：话由源头说，中英各一份成品，平台只挑一份转发。
 *
 * 这里同时走两条路，因为「换模型」最容易出的两种错各由一条挡住：
 * - 只断言成品对不对，证明不了旧记录还能读出原来那句；
 * - 只断言旧路径，证明不了新记录里真的是成品、而不是又回头让平台拼。
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

const signalEntry = catalog.get('market-intelligence.signal.triggered')!

/** 旧记录（键 + 参数）怎么读；新记录不传这些字段，只用来做「逐字相同」的对照。 */
function legacySentence(paramsAt: {
  titleParams: NonNullable<ReturnType<typeof buildEtfOutflowSignalRequest>>['titleParams']
  bodyVariant: string
  bodyParams: NonNullable<ReturnType<typeof buildEtfOutflowSignalRequest>>['bodyParams']
}, language: 'zh-CN' | 'en-US'): { title: string | null; body: string | null } {
  const bodyKey = signalEntry.bodyKeyByVariant?.[paramsAt.bodyVariant]
  return {
    title: port.resolve(
      { scope: 'product', productId: 'market-intelligence', key: signalEntry.titleKey, params: paramsAt.titleParams },
      language
    ),
    body: port.resolve(
      { scope: 'product', productId: 'market-intelligence', key: bodyKey!, params: paramsAt.bodyParams },
      language
    )
  }
}

function signal(overrides: Partial<ModuleSignal> = {}): ModuleSignal {
  return {
    version: moduleSignalPolicy.version,
    moduleId: 'open-interest',
    ruleId: 'oi-liquidation-proxy',
    asset: 'btc',
    severity: 'medium',
    observedAt: '2026-11-03T10:15:00.000Z',
    cadence: Object.freeze({ kind: 'intraday' as const, bucketMs: 15 * 60_000 }),
    values: { dropPct: -2.3, volumeMultiple: 3.1, notionalUsd: 850_000_000 },
    dedupeKey: 'module-signal:OI:oi-liquidation-proxy:BTC',
    readiness: 'available',
    triggerOwner: 'module-signal',
    ...overrides
  }
}

describe('signal notification sentences', () => {
  it('has exactly one way to vary a title: the headline sheet', () => {
    // 标题分档只走句子表里的 `headline` 一行。生产者若同时用平台标题变体，就会出现两套机制、
    // 下次改标题漏一处——这条扫描把第二套挡在门外。
    const dir = join(process.cwd(), 'products/market-intelligence/service/intelligence/signals')
    const offenders = readdirSync(dir)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .filter((name) => /titleVariant|titleKeyByVariant/.test(readFileSync(join(dir, name), 'utf8')))
    expect(offenders).toEqual([])
  })

  it('carries both languages in one submission and puts the asset first', () => {
    const request = buildOpenInterestSignalRequest(signal())
    const rendered = request?.rendered
    expect(rendered).toBeDefined()
    expect(rendered!['zh-CN']!.title).toBe('BTC 多头爆仓')
    expect(rendered!['en-US']!.title).toBe('BTC long liquidations')
    // 两份都在：只给一份就把语言钉死在提交那一刻，切语言后历史通知不会跟着变。
    expect(Object.keys(rendered!).sort()).toEqual(['en-US', 'zh-CN'])
    // 三段都要非空，`reason` 也走成品（手机上它与正文一起发）。
    for (const language of ['zh-CN', 'en-US'] as const) {
      expect(rendered![language]!.title.length).toBeGreaterThan(0)
      expect(rendered![language]!.body.length).toBeGreaterThan(0)
      expect(rendered![language]!.reason.length).toBeGreaterThan(0)
    }
  })

  /** 空头那条：数字格式化只出绝对值，正负号由「涨」这个词承担。 */
  const shortSignal = (overrides: Partial<ModuleSignal> = {}): ModuleSignal =>
    signal({
      ruleId: 'oi-short-liquidation-proxy',
      values: { dropPct: -1.8, volumeMultiple: 3.1, notionalUsd: 850_000_000, priceChangePct: 1.8 },
      ...overrides
    })

  it('names the short side in both languages, and quotes the rise rather than the fall', () => {
    // 方向接反时字面上仍是一条通顺的句子——所以两侧各写一条，标题、动词、数字都要各自钉住。
    const request = buildOpenInterestSignalRequest(shortSignal())
    expect(request?.rendered?.['zh-CN']!.title).toBe('BTC 空头爆仓')
    expect(request?.rendered?.['en-US']!.title).toBe('BTC short liquidations')
    expect(request?.rendered?.['zh-CN']!.body).toContain('涨 1.8%')
    expect(request?.rendered?.['zh-CN']!.body).not.toContain('跌')
    expect(request?.rendered?.['en-US']!.body).toContain('up 1.8%')
    expect(request?.rendered?.['en-US']!.body).not.toMatch(/down|fell/iu)
  })

  it('never lets the two sides share one sentence', () => {
    const long = buildOpenInterestSignalRequest(signal())
    const short = buildOpenInterestSignalRequest(shortSignal())
    for (const language of ['zh-CN', 'en-US'] as const) {
      expect(short!.rendered![language]!.title).not.toBe(long!.rendered![language]!.title)
      expect(short!.rendered![language]!.body).not.toBe(long!.rendered![language]!.body)
    }
  })

  it('switches the short side to its aggravated wording too', () => {
    const request = buildOpenInterestSignalRequest(shortSignal({
      severity: 'high',
      values: { dropPct: -2.7, volumeMultiple: 3.4, notionalUsd: 850_000_000, priceChangePct: 2.7 }
    }))
    expect(request?.rendered?.['zh-CN']!.title).toBe('BTC 空头爆仓加剧')
    expect(request?.rendered?.['zh-CN']!.body).toContain('强阈值 2.5%')
  })

  it('refuses to build a short sentence out of a fall', () => {
    // 绝对值格式化会把 -1.8 印成「涨 1.8%」——一句话把读者送到反方向。拼不出就不发。
    expect(buildOpenInterestSignalRequest(shortSignal({
      values: { dropPct: -1.8, volumeMultiple: 3.1, notionalUsd: 850_000_000, priceChangePct: -1.8 }
    }))).toBeUndefined()
  })

  it('switches the aggravated title and reads the threshold multiple from the signal’s own values', () => {
    const rows = [10, -200_000_000, -200_000_000, -200_000_000].map((netFlowUsd, index) => ({
      tradingDate: `2026-08-${String(25 + index).padStart(2, '0')}`,
      netFlowUsd,
      observedAt: `2026-08-${String(25 + index).padStart(2, '0')}T00:00:00.000Z`
    }))
    const etfSignal = buildEtfOutflowSignal({ asset: 'btc', rows, asOf: '2026-09-01T12:00:00.000Z' })!
    expect(etfSignal.severity).toBe('high')
    const request = buildEtfOutflowSignalRequest(etfSignal)
    expect(request?.rendered?.['zh-CN']!.title).toBe('BTC ETF 净流出加剧')
    expect(request?.rendered?.['zh-CN']!.body).toBe('净流出 6 亿美元，是阈值的 6 倍（截至 08-28 交易日）')
    expect(request?.rendered?.['en-US']!.body).toBe('$600M net outflow, 6× the threshold (as of the 08-28 trading day)')
    expect(Math.abs(etfSignal.values.thresholdUsd)).toBe(Math.abs(etfFlowPolicy.signalOutflowUsd))
  })

  it('takes the threshold from the rule constant rather than from the sentence', () => {
    const request = buildOpenInterestSignalRequest(signal({ severity: 'high' }), {
      dropPct: -1.5,
      strongDropPct: -9.9
    })
    expect(request?.rendered?.['zh-CN']!.body).toContain('强阈值 9.9%')
    expect(request?.rendered?.['en-US']!.body).toContain('strong threshold 9.9%')
  })

  it('never lets an internal id, a bare placeholder or an action word into the sentence', () => {
    // 平台对成品「只拦不改」：真带上这些，整条会被换成兜底句——所以源头自己先挡住。
    const requests = [
      buildOpenInterestSignalRequest(signal({ severity: 'high' })),
      buildOpenInterestSignalRequest(signal()),
      buildEtfOutflowSignalRequest(
        buildEtfOutflowSignal({
          asset: 'eth',
          rows: [10, -40_000_000, -50_000_000, -60_000_000].map((netFlowUsd, index) => ({
            tradingDate: `2026-08-${String(25 + index).padStart(2, '0')}`,
            netFlowUsd,
            observedAt: `2026-08-${String(25 + index).padStart(2, '0')}T00:00:00.000Z`
          })),
          asOf: '2026-09-01T12:00:00.000Z'
        })!
      )
    ]
    for (const request of requests) {
      for (const language of ['zh-CN', 'en-US'] as const) {
        const parts = [
          request!.rendered![language]!.title,
          request!.rendered![language]!.body,
          request!.rendered![language]!.reason
        ]
        for (const part of parts) {
          expect(part).not.toMatch(/\{\w+\??\}/u)
          expect(part).not.toMatch(/oi-liquidation-proxy|open-interest|etf-outflow-3d|market-intelligence/u)
          // 判定只有一处：源头自己先过平台那条判据，别在这里写第二张词表。
          expect(findActionDirective(part)).toBeNull()
        }
      }
    }
  })

  it('does not ask the copy port to assemble anything: the sentence is already finished', () => {
    // 新记录的判据是「解析端口零调用」——否则「兼容」会变成两套都在跑，改文案时一半新一半旧。
    const spy = vi.fn(() => ({ text: null, missingParams: [] }))
    const original = port.resolveDetailed
    ;(port as { resolveDetailed: typeof original }).resolveDetailed = spy
    try {
      buildOpenInterestSignalRequest(signal({ severity: 'high' }))
      buildEtfOutflowSignalRequest(
        buildEtfOutflowSignal({
          asset: 'btc',
          rows: [10, -40_000_000, -50_000_000, -60_000_000].map((netFlowUsd, index) => ({
            tradingDate: `2026-08-${String(25 + index).padStart(2, '0')}`,
            netFlowUsd,
            observedAt: `2026-08-${String(25 + index).padStart(2, '0')}T00:00:00.000Z`
          })),
          asOf: '2026-09-01T12:00:00.000Z'
        })!
      )
    } finally {
      ;(port as { resolveDetailed: typeof original }).resolveDetailed = original
    }
    expect(spy).not.toHaveBeenCalled()
  })

  it('says exactly what the key-and-params path says, so history and new records cannot drift', () => {
    // 换模型不许让同一件事出现两种说法：成品与旧路径逐字相同。旧记录过保留期后这份对照可以删，
    // 在那之前它是「历史通知没变味」的唯一证据。
    const request = buildOpenInterestSignalRequest(signal({ severity: 'high', values: { dropPct: -3.4, volumeMultiple: 4.2, notionalUsd: 1_200_000_000 } }))!
    for (const language of ['zh-CN', 'en-US'] as const) {
      const legacy = legacySentence({
        titleParams: {
          asset: 'BTC',
          headline: {
            ref: {
              scope: 'product',
              productId: 'market-intelligence',
              key: 'notification.event.market-intelligence.signal.triggered.headline.oiLongAggravated'
            }
          }
        },
        bodyVariant: 'oiLongAggravated',
        bodyParams: {
          dropPct: { number: -3.4, kind: 'pct' },
          strongPct: { number: -2.5, kind: 'pct' },
          multiple: { number: 4.2, kind: 'multiple' },
          notional: { number: 1_200_000_000, kind: 'usd' }
        }
      }, language)
      expect(request.rendered![language]!.title).toBe(legacy.title)
      expect(request.rendered![language]!.body).toBe(legacy.body)
    }
  })
})
