import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog } from '@platform/notifications/contracts/notificationEventCatalog'
import type { NotificationRuntimeSettings } from '@platform/notifications/contracts/notificationContracts'
import { PLATFORM_NOTIFICATION_APPROVALS, PLATFORM_NOTIFICATION_EVENTS } from '@platform/notifications/contracts/platformNotificationEvents'
import { createNotificationRuntime, type NotificationStorage } from '@platform/notifications/runtime/notificationRuntime'

import { marketIntelligenceProductManifest } from '../../../product.manifest'
import { notificationEventBodyKey } from '@platform/notifications/contracts/platformNotificationEvents'
import { buildBriefingNoticeRequest, monthDay, notifyDailyBriefing } from './dailyBriefingNotifier'

const NOW = '2026-11-03T00:30:00.000Z'
const DATE = '2026-11-03'
/** 读者翻案恢复的完成类事件（2026-11-04）：它现在在表里，只进中心，读者在情报页勾了才推手机。 */
const READY_EVENT_ID = 'market-intelligence.briefing.ready'

const settings: NotificationRuntimeSettings = {
  desktopEnabled: true,
  toastEnabled: false,
  popupEnabled: false,
  push: { channelId: null },
  retentionDays: 30,
  defaultSnoozeMinutes: 60
}

type StoreState = {
  records: Array<Record<string, unknown>>
  dailyCounters: Record<string, unknown>
  subscriptions: Record<string, unknown>
  pushBackoff: Record<string, unknown>
}

function createRuntime(subscriptions: Record<string, unknown> = {}) {
  let state: StoreState = { records: [], dailyCounters: {}, subscriptions, pushBackoff: {} }
  const storage: NotificationStorage = {
    read: async () => JSON.parse(JSON.stringify(state)),
    write: async (next) => { state = JSON.parse(JSON.stringify(next)) as StoreState }
  }
  const runtime = createNotificationRuntime({
    storage,
    catalog: createNotificationEventCatalog({
      // 断的是产品的批准值 → 读产品自己的签署文件（平台侧只给自己的）。
      sources: [
        { productId: 'platform', events: PLATFORM_NOTIFICATION_EVENTS, approval: PLATFORM_NOTIFICATION_APPROVALS },
        { productId: 'market-intelligence', events: marketIntelligenceProductManifest.notificationEvents, approval: marketIntelligenceProductManifest.notificationApproval }
      ]
    }),
    diagnostics: () => undefined,
    getSettings: async () => settings,
    clock: { now: () => new Date(NOW), timeZone: () => 'UTC' },
    productIds: ['market-intelligence']
  })
  return { runtime, records: () => state.records }
}

