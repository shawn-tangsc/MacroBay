/**
 * 成品句子（契约 v2.56）：记录存三种语言的成品，平台只挑一份、只拦不改。
 *
 * 这一版的关键判据都在这里，且都是可机械判的：
 * - **老记录**（键 + 参数）照旧按语言解析，不许因为换模型变成兜底句；
 * - **新记录**直接取成品，**解析端口零调用**——否则「兼容」会悄悄变成「两套都在跑」；
 * - **挑选顺序**（Chief 2026-11-06 拍定）：① `edition.locale` 那一份存在就用它 → ② 否则读者当前语言 →
 *   ③ 都没有才兜底。**没有 `edition` 不算「挑不到」**，只是落到第②步（信号这类事件永远没有期次）。
 * - **源头没拼完**走回执 `rejected: copy-missing`，**不落库**；
 * - 成品里出现裸键 / 花括号 / 动作词时**整条按不可发处理（兜底句）**，不许替它改词。
 */
import { describe, expect, it, vi } from 'vitest'

import {
  createDefaultNotificationRuntimeSettings,
  type NotificationContentByLanguage,
  type NotificationRecord
} from '../contracts/notificationContracts'
import { createNotificationEventCatalog } from '../contracts/notificationEventCatalog'
import { notificationCopy } from '../../i18n/notificationCopy'
import { createNotificationCopyPort } from '../contracts/notificationCopyPort'
import { createDefaultNotificationStoreState } from '../store/notificationStore'
import { createNotificationDelivery } from './notificationRuntimeDelivery'
import { createNotificationRuntime } from './notificationRuntime'

const clock = { now: () => new Date('2026-11-06T12:00:00.000Z'), timeZone: () => 'UTC' }

function record(overrides: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: 'record-rendered-1',
    owner: 'platform',
    sourceId: 'platform.test',
    eventTypeId: 'platform.test',
    delivery: {},
    severity: 'info',
    priority: 'normal',
    channels: ['center'],
    state: 'unread',
    actions: [],
    occurrenceCount: 1,
    createdAt: '2026-11-06T00:00:00.000Z',
    updatedAt: '2026-11-06T00:00:00.000Z',
    ...overrides
  } as NotificationRecord
}

const RENDERED: NotificationContentByLanguage = {
  'zh-CN': { title: '11/06 07:00 中文这一期已经生成。', body: '今天的主导事件是就业。', reason: '你订阅了日报完成提醒。' },
  'en-US': { title: 'The 11/06 07:00 English edition is ready.', body: 'Jobs led the day.', reason: 'You subscribed to briefing-ready notices.' }
}

function harness(language: 'zh-CN' | 'en-US') {
  const diagnostics: { code: string }[] = []
  const port = createNotificationCopyPort({ platform: notificationCopy })
  const resolveDetailed = vi.spyOn(port, 'resolveDetailed')
  const delivery = createNotificationDelivery({
    clock,
    now: () => '2026-11-06T12:00:00.000Z',
    getLanguage: async () => language,
    diagnostics: (entry) => diagnostics.push(entry),
    copy: port
  })
  return { delivery, diagnostics, resolveDetailed }
}

describe('新形状：成品句子只挑不拼', () => {
  it('按读者语言挑，且**解析端口零调用**（否则「兼容」变成「两套都在跑」）', async () => {
    const { delivery, resolveDetailed } = harness('en-US')
    const content = await delivery.resolveContent(record({ rendered: RENDERED }))

    expect(content.title).toBe('The 11/06 07:00 English edition is ready.')
    expect(content.body).toBe('Jobs led the day.')
    expect(content.reason).toBe('You subscribed to briefing-ready notices.')
    expect(resolveDetailed).not.toHaveBeenCalled()
  })

  it('① 有 edition 且那一份在 → 用它：中文期 + 英文界面，整条中文', async () => {
    const { delivery } = harness('en-US')
    const content = await delivery.resolveContent(record({
      rendered: { 'zh-CN': RENDERED['zh-CN'] },  // 中文期只交一份
      edition: { editionId: 'edition-1', locale: 'zh-CN' }
    } as Partial<NotificationRecord>))

    expect(content.title).toBe('11/06 07:00 中文这一期已经生成。')
    expect(content.body).toBe('今天的主导事件是就业。')
  })

  it('② 没有 edition 不算「挑不到」：信号这类事件永远没有期次，按读者语言挑', async () => {
    const { delivery, diagnostics } = harness('en-US')
    const content = await delivery.resolveContent(record({
      rendered: RENDERED,
      eventTypeId: 'market-intelligence.signal.triggered'
    }))

    expect(content.title).toBe('The 11/06 07:00 English edition is ready.')
    expect(diagnostics).toEqual([])
  })

  it('③ 两份都没有 → 兜底句 + copy-unresolved，绝不拿另一种语言顶上', async () => {
    const { delivery, diagnostics } = harness('en-US')
    const content = await delivery.resolveContent(record({
      rendered: { 'zh-CN': RENDERED['zh-CN'] },
      edition: { editionId: 'edition-1', locale: 'en-US' }
    } as Partial<NotificationRecord>))

    // 英文界面、记录里只有中文、且记录声明自己是英文期：不许把中文塞进英文句子。
    expect(content.title).toBe('A new notification arrived.')
    expect(diagnostics.map((entry) => entry.code)).toEqual(['copy-unresolved'])
  })
})

