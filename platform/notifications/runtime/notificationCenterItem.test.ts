/**
 * 渲染层看到的那一份（落地约束 v1.2 §1 / 验收 N24）：**句子里已经解析好，键与参数不在载荷里**。
 *
 * 这些用例守的是「结构上不可能露键」，不是「记得别露键」：
 * - 载荷里没有 `titleKey`/`bodyKey`/`reasonKey`，渲染层想查表也没有表可查；
 * - 文案解析失败时整条降级成**定稿兜底句**，占位符与键都不许印出来；
 * - `category` 与 `createdAt` 不跟着文案走——降级后它们照旧在，这就是「点开还有东西看」的前提。
 */
import { describe, expect, it } from 'vitest'

import type { NotificationCategory } from '../contracts/notificationEventCatalog'
import type {
  NotificationCenterItem,
  NotificationDiagnosticsEntry,
  NotificationRecord
} from '../contracts/notificationContracts'
import { notificationCopy } from '../../i18n/notificationCopy'
import { createNotificationCopyPort } from '../contracts/notificationCopyPort'
import { createNotificationDelivery } from './notificationRuntimeDelivery'
import { toNotificationCenterItem } from './notificationCenterItem'

const clock = { now: () => new Date('2026-11-05T00:00:00.000Z'), timeZone: () => 'UTC' }

function record(overrides: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: 'record-1',
    owner: 'platform',
    sourceId: 'platform.test',
    eventTypeId: 'platform.test',
    delivery: {},
    titleKey: 'notification.taskFailed.title' as NotificationRecord['titleKey'],
    titleParams: { taskName: '市场日历 · 经济数据' },
    bodyKey: 'notification.taskFailed.body' as NotificationRecord['titleKey'],
    reasonKey: 'notification.taskFailed.body' as NotificationRecord['titleKey'],
    severity: 'info',
    priority: 'normal',
    channels: ['center'],
    state: 'unread',
    actions: [],
    occurrenceCount: 1,
    createdAt: '2026-11-05T00:00:00.000Z',
    updatedAt: '2026-11-05T00:00:00.000Z',
    ...overrides
  }
}

function harness(language: 'zh-CN' | 'en-US' = 'zh-CN'): {
  diagnostics: NotificationDiagnosticsEntry[]
  project: (value: NotificationRecord, category?: NotificationCategory) => Promise<NotificationCenterItem>
} {
  const diagnostics: NotificationDiagnosticsEntry[] = []
  const delivery = createNotificationDelivery({
    clock,
    now: () => '2026-11-05T00:00:00.000Z',
    getLanguage: async () => language,
    diagnostics: (entry) => diagnostics.push(entry),
    // 名字端口只认识一条作业定义：另一条（历史里那台已停的作业）故意解析不到。
    copy: createNotificationCopyPort({
      platform: notificationCopy,
      jobTitle: (definitionId, target) =>
        definitionId === 'market-calendar.daily'
          ? (target === 'en-US' ? 'Market calendar · economic data' : '市场日历 · 经济数据')
          : null
    })
  })
  return {
    diagnostics,
    project: async (value, category) =>
      toNotificationCenterItem(value, await delivery.resolveContent(value), category)
  }
}

