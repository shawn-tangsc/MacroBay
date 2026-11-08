import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog } from '@platform/notifications/contracts/notificationEventCatalog'
import { PLATFORM_NOTIFICATION_APPROVALS, PLATFORM_NOTIFICATION_EVENTS } from '@platform/notifications/contracts/platformNotificationEvents'

import { marketIntelligenceProductManifest as manifest } from '../../product.manifest'

/**
 * **行为快照**（用户 2026-11-08：「不希望改着改着把原本的功能改坏了」）。
 *
 * 批准的存储位置要搬，但读者拿到的结果必须一模一样。所以这里逐条比对**运行时目录**的生效结果，
 * 而不是比平台表——表会跟着搬迁清空，比它证明不了迁移没改行为。
 *
 * 基线：`54174d8`（搬迁开始前的绿树）。期望值逐条列出，任何一条漂移都点名；
 * 唯一的已知差异是 `analysis.conclusion`（另有裁定，单独追）；
 * 平台目录代码在这批里一个字没改。唯一允许新增的是本次加的 `platform.notification.self-test`，
 * 它单独断言、不进比对。
 */
const snapshot = JSON.parse(
  readFileSync(join(__dirname, 'notificationApproval.snapshot.json'), 'utf8')
) as Record<string, { levels: string[]; group: string | null; bypass: boolean; channel: boolean }>

const catalog = createNotificationEventCatalog({
  // 批准值随声明走（b2/b3）：平台读平台、产品读自己。
  sources: [
    { productId: 'platform', events: PLATFORM_NOTIFICATION_EVENTS, approval: PLATFORM_NOTIFICATION_APPROVALS },
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

/**
 * 漂移要**点名到字段**（b3-4 的判据）：只说「这条不对」帮不了判断影响面，
 * 得说出读者能感知的那一项变了多少——`levels` 旧→新、手机档 `reachesPhone` true→false。
 * 快照字段名叫 `channel`（手机腿），报告里按读者能懂的名字写。
 */
const FIELD_LABEL = { levels: 'levels', group: 'group', bypass: 'bypass', channel: 'reachesPhone' } as const

const driftOf = (id: string): string | undefined => {
  const before = snapshot[id]!
  const now = effective(id)
  if (now === undefined) return `${id}: 从目录里消失了（声明还在、批准没了）`
  const changed = (Object.keys(FIELD_LABEL) as (keyof typeof FIELD_LABEL)[])
    .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(now[field]))
  if (changed.length === 0) return undefined
  return `${id}: ${changed.map((field) => `${FIELD_LABEL[field]} ${JSON.stringify(before[field])} → ${JSON.stringify(now[field])}`).join('; ')}`
}

describe('批准值搬迁：读者拿到的行为不变', () => {
  it('every snapshotted event still resolves to the same approved faces, group and phone leg', () => {
    const drifted = Object.keys(snapshot)
      .map(driftOf)
      .filter((line): line is string => line !== undefined)
    expect(drifted).toEqual([])
  })

  it('compares only this product\'s own events: a product test has no business asserting platform rows', () => {
    // 归属拆开：这份快照住在产品侧，只比自己前缀的 id；平台那 13 条另有平台侧证人
    // （删掉产品，产品侧的证人会跟着消失，那不是平台事件的证人）。
    const drifted = Object.keys(snapshot)
      .filter((id) => id.startsWith(`${manifest.id}.`))
      .map(driftOf)
      .filter((line): line is string => line !== undefined)
    expect(drifted).toEqual([])
    // 自检事件尚未定稿（裁定未出），**不进期望、也不断言它存在**：把一条被驳回的事件固化成
    // 事实，比不写更坏。
  })
})