describe('平台只拦不改', () => {
  const cases: [string, NotificationContentByLanguage][] = [
    ['花括号占位符', {
      'zh-CN': { title: '任务失败：{taskName}', body: 'x', reason: 'y' },
      'en-US': { title: 'Task failed: {taskName}', body: 'x', reason: 'y' }
    }],
    ['裸键', {
      'zh-CN': { title: 'notification.event.platform.x.title', body: 'x', reason: 'y' },
      'en-US': { title: 'notification.event.platform.x.title', body: 'x', reason: 'y' }
    }],
    ['指向本条通知的动作词', {
      'zh-CN': { title: '日报已完成', body: '11/06 这一期已经生成，点开可以看全文。', reason: 'y' },
      'en-US': { title: 'Daily brief is ready', body: 'The edition is ready — open it for the full text.', reason: 'y' }
    }]
  ]

  it.each(cases)('%s：整条按不可发处理，且**不替它改词**', async (_label, rendered) => {
    const { delivery, diagnostics } = harness('zh-CN')
    const content = await delivery.resolveContent(record({ rendered }))

    expect(content.title).toBe('有一条新通知')
    expect(content.body).toBe('')
    expect(diagnostics.map((entry) => entry.code)).toEqual(['copy-unresolved'])
  })
})

describe('合并成品记录：标题取第一次、正文取最新', () => {
  it('同一键两次提交，正文换成第二版，标题与理由保持第一版', async () => {
    const state = createDefaultNotificationStoreState()
    const catalog = createNotificationEventCatalog({
      policy: { 'platform.merge': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false } },
      sources: [{
        productId: 'platform',
        events: [{
          id: 'platform.merge',
          titleKey: 'notification.taskFailed.title',
          reasonKey: 'notification.taskFailed.body',
          requiresUserAction: false,
          category: 'reminder',
          requestedDisruptionLevels: [],
          dedupeKeyTemplate: 'merge:{id}',
          dedupeUnit: 'condition',
          conditionWindowMs: 86_400_000
        }]
      }]
    })
    const instance = createNotificationRuntime({
      storage: { read: async () => JSON.parse(JSON.stringify(state)), write: async (next) => { Object.assign(state, next) } },
      catalog,
      getSettings: async () => createDefaultNotificationRuntimeSettings(),
      clock,
      getLanguage: async () => 'zh-CN'
    })
    const submit = (body: string) => instance.submit({
      eventTypeId: 'platform.merge',
      producerId: 'platform',
      dedupeVars: { builder: 'template', vars: { id: 'm1' } },
      rendered: {
        'zh-CN': { title: '标题第一次', body, reason: '理由第一次' },
        'en-US': { title: 'First title', body, reason: 'First reason' }
      },
      actions: [],
      occurredAt: '2026-11-06T11:00:00.000Z'
    })

    await submit('正文第一次')
    await submit('正文第二次')

    const stored = state.records[0]
    expect(state.records).toHaveLength(1)
    // 正文取最新
    expect(stored?.rendered?.['zh-CN']?.body).toBe('正文第二次')
    // 标题与理由取第一次（读者靠标题认人）
    expect(stored?.rendered?.['zh-CN']?.title).toBe('标题第一次')
    expect(stored?.rendered?.['zh-CN']?.reason).toBe('理由第一次')
    // 合并后一条记录只有一个正文来源：有 `rendered` 就不许同时挂着老形状的键。
    expect(stored?.rendered).toBeDefined()
    expect(stored?.bodyKey).toBeUndefined()
    expect(stored?.titleKey).toBeUndefined()
    expect(stored?.reasonKey).toBeUndefined()
  })
})

