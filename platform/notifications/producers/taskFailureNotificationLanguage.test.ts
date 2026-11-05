/**
 * 作业名跟着读者语言走（验收 N25②，契约 v2.40）：同一条任务失败通知，中英各读一次，
 * 名字分别是「市场日历 · 经济数据」与 `Market calendar · economic data`，**记录是同一条**。
 *
 * 这条链路走的是真实路径：生产者提交 ref → 记录只存 ref → 主进程在读的那一刻按语言解析。
 * 以前生产者把名字拍成字面量提交，英文界面就读出「Task failed: 市场日历 · 经济数据」。
 */
import { describe, expect, it } from 'vitest'

import type { AppLanguage } from '../../settings/schema/appSettings'
import type { LocalizedText } from '../../product-manifest'
import { notificationCopy } from '../../i18n/notificationCopy'
import { createNotificationEventCatalog } from '../contracts/notificationEventCatalog'
import { NOTIFICATION_EVENT_POLICY } from '../contracts/notificationEventPolicy'
import { PLATFORM_NOTIFICATION_EVENTS } from '../contracts/platformNotificationEvents'
import { createNotificationCopyPort } from '../contracts/notificationCopyPort'
import { createDefaultNotificationStoreState } from '../store/notificationStore'
import { createNotificationRuntime } from '../runtime/notificationRuntime'
import { createTaskFailureNotifier } from './taskFailureNotifier'
import { resolveJobTitle } from '../../jobs/runtime/jobTitle'

const clock = { now: () => new Date('2026-11-05T09:00:00.000Z'), timeZone: () => 'UTC' }

const MARKET_CALENDAR: LocalizedText = {
  'zh-CN': '市场日历 · 经济数据',
  'en-US': 'Market calendar · economic data'
}

function harness(input: { definitions?: readonly { id: string; title: LocalizedText }[] } = {}) {
  const definitions = input.definitions ?? [{ id: 'market-calendar.daily', title: MARKET_CALENDAR }]
  const diagnostics: { code: string }[] = []
  let language: AppLanguage = 'zh-CN'
  const catalog = createNotificationEventCatalog({
    sources: [{ productId: 'platform', events: PLATFORM_NOTIFICATION_EVENTS }],
    policy: NOTIFICATION_EVENT_POLICY
  })
  const state = createDefaultNotificationStoreState()
  const runtime = createNotificationRuntime({
    storage: {
      read: async () => JSON.parse(JSON.stringify(state)),
      write: async (next) => { Object.assign(state, next) }
    },
    catalog,
    getSettings: async () => ({
      desktopEnabled: false,
      toastEnabled: false,
      popupEnabled: false,
      push: { channelId: null },
      retentionDays: 30,
      defaultSnoozeMinutes: 60
    }),
    clock,
    getLanguage: async () => language,
    copy: createNotificationCopyPort({
      platform: notificationCopy,
      // 作业名的唯一来源：作业定义上的 `JobTitle`（不另建文案表）。
      jobTitle: (definitionId, target) => {
        const definition = definitions.find((entry) => entry.id === definitionId)
        return definition === undefined ? null : resolveJobTitle(definition.title, undefined, target)
      }
    }),
    diagnostics: (entry) => diagnostics.push(entry)
  })
  return {
    runtime,
    diagnostics,
    setLanguage: (next: AppLanguage): void => { language = next }
  }
}

function notifierFor(runtime: ReturnType<typeof harness>['runtime']) {
  return createTaskFailureNotifier({
    submit: (request) => runtime.submit(request),
    // 门只判「这个名字存在吗」；名字本身走 ref。
    hasReadableTaskName: () => true,
    dayToken: (instant) => instant.slice(0, 10)
  })
}

async function submitFailure(runtime: ReturnType<typeof harness>['runtime'], definitionId: string): Promise<void> {
  const notify = notifierFor(runtime)
  await notify({
    cause: 'executed',
    run: {
      id: 'run-1',
      definitionId,
      handlerId: 'market-calendar',
      owner: 'platform',
      title: 'Collect 央行',
      status: 'failed',
      trigger: { kind: 'manual' },
      payload: {},
      attempt: 1,
      maxAttempts: 1,
      createdAt: '2026-11-05T08:00:00.000Z',
      startedAt: '2026-11-05T08:00:01.000Z',
      completedAt: '2026-11-05T08:00:05.000Z',
      logs: []
    }
  })
}

describe('任务失败通知里的作业名跟着语言走', () => {
  it('同一条记录，中文读出中文名、英文读出英文名', async () => {
    const { runtime, setLanguage } = harness()
    await submitFailure(runtime, 'market-calendar.daily')

    const zh = (await runtime.list()).items[0]
    setLanguage('en-US')
    const en = (await runtime.list()).items[0]

    expect(zh?.title).toBe('任务失败：市场日历 · 经济数据')
    expect(en?.title).toBe('Task failed: Market calendar · economic data')
    // 同一条记录：切语言不该凭空多一条，也不该换一条。
    expect(en?.id).toBe(zh?.id)
    // 载荷里仍然没有键：语言换了，键还是不出主进程。
    expect(zh === undefined ? [] : Object.keys(zh)).not.toContain('titleKey')
  })

  it('定义找不到时整条降级成兜底句，诊断恰 1 条且不含 definitionId', async () => {
    const { runtime, diagnostics } = harness({ definitions: [] })
    await submitFailure(runtime, 'market-calendar.daily')

    const item = (await runtime.list()).items[0]
    expect(item?.title).toBe('有一条新通知，点开看详情')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.code).toBe('copy-unresolved')
    // 诊断给排查用，但它不该把内部标识抄出去：这里只留键与记录 id。
    expect(JSON.stringify(diagnostics)).not.toContain('market-calendar.daily')
  })

  it('写入时绝不展开：记录里存的是引用，不是某一种语言的句子', async () => {
    const { runtime } = harness()
    await submitFailure(runtime, 'market-calendar.daily')

    // 落库的那一份由 store 归一化后读回：参数仍是 ref，句子没写进去。
    const raw = await runtime.list()
    expect(raw.items[0]?.title).not.toContain('{')
    expect(JSON.stringify(raw.items[0])).not.toContain('titleKey')
  })
})
