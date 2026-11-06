import { describe, expect, it } from 'vitest'

import { createNotificationCopyPort } from '@platform/notifications/contracts/notificationCopyPort'
import { createNotificationEventCatalog } from '@platform/notifications/contracts/notificationEventCatalog'
import { NOTIFICATION_EVENT_POLICY } from '@platform/notifications/contracts/notificationEventPolicy'
import { PLATFORM_NOTIFICATION_EVENTS } from '@platform/notifications/contracts/platformNotificationEvents'
import { notificationCopy } from '@platform/i18n/notificationCopy'

import { marketIntelligenceNotificationCopy } from '../../../desktop/shared/i18n/text/notifications'
import { marketIntelligenceProductManifest } from '../../../product.manifest'
import { moduleSignalPolicy, type ModuleSignal } from '../../../contracts/moduleSignal'
import { buildEtfOutflowSignalRequest } from './etfOutflowNotifier'
import { buildOpenInterestSignalRequest } from './openInterestSignalNotifier'
import { etfFlowPolicy } from '../../../contracts/etfFlows'
import { buildEtfOutflowSignal } from './etfOutflowSignal'

/**
 * 信号通知的**句子层**：数字按语言格式化、标题以资产名开头、加剧走同一事件的变体。
 *
 * 这里刻意走真实的文案端口与真实 manifest 声明：只断言「提交里的参数对不对」证明不了读者
 * 看到什么；而只断言「生成出来的句子对」又证明不了句子跟着参数走。两边都跑一次。
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

function resolveTitle(request: ReturnType<typeof buildEtfOutflowSignalRequest>, language: 'zh-CN' | 'en-US'): string | null {
  return port.resolve(
    { scope: 'product', productId: 'market-intelligence', key: signalEntry.titleKey, params: request!.titleParams },
    language
  )
}

function resolveBody(request: ReturnType<typeof buildEtfOutflowSignalRequest>, language: 'zh-CN' | 'en-US'): string | null {
  const key = signalEntry.bodyKeyByVariant?.[request!.bodyVariant ?? '']
  return port.resolve({ scope: 'product', productId: 'market-intelligence', key: key!, params: request!.bodyParams }, language)
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
  it('formats money per language and puts the asset first in the title', () => {
    const request = buildOpenInterestSignalRequest(signal({ severity: 'high', values: { dropPct: -3.4, volumeMultiple: 4.2, notionalUsd: 1_200_000_000 } }))
    expect(resolveTitle(request, 'zh-CN')).toBe('BTC 持仓骤降')
    expect(resolveTitle(request, 'en-US')).toBe('BTC open interest dropped')
    expect(resolveBody(request, 'zh-CN')).toBe('15 分钟跌 3.4%（强阈值 2.5%），成交放大 4.2 倍，规模约 12 亿美元')
    expect(resolveBody(request, 'en-US')).toBe('Down 3.4% in 15 min (strong threshold 2.5%), volume 4.2×, about $1.2B')
  })

  it('uses the base variant with the rule threshold for a medium reading', () => {
    const request = buildOpenInterestSignalRequest(signal())
    expect(resolveBody(request, 'zh-CN')).toBe('15 分钟跌 2.3%（阈值 1.5%），成交放大 3.1 倍，规模约 8.5 亿美元')
    expect(resolveBody(request, 'en-US')).toBe('Down 2.3% in 15 min (threshold 1.5%), volume 3.1×, about $850M')
  })

  it('renders the aggravated ETF title and the threshold multiple from the signal’s own values', () => {
    const rows = [10, -200_000_000, -200_000_000, -200_000_000].map((netFlowUsd, index) => ({
      tradingDate: `2026-08-${String(25 + index).padStart(2, '0')}`,
      netFlowUsd,
      observedAt: `2026-08-${String(25 + index).padStart(2, '0')}T00:00:00.000Z`
    }))
    const etfSignal = buildEtfOutflowSignal({ asset: 'btc', rows, asOf: '2026-09-01T12:00:00.000Z' })!
    expect(etfSignal.severity).toBe('high')
    const request = buildEtfOutflowSignalRequest(etfSignal)
    expect(resolveTitle(request, 'zh-CN')).toBe('BTC ETF 连续净流出')
    expect(resolveBody(request, 'zh-CN')).toBe('净流出 6 亿美元，是阈值的 6 倍')
    expect(resolveBody(request, 'en-US')).toBe('$600M net outflow, 6× the threshold')
    expect(Math.abs(etfSignal.values.thresholdUsd)).toBe(Math.abs(etfFlowPolicy.signalOutflowUsd))
  })

  it('degrades the whole sentence instead of printing NaN or a placeholder', () => {
    const broken = buildOpenInterestSignalRequest(signal({ values: { dropPct: Number.NaN, volumeMultiple: 3.1, notionalUsd: 1e9 } }))
    // 值不合法时干脆不提交，界面不会出现 NaN。
    expect(broken).toBeUndefined()
    const request = buildOpenInterestSignalRequest(signal())
    const withNaN = {
      ...request!,
      bodyParams: { ...request!.bodyParams, multiple: { number: Number.NaN, kind: 'multiple' as const } }
    }
    expect(resolveBody(withNaN, 'zh-CN')).toBeNull()
  })
})
