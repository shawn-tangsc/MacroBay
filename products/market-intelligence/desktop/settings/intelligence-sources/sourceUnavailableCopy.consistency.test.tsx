import { describe, expect, it } from 'vitest'

import { productText } from '../../shared/i18n/productText'
import { sourceUnavailableSentence } from '../../shared/i18n/sourceUnavailableCopy'

/**
 * 「原因码 → 人话」全仓一张表（`shared/i18n/sourceUnavailableCopy.ts`）。
 *
 * 详情里的「为什么没在采 / 原因码」整块已按用户 2026-11-12 删除——界面不再展示这些事实，
 * 只能看日志/审计。表本身仍只有一处，抽屉目录仍调用它；这里只钉表的语义，不再渲染详情。
 *
 * **接手记录**：`sourceUnavailableCopy.crossSurface.test.tsx`（`94ce806`）随「抽屉与设置页同组件」
 * 删除；此后详情里的那句话也不再存在（本笔），所以「两面对同一码同一句」不再成立，
 * 留下的是「同一码对不同来源类型说不同的话」这条表语义（官方日历 ≠ 市场日历）。
 */
const drawerCopy = productText['zh-CN'].pages.intelligence.portal.dashboard.configDrawer

describe('one reason-code table', () => {
  it('never leaks an unknown code: the caller-supplied fallback is returned unchanged', () => {
    expect(sourceUnavailableSentence('some-unknown-code', drawerCopy.sourceUnavailable)).toBe(drawerCopy.sourceUnavailable)
    expect(sourceUnavailableSentence(undefined, drawerCopy.sourceUnavailable)).toBe(drawerCopy.sourceUnavailable)
  })

  it('says different things to different kinds, and never calls an aggregate an official source', () => {
    const code = 'official-endpoint-returned-403'
    const official = sourceUnavailableSentence(code, drawerCopy.sourceUnavailable, 'official-calendar')
    const market = sourceUnavailableSentence(code, drawerCopy.sourceUnavailable, 'market-calendar')
    const other = sourceUnavailableSentence(code, drawerCopy.sourceUnavailable)
    expect(official).toContain('官方源')
    expect(market).toContain('市场日历源')
    expect(market).not.toContain('官方源')
    expect(other).toContain('这个来源')
    expect(new Set([official, market, other]).size).toBe(3)
  })
})