describe('渲染层看到的那一份', () => {
  /**
   * 「今天一共发生过 N 次」只在**真的合并过**时出现。
   *
   * 恒出会让每条单发的通知都挂一句「共 1 次」——读者会以为是另一个他没看到的东西。
   * 这一句由主进程解析，渲染层不自己拼数。
   */
  it('只在合并过之后才说「共 N 次」', async () => {
    const single = await harness().project(record({ occurrenceCount: 1 }))
    expect(single.occurrenceLabel).toBeUndefined()

    const merged = await harness().project(record({ occurrenceCount: 3 }))
    expect(merged.occurrenceLabel).toBe('共 3 次')

    const english = await harness('en-US').project(record({ occurrenceCount: 2 }))
    expect(english.occurrenceLabel).toBe('2 occurrences')
  })

  it('句子里没有键：载荷上不存在 titleKey / bodyKey / 参数表', async () => {
    const item = await harness().project(record())

    expect(item.title).toBe('任务失败：市场日历 · 经济数据')
    expect(item.body).toBe('运行过程中出错，这一次没有完成。')
    // 结构判据，不是黑名单：键根本没有出现在载荷上，渲染层无从查表。
    expect(Object.keys(item)).not.toContain('titleKey')
    expect(Object.keys(item)).not.toContain('bodyKey')
    expect(Object.keys(item)).not.toContain('reasonKey')
    expect(Object.keys(item)).not.toContain('titleParams')
    expect(Object.keys(item)).not.toContain('bodyParams')
  })

  it('动作标签是句子，不是 labelKey；解析不出标签的动作整条不出现', async () => {
    const item = await harness().project(record({
      actions: [
        { id: 'open-task', labelKey: 'notification.taskFailed.open' as never, kind: 'open' },
        { id: 'broken', labelKey: 'notification.notInTheTable' as never, kind: 'custom' }
      ]
    }))

    expect(item.actions).toEqual([{ id: 'open-task', label: '打开任务', kind: 'open' }])
  })

  it('解析失败时整条降级成定稿兜底句，占位符与键都不印出来', async () => {
    const { project, diagnostics } = harness()
    const item = await project(record({
      titleKey: 'notification.notInTheTable' as NotificationRecord['titleKey'],
      bodyKey: undefined,
      reasonKey: undefined
    }))

    expect(item.title).toBe('有一条新通知，点开看详情')
    expect(item.body).toBe('')
    expect(item.title).not.toContain('notification.')
    expect(item.title).not.toContain('{')
    expect(diagnostics.map((entry) => entry.code)).toEqual(['copy-unresolved'])
    expect(diagnostics[0]).toMatchObject({
      recordId: 'record-1',
      key: 'notification.notInTheTable',
      language: 'zh-CN'
    })
  })

  it('同一记录重复读只报一次诊断：翻页与切语言不该把日志刷满', async () => {
    const { project, diagnostics } = harness()
    const broken = record({ titleKey: 'notification.notInTheTable' as NotificationRecord['titleKey'] })
    await project(broken)
    await project(broken)
    await project(broken)

    expect(diagnostics).toHaveLength(1)
  })

  it('英文读者拿到英文兜底句：四个表面同一句的英文原文', async () => {
    const item = await harness('en-US').project(record({
      titleKey: 'notification.notInTheTable' as NotificationRecord['titleKey']
    }))

    expect(item.title).toBe('A new notification arrived — open it for details.')
  })

  it('作业名解析不到：标题仍在，动作不被吞（带 deeplink 的通知必须能点开）', async () => {
    const item = await harness().project(record({
      titleKey: 'notification.event.platform.job.failed-terminal.title' as NotificationRecord['titleKey'],
      titleParams: { taskName: { ref: { scope: 'job-title', definitionId: 'job-stopped-yesterday' } } },
      deeplink: { scope: 'platform' },
      actions: [{ id: 'open-task', labelKey: 'notification.taskFailed.open', kind: 'open', deeplink: { scope: 'platform' } }]
    }))

    // ① 参数缺了只丢那一格，不是整条变兜底句。
    expect(item.title).toBe('任务失败')
    // ③ 动作与 deeplink 是结构事实，不跟着文案一起消失。
    expect(item.actions).toEqual([
      { id: 'open-task', label: '打开任务', kind: 'open', deeplink: { scope: 'platform' } }
    ])
    expect(item.deeplink).toEqual({ scope: 'platform' })
  })

  it('缺参数只丢那一格，不拿 `{taskName}` 顶上，结构字段照旧在', async () => {
    const { project, diagnostics } = harness()
    const item = await project(record({ titleParams: {} }), 'needs-action')

    // 分级降级（v2.48）：模板在、参数缺 → 只丢那一格，标题仍是「任务失败」。
    expect(item.title).toBe('任务失败')
    expect(item.title).not.toContain('{')
    // 一行诊断：丢的是哪一格（不新增第三个码）。
    expect(diagnostics.map((entry) => entry.code)).toContain('copy-param-missing')
    // 「点开看详情」不许是空承诺：时间与类型标签不参与文案解析，降级时照旧在。
    expect(item.category).toBe('needs-action')
    expect(item.createdAt).toBe('2026-11-05T00:00:00.000Z')
  })
})