describe('成品在手时不再读键', () => {
  function runtimeWithVariants() {
    const state = createDefaultNotificationStoreState()
    const catalog = createNotificationEventCatalog({
      policy: { 'platform.variant': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false } },
      sources: [{
        productId: 'platform',
        events: [{
          id: 'platform.variant',
          titleKey: 'notification.taskFailed.title',
          bodyKeyByVariant: { failed: 'notification.taskFailed.body', done: 'notification.taskFailed.body' },
          reasonKey: 'notification.taskFailed.body',
          requiresUserAction: false,
          category: 'reminder',
          requestedDisruptionLevels: [],
          dedupeKeyTemplate: 'variant:{id}',
          dedupeUnit: 'occurrence'
        }]
      }]
    })
    const instance = createNotificationRuntime({
      storage: { read: async () => JSON.parse(JSON.stringify(state)), write: async (next) => { Object.assign(state, next) } },
      catalog,
      getSettings: async () => createDefaultNotificationRuntimeSettings(),
      clock,
      getLanguage: async () => 'zh-CN'
    })
    return { instance, records: () => state.records }
  }

  it('声明了正文变体表、但交的是成品且没带 bodyVariant → 照收，不再拒 unknown-body-variant', async () => {
    const { instance, records } = runtimeWithVariants()
    const outcome = await instance.submit({
      eventTypeId: 'platform.variant',
      producerId: 'platform',
      dedupeVars: { builder: 'template', vars: { id: 'v1' } },
      rendered: RENDERED,
      actions: [],
      occurredAt: '2026-11-06T11:00:00.000Z'
    })

    expect(outcome.kind).toBe('accepted')
    const stored = records()[0]
    expect(stored?.rendered?.['zh-CN']?.title).toBe(RENDERED['zh-CN']?.title)
    // 成品在手时记录里**不许**再挂已作废的键（否则同一条记录有两个正文来源）。
    expect(stored?.titleKey).toBeUndefined()
    expect(stored?.bodyKey).toBeUndefined()
    expect(stored?.reasonKey).toBeUndefined()
  })

  it('老形状照旧要求 bodyVariant：声明了变体表而没带 → 仍拒', async () => {
    const { instance, records } = runtimeWithVariants()
    const outcome = await instance.submit({
      eventTypeId: 'platform.variant',
      producerId: 'platform',
      dedupeVars: { builder: 'template', vars: { id: 'v2' } },
      titleParams: { taskName: 'x' },
      actions: [],
      occurredAt: '2026-11-06T11:00:00.000Z'
    })

    expect(outcome).toMatchObject({ kind: 'rejected', reason: 'unknown-body-variant' })
    expect(records()).toHaveLength(0)
  })
})

describe('重投在判定阶段被拒：记录干净，日志留痕', () => {
  it('记录不存在 → 记录不变、日志恰一行且字段齐全（不带句子与参数）', async () => {
    const state = createDefaultNotificationStoreState()
    const diagnostics: { code: string; recordId?: string; reason?: string; step?: string; key?: string }[] = []
    const instance = createNotificationRuntime({
      storage: { read: async () => JSON.parse(JSON.stringify(state)), write: async (next) => { Object.assign(state, next) } },
      catalog: createNotificationEventCatalog({
        policy: {},
        sources: [{ productId: 'platform', events: [] }]
      }),
      getSettings: async () => createDefaultNotificationRuntimeSettings(),
      clock,
      getLanguage: async () => 'zh-CN',
      diagnostics: (entry) => diagnostics.push(entry)
    })

    const before = JSON.stringify(state.records)
    const result = await instance.redeliverPush({ recordId: 'missing', editionId: 'e1', locale: 'zh-CN' })

    expect(result).toMatchObject({ kind: 'rejected', reason: 'redeliver-target-missing' })
    // 记录回答「推过没有」：没调用过通道，一个字节都不该变。
    expect(JSON.stringify(state.records)).toBe(before)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({
      code: 'redeliver-rejected',
      recordId: 'missing',
      reason: 'redeliver-target-missing',
      step: 'target'
    })
    // 日志不是第二个真相：不带句子、不带参数。
    expect(JSON.stringify(diagnostics[0])).not.toContain('notification.')
  })
})

