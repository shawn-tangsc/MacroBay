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

  it('缺一种语言 → rejected: copy-missing，且一条记录都不写', async () => {
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
})