describe('daily briefing notifier', () => {
  it('declares the completion notice the reader asked back, keyed by edition, and allowed on the desktop', () => {
    // 声明在表里才是可提交的前提；键带日期、期号与语言——同一天两期各一条。
    // 版本号或生成时刻仍不许混进去，否则同一版次重新生成会被当成新事件重推。
    const ready = marketIntelligenceProductManifest.notificationEvents.find((event) => event.id === READY_EVENT_ID)
    expect(ready).toMatchObject({
      dedupeKeyTemplate: 'briefing-ready:{date}:{periodId}:{locale}',
      dedupeUnit: 'occurrence',
      // 完成类只进中心与（读者勾选的）手机：桌面只对「失败 / 需修正 / 系统状态」开放。
      requestedDisruptionLevels: []
    })

    const catalog = createNotificationEventCatalog({
      sources: [{ productId: 'market-intelligence', events: marketIntelligenceProductManifest.notificationEvents, approval: marketIntelligenceProductManifest.notificationApproval }]
    })
    expect(catalog.has(READY_EVENT_ID)).toBe(true)
    expect(catalog.get(READY_EVENT_ID)?.approvedDisruptionLevels).toContain('center')
    expect(catalog.get(READY_EVENT_ID)?.approvedDisruptionLevels).toContain('desktop')
  })

  it('accepts a completion submission and keeps one row a day, so a same-day regeneration does not repeat it', async () => {
    const { runtime, records } = createRuntime()
    const request = buildBriefingNoticeRequest({ kind: 'ready', date: DATE, periodId: 'period_x', editionId: `${DATE}:en-US:period_x`, locale: 'en-US' }, NOW)

    // 键带日期 + 期号 + 语言：同一天两期各一条；版本号、生成时刻、内容哈希仍不许混进去。
    expect(request).toMatchObject({
      eventTypeId: READY_EVENT_ID,
      producerId: 'market-intelligence.dailyBriefing',
      dedupeVars: { builder: 'template', vars: { date: DATE, periodId: 'period_x', locale: 'en-US' } },
      deeplink: { scope: 'product', productId: 'market-intelligence', pageId: 'daily-briefing' },
      occurredAt: NOW
    })
    expect(JSON.stringify(request.dedupeVars)).not.toMatch(/revision|documentId|hash|generatedAt/)

    await expect(runtime.submit(request)).resolves.toMatchObject({ kind: 'accepted' })
    expect(records()).toHaveLength(1)
    expect(records()[0]).toMatchObject({
      eventTypeId: READY_EVENT_ID,
      dedupeKey: `market-intelligence|briefing-ready:${DATE}:period_x:en-US`,
      occurrenceCount: 1
    })
    // 桌面不弹：声明没有申请桌面档，批准表也不给完成类。
    expect(records()[0]?.delivery ?? {}).not.toHaveProperty('desktop')

    // 同一天重新生成：并入同一条记录（同一次「今天这一期好了」），不新增第二行、不重推。
    const firstRecordId = records()[0]?.id
    await expect(runtime.submit({ ...request, occurredAt: '2026-11-03T01:30:00.000Z' }))
      .resolves.toMatchObject({ kind: 'merged', recordId: firstRecordId })
    expect(records()).toHaveLength(1)
    expect(records()[0]).toMatchObject({
      id: firstRecordId,
      dedupeKey: `market-intelligence|briefing-ready:${DATE}:period_x:en-US`,
      // `occurrence` 粒度：同一条键的重复提交算同一次事件，次数不累加。
      occurrenceCount: 1
    })

    // 同一版次再提交一次仍并进同一行；换成同一天另一期或另一种语言，则是另一条记录。
    expect(runtime.submit({ ...request, occurredAt: '2026-11-03T01:40:00.000Z' }))
      .resolves.toMatchObject({ kind: 'merged', recordId: firstRecordId })
    await runtime.submit(buildBriefingNoticeRequest({ kind: 'ready', date: DATE, periodId: 'period_y', editionId: `${DATE}:en-US:period_y`, locale: 'en-US' }, NOW))
    await runtime.submit(buildBriefingNoticeRequest({ kind: 'ready', date: DATE, periodId: 'period_x', editionId: `${DATE}:zh-CN:period_x`, locale: 'zh-CN' }, NOW))
    expect(records()).toHaveLength(3)
  })

  it('names the two failure bodies by the declared variant and gives the reader the open action', () => {
    // N5 ②：同一 `briefing.failed` 两种文案，不是两个事件；变体名与声明的 `bodyKeyByVariant` 逐字一致。
    const notGenerated = buildBriefingNoticeRequest(
      { kind: 'failed', variant: 'not-generated', date: DATE, periodId: 'default' }, NOW)
    const editorial = buildBriefingNoticeRequest(
      { kind: 'failed', variant: 'editorial-missing', date: DATE, periodId: 'default' }, NOW)

    expect(notGenerated).toMatchObject({
      eventTypeId: 'market-intelligence.briefing.failed',
      producerId: 'market-intelligence.dailyBriefing',
      dedupeVars: { builder: 'template', vars: { date: DATE, period: 'default' } }
    })
    // 成品句子（契约 v2.56）：变体体现在**正文文字**里，不再有 bodyVariant。
    for (const request of [notGenerated, editorial]) expect(request).not.toHaveProperty('bodyVariant')
    expect(notGenerated.rendered?.['zh-CN']?.body).toContain('这一期没有生成出来')
    expect(editorial.rendered?.['zh-CN']?.body).toContain('这一期数据齐了')
    expect(editorial.rendered?.['en-US']?.body).toContain('no interpretation')
    for (const request of [notGenerated, editorial]) {
      expect(request).not.toHaveProperty('dedupeKey')
      expect(request.actions).toEqual([
        expect.objectContaining({
          // 产品动作的标签是**引用**（v2.58）：读取时按当前语言解析，切语言历史记录跟着变。
          labelRef: {
            scope: 'product',
            productId: 'market-intelligence',
            key: 'notification.action.market-intelligence.open-briefing'
          },
          kind: 'open',
          // 动作与整行都指向日报页：壳层按 pageId 解析，产品不自己拼路由。
          deeplink: { scope: 'product', productId: 'market-intelligence', pageId: 'daily-briefing' }
        })
      ])
      expect(request.deeplink).toEqual({ scope: 'product', productId: 'market-intelligence', pageId: 'daily-briefing' })
    }
  })

  it('sends the timezone notice to the settings panel the reader can actually open', () => {
    const request = buildBriefingNoticeRequest({ kind: 'timezone-invalid', date: DATE }, NOW)

    expect(request).toMatchObject({
      eventTypeId: 'market-intelligence.timezone.invalid',
      producerId: 'market-intelligence.dailyBriefing',
      dedupeVars: { builder: 'template', vars: { date: DATE } },
      deeplink: { scope: 'platform', settingsSectionId: 'preferences' },
      actions: [{
        id: 'open-time-zone-settings',
        labelKey: 'notification.action.open-settings',
        kind: 'open',
        deeplink: { scope: 'platform', settingsSectionId: 'preferences' }
      }]
    })
  })

  it('N5: two failures of one edition stay one row, and the body follows the latest run', async () => {
    const { runtime, records } = createRuntime()
    const submit = (request: Parameters<typeof runtime.submit>[0]) => runtime.submit(request)

    const first = await notifyDailyBriefing(submit, { kind: 'failed', variant: 'not-generated', date: DATE, periodId: 'default' }, NOW)
    const second = await notifyDailyBriefing(submit, { kind: 'failed', variant: 'editorial-missing', date: DATE, periodId: 'default' }, '2026-11-03T01:30:00.000Z')

    expect(first).toMatchObject({ kind: 'accepted' })
    expect(second).toMatchObject({ kind: 'merged' })
    expect(records()).toHaveLength(1)
    expect(records()[0]).toMatchObject({
      eventTypeId: 'market-intelligence.briefing.failed',
      dedupeKey: 'market-intelligence|brief-failed:2026-11-03:default',
      occurrenceCount: 2,
      // 正文取最新一次：合并后记录里的成品句子换成第二次提交的那一版。
      rendered: { 'zh-CN': { body: expect.stringContaining('这一期数据齐了') } }
    })
  })

  it('N5: a second day starts a second row — 「only one row per edition」 only means something if two editions give two', async () => {
    // 「同一天只有一行」在通知根本没发出去时也成立，所以必须配这条正向用例：
    // 换一个日期必须出现第 2 行，否则那条断言证明的只是「什么都没发生」。
    const { runtime, records } = createRuntime()
    const submit = (request: Parameters<typeof runtime.submit>[0]) => runtime.submit(request)

    await notifyDailyBriefing(submit, { kind: 'failed', variant: 'not-generated', date: '2026-11-02', periodId: 'default' }, NOW)
    await notifyDailyBriefing(submit, { kind: 'failed', variant: 'not-generated', date: DATE, periodId: 'default' }, NOW)

    expect(records()).toHaveLength(2)
    // 记录按最近时间倒序排列，所以这里排序后比键本身，不依赖存储顺序。
    expect(records().map((record) => record.dedupeKey).sort()).toEqual([
      'market-intelligence|brief-failed:2026-11-02:default',
      'market-intelligence|brief-failed:2026-11-03:default'
    ])
    for (const record of records()) expect(record.occurrenceCount).toBe(1)
  })

  it('N14: repeated detections of an unusable zone stay one centre row and never pop a desktop', async () => {
    const { runtime, records } = createRuntime()

    for (let index = 0; index < 3; index += 1) {
      await notifyDailyBriefing((request) => runtime.submit(request), { kind: 'timezone-invalid', date: DATE }, NOW)
    }

    expect(records()).toHaveLength(1)
    expect(records()[0]).toMatchObject({
      eventTypeId: 'market-intelligence.timezone.invalid',
      dedupeKey: `market-intelligence|timezone-invalid:${DATE}`,
      occurrenceCount: 1
    })
    expect(records()[0]?.delivery ?? {}).not.toHaveProperty('desktop')
  })

  it('does not fail generation when the notification port throws', async () => {
    const notified = await notifyDailyBriefing(() => { throw new Error('notification store unavailable') },
      { kind: 'failed', variant: 'not-generated', date: DATE, periodId: 'default' }, NOW)

    expect(notified).toBeNull()
  })
})

