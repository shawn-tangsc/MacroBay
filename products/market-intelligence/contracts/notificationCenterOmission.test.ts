import { describe, expect, it } from 'vitest'

import {
  allowsCenterOmission,
  createNotificationEventCatalog
} from '@platform/notifications/contracts/notificationEventCatalog'
import {
  PLATFORM_NOTIFICATION_APPROVALS,
  PLATFORM_NOTIFICATION_EVENTS
} from '@platform/notifications/contracts/platformNotificationEvents'

import { marketIntelligenceProductManifest as manifest } from '../product.manifest'

/**
 * 本产品「哪几条可以不写中心」（方案 §4，2026-11-18）。
 *
 * 平台侧只剩**属性判据**（`allowsCenterOmission`）与合成声明用例——平台不许 import 产品代码
 * （`productBoundary` 守卫）。所以「真实批准表里今天到底哪几条不写 center」由这份产品用例钉住：
 * 事实与期望值都在本产品这一侧，平台改动不会替它作证，产品改档也必须在这里同批改。
 *
 * 用户口径：新抓到的舆情**发桌面通知、不进中心**；强度门槛那条**只发手机**。两条都不许进中心，
 * 且都必须满足平台那条判据（提醒类、不要读者动手、一次发生），否则装配期就会拒。
 */
const catalog = createNotificationEventCatalog({
  sources: [
    { productId: 'platform', events: PLATFORM_NOTIFICATION_EVENTS, approval: PLATFORM_NOTIFICATION_APPROVALS },
    {
      productId: 'market-intelligence',
      events: manifest.notificationEvents,
      approval: manifest.notificationApproval
    }
  ]
})

describe('the events this product signs off without a centre record', () => {
  it('only ever lists events the platform property allows, and names the two sentiment ones', () => {
    const omitted = catalog.list().filter((entry) => !entry.approvedDisruptionLevels.includes('center'))
    // eslint-disable-next-line no-console
    console.log('[center-omission] allowed set:', omitted.map((entry) => entry.id).sort())
    // 不钉「今天一共几条」：别的线新增一条合格的提醒类事件不该让这里红。钉的是**属性**——
    // 每一条不写 center 的事件都必须过得了平台那道光，否则装配期就会拒。
    for (const entry of omitted) {
      expect(
        allowsCenterOmission(entry),
        `${entry.id} 不允许省略 center（category=${entry.category}, requiresUserAction=${String(entry.requiresUserAction)}, dedupeUnit=${entry.dedupeUnit}）`
      ).toBe(true)
    }
    expect(omitted.map((entry) => entry.id)).toContain('market-intelligence.news.item-arrived')
    expect(omitted.map((entry) => entry.id)).toContain('market-intelligence.sentiment.alert')
  })

  it('sends the arriving news to the desktop only, and the intensity alert to the phone only', () => {
    // 两条各只说一件事：桌面那条不进手机，手机那条不进桌面。改档要连用户口径一起改。
    expect(catalog.get('market-intelligence.news.item-arrived')?.approvedDisruptionLevels).toEqual(['desktop'])
    expect(catalog.get('market-intelligence.sentiment.alert')?.approvedDisruptionLevels).toEqual(['channel'])
  })

  it('keeps the conclusion and the failure in the centre, so a narrowing cannot quietly drop them', () => {
    // 平台在**收窄路径**上会拒「把 center 撤掉」的提交；这两条正是那条判据的真实样本。
    expect(catalog.get('market-intelligence.analysis.conclusion')?.approvedDisruptionLevels).toEqual(['center', 'channel'])
    expect(catalog.get('market-intelligence.analysis.failed')?.approvedDisruptionLevels).toEqual(['center'])
  })
})