import { describe, expect, it } from 'vitest'

import { zeroXRouterCalendarSchedulerFeeds } from './0xrouter-calendar/zeroXRouterCalendarScheduler'
import {
  AUTOMATIC_CALENDAR_FEED_IDS, createEnabledCalendarFeeds, createEnabledZeroXRouterFeeds
} from './enabledCalendarFeeds'

/**
 * 两个启用读取器的**语义边界**（2026-11-16 的事故判据）。
 *
 * 用户重启两次、三路作业一条都没注册，根因就是装配层把「通用自动采集名单」那个读取器
 * 喂给了 0xrouter 调度器：0xrouter 三路**故意不在** `AUTOMATIC_CALENDAR_FEED_IDS` 里，
 * 于是调度器每一路都判成关闭 → `removeSchedule` → 没有作业 → 没有采集 → 标准表零行，
 * 而且一句 warn 都没有（它是「正常地」认为这三路关着）。
 */
const profiles = (entries: readonly { sourceId: string; enabled: boolean }[]) =>
  async () => entries

describe('0xrouter 三路的启用读取器', () => {
  it('不在通用自动采集名单里、但档案里启用 → 必须被读出来（这条就是那次事故）', async () => {
    const all = zeroXRouterCalendarSchedulerFeeds.map((feed) => ({ sourceId: feed.sourceId, enabled: true }))
    // 前提：它们确实不在通用名单里——名单要是变了，这条用例会以「前提不成立」的方式提醒。
    for (const feed of zeroXRouterCalendarSchedulerFeeds) {
      expect(AUTOMATIC_CALENDAR_FEED_IDS).not.toContain(feed.sourceId)
    }
    const readEnabled = createEnabledZeroXRouterFeeds({ listProfiles: profiles(all) })
    expect([...(await readEnabled())].sort()).toEqual(zeroXRouterCalendarSchedulerFeeds.map((feed) => feed.sourceId).sort())
    // 同一个档案喂给通用读取器，一条都读不出来——所以那两个读取器不能互相顶替。
    expect(await createEnabledCalendarFeeds({ listProfiles: profiles(all) })()).toEqual(['macro-calendar-narwhal-economic-data'])
  })

  it('关掉一路就少一路；没建过档案的默认开（「没有档案 ≠ 关掉了」）', async () => {
    const [first, second, third] = zeroXRouterCalendarSchedulerFeeds
    const readEnabled = createEnabledZeroXRouterFeeds({
      listProfiles: profiles([
        { sourceId: first!.sourceId, enabled: false },
        { sourceId: second!.sourceId, enabled: true }
        // 第三条没有档案
      ])
    })
    expect(await readEnabled()).toEqual([second!.sourceId, third!.sourceId])
  })
})