describe('the completion notice names the edition date, never "today"', () => {
  // `02` v2.129 G3：凌晨收到的"今天这一期已经生成"，读者按日历今天去列表里找，找不到。
  // 通知说的必须是**版次日期**：11/06 这一期。
  it('passes the edition day to the copy and keeps the word "today" out of it', () => {
    const request = buildBriefingNoticeRequest(
      { kind: 'ready', date: '2026-11-06', periodId: 'default', editionId: '2026-11-06:zh-CN:default', locale: 'zh-CN' }, NOW)
    // 日期 + 时刻 + 语言：读者按这三样能在列表里精确找到那一版。
    expect(request.rendered?.['zh-CN']?.body).toContain('11/06')
    expect(request.rendered?.['zh-CN']?.body).toContain('中文这一期已经生成')
    // 只交这一期自己的语言一份（契约 v2.56 的例外）；平台按 edition.locale 挑。
    expect(Object.keys(request.rendered ?? {})).toEqual(['zh-CN'])
    expect(request).not.toHaveProperty('bodyParams')
  })

  it('writes the day the way a reader reads a day', () => {
    expect(monthDay('2026-11-06')).toBe('11/06')
    // 不是 ISO 就原样透传，不许在这里编一个日期出来。
    expect(monthDay('not-a-date')).toBe('not-a-date')
  })

  it('says the same for both interface languages: a date, not "today"', async () => {
    const { marketIntelligenceNotificationCopy } = await import('../../../desktop/shared/i18n/text/notifications')
    const key = notificationEventBodyKey(READY_EVENT_ID)
    const zh = marketIntelligenceNotificationCopy['zh-CN'][key]
    const en = marketIntelligenceNotificationCopy['en-US'][key]
    expect(zh).toContain('{date}')
    expect(zh).not.toContain('今天')
    expect(en).toContain('{date}')
    expect(en).not.toContain('Today')
  })
})

