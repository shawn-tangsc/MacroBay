import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog } from '@platform/notifications/contracts/notificationEventCatalog'
import { NOTIFICATION_EVENT_POLICY } from '@platform/notifications/contracts/notificationEventPolicy'
import { PLATFORM_NOTIFICATION_EVENTS } from '@platform/notifications/contracts/platformNotificationEvents'

import { marketIntelligenceProductManifest as manifest } from '../../product.manifest'

/**
 * **行为快照**（用户 2026-11-08：「不希望改着改着把原本的功能改坏了」）。
 *
 * 批准的存储位置要搬，但读者拿到的结果必须一模一样。所以这里逐条比对**运行时目录**的生效结果，
 * 而不是比平台表——表会跟着搬迁清空，比它证明不了迁移没改行为。
 *
 * 期望值取自搬迁开始前的绿树（`0a2922b` 之后、这批改动之前），由同一段目录装配代码导出；
 * 平台目录代码在这批里一个字没改。唯一允许新增的是本次加的 `platform.notification.self-test`，
 * 它单独断言、不进比对。
 */
const snapshot = JSON.parse(
  readFileSync(join(__dirname, 'notificationApproval.snapshot.json'), 'utf8')
) as Record<string, { levels: string[]; group: string | null; bypass: boolean; channel: boolean }>

const catalog = createNotificationEventCatalog({
  policy: NOTIFICATION_EVENT_POLICY,
  sources: [
    { productId: 'platform', events: PLATFORM_NOTIFICATION_EVENTS },
    {
      productId: manifest.id,
      events: manifest.notificationEvents ?? [],
      ...(manifest.notificationApproval === undefined ? {} : { approval: manifest.notificationApproval })
    }
  ]
})

const effective = (id: string) => {
  const entry = catalog.get(id)
  if (entry === undefined) return undefined
  return {
    levels: [...entry.approvedDisruptionLevels].sort(),
    group: entry.surfaceGroup ?? null,
    bypass: entry.approvedBypassQuietHours === true,
    channel: entry.approvedDisruptionLevels.includes('channel')
  }
}

describe('批准值搬迁：读者拿到的行为不变', () => {
  it('every snapshotted event still resolves to the same approved faces, group and phone leg', () => {
    const drifted: string[] = []
    for (const id of Object.keys(snapshot)) {
      if (JSON.stringify(effective(id)) !== JSON.stringify(snapshot[id])) drifted.push(id)
    }
    expect(drifted).toEqual([])
  })

  it('the only addition is the platform self-test event, and it reaches the phone', () => {
    const added = catalog.list().map((entry) => entry.id).filter((id) => snapshot[id] === undefined)
    expect(added).toEqual(['platform.notification.self-test'])
    expect(effective('platform.notification.self-test')?.channel).toBe(true)
  })
})