describe('源头没拼完：拒收，不落库', () => {
  function runtime() {
    const state = createDefaultNotificationStoreState()
    const catalog = createNotificationEventCatalog({
      policy: { 'platform.test': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false } },
      sources: [{
        productId: 'platform',
        events: [{
          id: 'platform.test',
          titleKey: 'notification.taskFailed.title',
          reasonKey: 'notification.taskFailed.body',
          requiresUserAction: false,
          category: 'reminder',
          requestedDisruptionLevels: [],
          dedupeKeyTemplate: 'test:{id}',
          dedupeUnit: 'occurrence'
        }]
      }]
    })
    const instance = createNotificationRuntime({
      storage: { read: async () => JSON.parse(JSON.stringify(state)), write: async (next) => { Object.assign(state, next) } },
      catalog,
      getSettings: async () => createDefaultNotificationRuntimeSettings(),
      clock,
      getLanguage: async () => 'zh-CN'
    })
    return { instance, records: () => state.records }
  }

  it('无 edition 时只交一份 → rejected: copy-missing（老行为没被放松改掉）', async () => {
    const { instance, records } = runtime()
    const outcome = await instance.submit({
      eventTypeId: 'platform.test',
      producerId: 'platform',
      dedupeVars: { builder: 'template', vars: { id: 'x' } },
      rendered: { 'zh-CN': RENDERED['zh-CN'] } as NotificationContentByLanguage,
      actions: [],
      occurredAt: '2026-11-06T11:00:00.000Z'
    })

    expect(outcome).toMatchObject({ kind: 'rejected', reason: 'copy-missing' })
    expect(records()).toHaveLength(0)
  })

  it('带 edition.locale 只交那一份 → 通过；英文界面也整条中文', async () => {
    const { instance, records } = runtime()
    const outcome = await instance.submit({
      eventTypeId: 'platform.test',
      producerId: 'platform',
      dedupeVars: { builder: 'template', vars: { id: 'zh-only' } },
      rendered: { 'zh-CN': RENDERED['zh-CN'] },
      edition: { editionId: 'edition-1', locale: 'zh-CN' },
      actions: [],
      occurredAt: '2026-11-06T11:00:00.000Z'
    })

    expect(outcome.kind).toBe('accepted')
    expect(records()).toHaveLength(1)
    // 单语言记录读回来仍是单语言（不是在读的时候被丢掉）。
    expect(records()[0]?.rendered?.['zh-CN']?.title).toBe(RENDERED['zh-CN']?.title)
    expect(records()[0]?.rendered?.['en-US']).toBeUndefined()
  })

  it('英文期只交 en-US → 同样通过（放松是对称的，只放开期次语言那一份）', async () => {
    const { instance, records } = runtime()
    const outcome = await instance.submit({
      eventTypeId: 'platform.test',
      producerId: 'platform',
      dedupeVars: { builder: 'template', vars: { id: 'en-only' } },
      rendered: { 'en-US': RENDERED['en-US'] },
      edition: { editionId: 'edition-2', locale: 'en-US' },
      actions: [],
      occurredAt: '2026-11-06T11:00:00.000Z'
    })

    expect(outcome.kind).toBe('accepted')
    expect(records()[0]?.rendered?.['en-US']?.title).toBe(RENDERED['en-US']?.title)
    expect(records()[0]?.rendered?.['zh-CN']).toBeUndefined()
  })

  it('带 edition.locale 但那一份缺段 → copy-missing，且回执点名缺哪个字段', async () => {
    const { instance, records } = runtime()
    const outcome = await instance.submit({
      eventTypeId: 'platform.test',
      producerId: 'platform',
      dedupeVars: { builder: 'template', vars: { id: 'zh-broken' } },
      rendered: { 'zh-CN': { title: '标题在', body: '', reason: '原因在' }, 'en-US': RENDERED['en-US'] },
      edition: { editionId: 'edition-1', locale: 'zh-CN' },
      actions: [],
      occurredAt: '2026-11-06T11:00:00.000Z'
    })

    expect(outcome).toMatchObject({ kind: 'rejected', reason: 'copy-missing' })
    expect(JSON.stringify(outcome)).toContain('zh-CN.body')
    expect(records()).toHaveLength(0)
  })

  it('edition.locale 不认识 → copy-missing，不许默默当「没有 edition」走读者语言', async () => {
    const { instance, records } = runtime()
    const outcome = await instance.submit({
      eventTypeId: 'platform.test',
      producerId: 'platform',
      dedupeVars: { builder: 'template', vars: { id: 'bad-locale' } },
      rendered: RENDERED,
      edition: { editionId: 'edition-1', locale: 'ja-JP' },
      actions: [],
      occurredAt: '2026-11-06T11:00:00.000Z'
    })

    expect(outcome).toMatchObject({ kind: 'rejected', reason: 'copy-missing' })
    expect(JSON.stringify(outcome)).toContain('edition.locale')
    expect(records()).toHaveLength(0)
  })
})
