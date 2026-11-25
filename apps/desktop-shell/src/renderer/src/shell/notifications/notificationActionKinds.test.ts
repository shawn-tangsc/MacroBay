import { describe, expect, it } from 'vitest'

import {
  NOTIFICATION_ACTION_KINDS,
  type NotificationActionKind,
  type NotificationCenterItem
} from '@platform/notifications/contracts/notificationContracts'

import { notificationActionTarget } from './notificationActionButton'

/**
 * 动作类型的**覆盖守卫**（架构师 2026-11-24 定）。
 *
 * 不要写成「记录里写了动作，界面必须画出来」——`custom` 今天没有消费者，那条一出生就红，
 * 接着一定被放宽。写成闭集覆盖：契约的每个 kind 要么有消费者，要么**登记过「没有消费者」并指向
 * 待办里的一行**。加了新 kind 没人认，这里就红。
 *
 * 另半条判据（「有没有地方可去」与画按钮必须同一份）在 `NotificationCenterDrawer.test.tsx` 里
 * 按行为判：每种 kind 摆一行，`notificationActionTarget` 说有去向 ⇔ 行里真有按钮，且位置与分组一致。
 */
type Coverage =
  | { readonly consumer: string }
  | { readonly registered: string }

const COVERAGE: Readonly<Record<NotificationActionKind, Coverage>> = {
  open: { consumer: 'NotificationCenterDrawer：应用内落点（deeplink → 外壳导航）' },
  'open-external': { consumer: 'NotificationCenterDrawer：isExternalUrl + window.platform.app.openExternal' },
  // 下面四个今天没有任何消费者：中心只画 actions[0]，且只认落点/外链两种。**登记，不假装有**。
  acknowledge: { registered: '待办清单 #79：动作按钮治理（中心只画 actions[0]；这些 kind 无消费者）' },
  dismiss: { registered: '待办清单 #79：动作按钮治理' },
  snooze: { registered: '待办清单 #79：动作按钮治理' },
  custom: { registered: '待办清单 #79：动作按钮治理（分析失败的「重试」要新做一条执行通路）' }
}

/**
 * 造一条只带这个 kind 的记录：**同时给记录级落点**，这样「有目标」与「没目标」的差别只可能来自
 * `notificationActionTarget` 对 kind 的判断——`custom` + 记录级 deeplink 曾经会画出一颗
 * 文案是「重试分析」、点下去却跳转的按钮。
 */
function probeOf(kind: NotificationActionKind): NotificationCenterItem {
  const deeplink = { scope: 'platform' as const, settingsSectionId: 'notifications' }
  return {
    id: `probe-${kind}`,
    owner: 'platform',
    sourceId: 'platform.test',
    title: '探针',
    body: '',
    severity: 'info',
    priority: 'normal',
    channels: ['center'],
    state: 'unread',
    deeplink,
    actions: [{
      id: 'action',
      kind,
      label: '动作',
      ...(kind === 'open-external' ? { url: 'https://example.test/a' } : { deeplink })
    }],
    occurrenceCount: 1,
    createdAt: '2026-11-24T00:00:00.000Z',
    updatedAt: '2026-11-24T00:00:00.000Z'
  } as NotificationCenterItem
}

describe('通知动作类型的覆盖', () => {
  it('契约里每个 kind 都在覆盖表里（新增 kind 忘记认领 → 这条红）', () => {
    expect(Object.keys(COVERAGE).sort()).toEqual([...NOTIFICATION_ACTION_KINDS].sort())
  })

  it('每一条都说清「谁消费」或「登记在哪」，不许留空占位', () => {
    for (const [kind, entry] of Object.entries(COVERAGE)) {
      const text = 'consumer' in entry ? entry.consumer : entry.registered
      expect(text.trim().length, `${kind} 的覆盖说明是空的`).toBeGreaterThan(0)
    }
  })

  it('谁说有消费者，由**抽屉的真实判断**说了算（谎报 consumer 即红）', () => {
    // 不手写「哪几种有消费者」的名单：拿每条 kind 的探针去问抽屉自己，只有问出「有去向」的才算。
    const consuming = NOTIFICATION_ACTION_KINDS.filter((kind) => notificationActionTarget(probeOf(kind)) !== undefined)
    const claimed = (Object.entries(COVERAGE) as [NotificationActionKind, Coverage][])
      .filter(([, entry]) => 'consumer' in entry)
      .map(([kind]) => kind)
    expect(consuming.sort()).toEqual(claimed.sort())
  })

  it('没有消费者的 kind 不许借着记录级落点画画：custom + deeplink 仍然没有去向', () => {
    // 真实缺口形状：`custom` 的文案是「重试分析」，退到记录级落点就会画出一颗点了却跳转的按钮。
    for (const kind of NOTIFICATION_ACTION_KINDS) {
      if (kind === 'open' || kind === 'open-external') continue
      expect(notificationActionTarget(probeOf(kind)), `${kind} 不该产出目标`).toBeUndefined()
    }
  })

  it('「没有消费者」必须指向待办里的一行，不能只说「以后做」', () => {
    for (const [kind, entry] of Object.entries(COVERAGE)) {
      if ('registered' in entry) expect(entry.registered, `${kind} 没写待办行号`).toMatch(/#\d+/)
    }
  })
})
