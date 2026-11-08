/**
 * 动作标签（契约 v2.58）：记录存**引用**，读取那一刻按当前语言解析。
 *
 * 三条判据都是可机械判的，也正是这次要能红的：
 * - 产品动作走 `labelRef`，切语言后同一条**旧记录**的按钮文案跟着变（成品标签做不到这一点）；
 * - 表里没有那个键 → 这条动作**不渲染**，并且留一条 `action-label-unresolved`（带键名与动作 id）；
 * - 老记录只有 `labelKey` 的，照旧按平台表解析——不许因为换了模型让历史通知的按钮消失。
 */
import { describe, expect, it } from 'vitest'

import { notificationCopy } from '../../i18n/notificationCopy'
import type { NotificationContentByLanguage, NotificationRecord } from '../contracts/notificationContracts'
import {
  createNotificationCopyPort,
  type NotificationCopyTableSet
} from '../contracts/notificationCopyPort'
import type { NotificationDiagnosticsEntry } from '../contracts/notificationDiagnostics'
import { createNotificationDelivery } from './notificationRuntimeDelivery'

const clock = { now: () => new Date('2026-11-08T12:00:00.000Z'), timeZone: () => 'UTC' }

const RENDERED: NotificationContentByLanguage = {
  'zh-CN': { title: '日报没生成出来', body: '', reason: '' },
  'en-US': { title: 'The daily briefing did not generate', body: '', reason: '' }
}

const ACTION_KEY = 'notification.action.sample-product.open-briefing'

const PRODUCT_TABLE: NotificationCopyTableSet = {
  'zh-CN': { [ACTION_KEY]: '打开日报' },
  'en-US': { [ACTION_KEY]: 'Open briefing' }
}

function record(overrides: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: 'record-action-1',
    owner: 'market-intelligence',
    sourceId: 'market-intelligence.dailyBriefing',
    eventTypeId: 'market-intelligence.briefing.failed',
    productId: 'market-intelligence',
    delivery: {},
    severity: 'info',
    priority: 'normal',
    channels: ['center'],
    state: 'unread',
    actions: [{
      id: 'open-briefing',
      labelRef: { scope: 'product', productId: 'market-intelligence', key: ACTION_KEY },
      kind: 'open'
    }],
    occurrenceCount: 1,
    rendered: RENDERED,
    createdAt: '2026-11-08T00:00:00.000Z',
    updatedAt: '2026-11-08T00:00:00.000Z',
    ...overrides
  } as NotificationRecord
}

function harness(productTable: NotificationCopyTableSet) {
  const diagnostics: NotificationDiagnosticsEntry[] = []
  const delivery = createNotificationDelivery({
    clock,
    now: () => '2026-11-08T12:00:00.000Z',
    diagnostics: (entry) => diagnostics.push(entry),
    copy: createNotificationCopyPort({ platform: notificationCopy, products: { 'market-intelligence': productTable } })
  })
  return { delivery, diagnostics }
}

describe('动作标签：引用与解析（契约 v2.58）', () => {
  it('the same stored record names its button in the reader’s current language', async () => {
    const { delivery } = harness(PRODUCT_TABLE)
    const zh = await delivery.resolveContent(record(), 'zh-CN')
    const en = await delivery.resolveContent(record(), 'en-US')

    // 记录没变、存的是引用：切语言后历史通知的按钮跟着变，这才是「存引用不存成品」的目的。
    expect(zh.actionLabels['open-briefing']).toBe('打开日报')
    expect(en.actionLabels['open-briefing']).toBe('Open briefing')
  })

  it('a key the product table no longer carries drops that action and says why', async () => {
    const { delivery, diagnostics } = harness({ 'zh-CN': {}, 'en-US': {} })
    const content = await delivery.resolveContent(record(), 'zh-CN')

    // 没有名字的按钮不渲染（不是渲染成空标签）。
    expect(content.actionLabels['open-briefing']).toBeUndefined()
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: 'action-label-unresolved',
      recordId: 'record-action-1',
      eventTypeId: 'market-intelligence.briefing.failed',
      key: ACTION_KEY,
      reason: 'open-briefing',
      language: 'zh-CN'
    }))
  })

  it('reports an unresolved action label once per record, action and language', async () => {
    const { delivery, diagnostics } = harness({ 'zh-CN': {}, 'en-US': {} })
    await delivery.resolveContent(record(), 'zh-CN')
    await delivery.resolveContent(record(), 'zh-CN')

    // 翻页、切语言都会再解析；不去重会把「第一次坏掉」淹在几十条同样的诊断里。
    expect(diagnostics.filter((entry) => entry.code === 'action-label-unresolved')).toHaveLength(1)
  })

  it('keeps resolving a legacy record that only carries the platform key', async () => {
    const { delivery } = harness(PRODUCT_TABLE)
    const content = await delivery.resolveContent(record({
      actions: [{ id: 'open-briefing', labelKey: 'notification.action.open-briefing', kind: 'open' }]
    }), 'zh-CN')

    // v2.58 之前落库的记录存的是平台键：删掉平台那句，这些通知的按钮会凭空消失。
    expect(content.actionLabels['open-briefing']).toBe('打开日报')
  })
})
