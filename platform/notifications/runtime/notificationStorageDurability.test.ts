import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog, type NotificationEventPolicy } from '../contracts/notificationEventCatalog'
import type { NotificationRuntimeSettings, NotificationSubmitRequest } from '../contracts/notificationContracts'
import { createNotificationJsonStorage } from './notificationRuntime'
import { createNotificationRuntime } from './notificationRuntime'

/**
 * 通知存储的耐久性：这一份 JSON 曾经被写成「完整文档 + 上一版残片」，启动直接崩。
 * 这里钉两件事：坏文件能自愈、并发写不会互相覆盖。
 */
const settings: NotificationRuntimeSettings = {
  desktopEnabled: true,
  toastEnabled: false,
  popupEnabled: false,
  push: { channelId: null },
  retentionDays: 30,
  defaultSnoozeMinutes: 60
}
const clock = { now: () => new Date('2026-11-03T00:00:00.000Z'), timeZone: () => 'UTC' }

const policy: NotificationEventPolicy = {
  'platform.alpha': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false },
  'platform.beta': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false }
}
const catalog = createNotificationEventCatalog({
  policy,
  sources: [
    {
      productId: 'platform',
      events: ['platform.alpha', 'platform.beta'].map((id) => ({
        id,
        titleKey: 'notification.test.title',
        reasonKey: 'notification.test.body',
        requiresUserAction: false,
        requestedDisruptionLevels: [],
        dedupeKeyTemplate: `${id}:{date}`,
        dedupeUnit: 'occurrence' as const,
        notifyOnlyIfSubscribed: false
      }))
    }
  ]
})

function request(eventTypeId: string, date: string): NotificationSubmitRequest {
  return { eventTypeId, dedupeVars: { builder: 'template', vars: { date } }, actions: [], occurredAt: '2026-11-03T00:00:00.000Z' }
}

describe('notification storage durability', () => {
  it('recovers a file that has a second fragment after the document', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'notification-storage-'))
    const file = join(directory, 'notifications.json')
    const complete = JSON.stringify({ records: [], subscriptions: {}, dailyCounters: {}, pushBackoff: {} }, null, 2)
    // 真实事故的形状：完整文档 + 下一份从中间开始的残片。
    await writeFile(file, `${complete}\n\n {"productId": "market-`, 'utf8')

    const state = await createNotificationJsonStorage(file).read()

    expect(state.records).toEqual([])
    const quarantined = (await readdir(directory)).filter((name) => name.startsWith('notifications.json.corrupt-'))
    expect(quarantined).toHaveLength(1)
    // 自愈之后磁盘上是一份干净文档，下一次读取不再走恢复分支。
    await expect(readFile(file, 'utf8')).resolves.toContain('"records": []')

    await rm(directory, { recursive: true, force: true })
  })

  it('keeps both records when two submissions run at the same time', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'notification-storage-'))
    const file = join(directory, 'notifications.json')
    const runtime = createNotificationRuntime({ catalog, clock, getSettings: async () => settings, storage: createNotificationJsonStorage(file) })

    await Promise.all([runtime.submit(request('platform.alpha', '2026-11-03')), runtime.submit(request('platform.beta', '2026-11-03'))])

    const stored = JSON.parse(await readFile(file, 'utf8')) as { records: Array<{ eventTypeId: string }> }
    const ids = stored.records.map((record) => record.eventTypeId).sort()
    // 读—改—写不排队时，后写的那次带着旧底稿整份重写，前一条记录会被抹掉。
    expect(ids).toEqual(['platform.alpha', 'platform.beta'])

    await rm(directory, { recursive: true, force: true })
  })
})