describe('the completion notice carries the edition’s own lede', () => {
  const ready = (locale: 'zh-CN' | 'en-US', lede?: string) => buildBriefingNoticeRequest({
    kind: 'ready', date: '2026-11-06', periodId: 'default',
    editionId: `2026-11-06:${locale}:default`, locale, ...(lede === undefined ? {} : { lede })
  }, NOW)

  it('puts the lede after the fact sentence, in the edition’s language, with a blank line between', () => {
    const zh = ready('zh-CN', '今天的主导事件是…')
    expect(zh.rendered?.['zh-CN']?.body).toContain('这一期已经生成。\n\n今天的主导事件是…')
    expect(Object.keys(zh.rendered ?? {})).toEqual(['zh-CN'])

    const en = ready('en-US', 'Today is led by…')
    expect(en.rendered?.['en-US']?.body).toContain('edition is ready.\n\nToday is led by…')
    expect(Object.keys(en.rendered ?? {})).toEqual(['en-US'])
  })

  it('drops the whole paragraph when the lede is empty — no blank line and no placeholder', () => {
    for (const lede of [undefined, '', '   ']) {
      const body = ready('zh-CN', lede).rendered?.['zh-CN']?.body ?? ''
      expect(body).not.toMatch(/\n\n$|暂无导读|无导读/)
      expect(body.trim()).toBe(body)
    }
  })

  it('withholds a lede that carries an action point, and records which sentence was dropped', async () => {
    // 手机上没有可点的地方：命中就整段不发。判定用平台唯一词表。
    const calls: Array<{ level: string; event: string; fields: Record<string, unknown> }> = []
    const { runtime, records } = createRuntime()
    const submit = (request: Parameters<typeof runtime.submit>[0]) => runtime.submit(request)
    await notifyDailyBriefing(submit, {
      kind: 'ready', date: DATE, periodId: 'default',
      editionId: `${DATE}:zh-CN:default`, locale: 'zh-CN', lede: '数据齐了，点开看全文。'
    }, NOW, (level, event, fields) => { calls.push({ level, event, fields: fields ?? {} }) })

    const record = records()[0] as { rendered?: { 'zh-CN'?: { body: string } } } | undefined
    expect(record?.rendered?.['zh-CN']?.body).not.toContain('点开看全文')
    expect(record?.rendered?.['zh-CN']?.body).toContain('这一期已经生成')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.event).toBe('MI_DAILY_BRIEF_LEDE_WITHHELD')
    expect(calls[0]?.fields).toMatchObject({ hit: '点开', editionId: `${DATE}:zh-CN:default` })
  })
})
