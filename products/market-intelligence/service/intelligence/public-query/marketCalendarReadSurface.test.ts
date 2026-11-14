import { describe, expect, it, vi } from 'vitest'

import { createMarketCalendarReadSurface } from './marketCalendarReadSurface'

/**
 * 新鲜度读取失败**必须留下痕迹**。
 *
 * 08:08 那版日报写着「日历不可用」，日志里一条日历相关的行都没有——失败被一个空 `catch {}`
 * 吞掉，事后只能靠猜哪条路径、什么错误。所以这条用例钉的是「日志里有那一行」，不是返回值。
 */
describe('日历读面：失败不许静默', () => {
  it('读取器抛错 → 返回 unavailable，并且日志里能看出路径、错误与 asOf', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const surface = createMarketCalendarReadSurface({
        queryMonth: () => ({ state: 'unavailable', failureCode: 'query-unavailable' }),
        readCollectionFreshness: async () => { throw new Error('job-store-unavailable') }
      })
      await expect(surface.freshness()).resolves.toEqual({ state: 'unavailable', failureCode: 'query-unavailable' })
      expect(warn).toHaveBeenCalledTimes(1)
      const line = String(warn.mock.calls[0]?.[0] ?? '')
      expect(line).toContain('readCollectionFreshness')
      expect(line).toContain('job-store-unavailable')
      expect(line).toMatch(/asOf=\d{4}-\d{2}-\d{2}T/)
    } finally { warn.mockRestore() }
  })

  it('返回形状合同不认 → 也留一行（与抛错分开说，修法不同）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const surface = createMarketCalendarReadSurface({
        queryMonth: () => ({ state: 'unavailable', failureCode: 'query-unavailable' }),
        readCollectionFreshness: async () => ({ state: 'available' })
      })
      await expect(surface.freshness()).resolves.toEqual({ state: 'unavailable', failureCode: 'query-unavailable' })
      expect(String(warn.mock.calls[0]?.[0] ?? '')).toContain('形状合同不认')
    } finally { warn.mockRestore() }
  })

  it('没绑定读者（装配缺口）不写日志：那不是运行期失败，是构建期就缺了一半', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const surface = createMarketCalendarReadSurface(undefined)
      await expect(surface.freshness()).resolves.toEqual({ state: 'unavailable', failureCode: 'query-unavailable' })
      expect(warn).not.toHaveBeenCalled()
    } finally { warn.mockRestore() }
  })
})
