import { describe, expect, it } from 'vitest'

import { marketAnalysisTimelineLimits, timelineItemsWithinLimit } from '../../../contracts/marketAnalysisTimelineLimits'
import { sanitizePage } from './marketAnalysisTimelineSanitizers'

/**
 * 一页时间轴的**条目上限**必须是一组自洽的数（2026-11-17 实盘事故的守卫）。
 *
 * 事故：仓库一页 50 条 + 首页补进 20 条「正在解析/失败」= 70 条，而渲染侧只认 50 条 →
 * `sanitizePage` 整页拒绝 → 界面读到 `read-failed`，读者看到「读取失败」，库里却有 389 行。
 * 三处各写各的一半，拼起来必然踩中；所以数字只在 `contracts/marketAnalysisTimelineLimits` 定义，
 * 这里钉三件事：三者自洽、渲染侧接受正好这么多、多一条就拒。
 */
function entry(index: number, status = 'published'): Record<string, unknown> {
  return {
    id: `mi-tl-${index}`, eventGroupId: 'mi-eg-1', analysisRunId: `mi-ar-${index}`, kind: 'analysis',
    status, runKey: `mi-ar-${index}`, failureCode: null, occurredAt: '2026-11-17T12:00:00.000Z',
    summaryRef: status === 'published' ? `mi-as-${index}` : null, safeTitle: status === 'published' ? '标题' : '',
    safeExcerpt: null, version: 1, triggerStatus: null, groupType: null, groupSubject: null
  }
}

const page = (count: number) => ({ schemaVersion: 1, items: Array.from({ length: count }, (_, index) => entry(index)), nextCursor: null })

describe('时间轴一页的条目上限（服务侧与渲染侧同一组数）', () => {
  it('三者自洽：一页 + 首页注入 = 传输上限', () => {
    expect(marketAnalysisTimelineLimits.maximumItems)
      .toBe(marketAnalysisTimelineLimits.pageItems + marketAnalysisTimelineLimits.unpublishedItems)
  })

  it('上限内的一页能过校验——50 条发布行 + 20 条运行不许被拒', () => {
    const mixed = {
      schemaVersion: 1,
      items: [
        ...Array.from({ length: marketAnalysisTimelineLimits.pageItems }, (_, index) => entry(index)),
        ...Array.from({ length: marketAnalysisTimelineLimits.unpublishedItems }, (_, index) => entry(1000 + index, 'running'))
      ],
      nextCursor: null
    }
    expect(mixed.items).toHaveLength(marketAnalysisTimelineLimits.maximumItems)
    expect(sanitizePage(mixed)).toBeDefined()
  })

  it('超过上限一条就整页拒收（顺带上限不是「随便大」）', () => {
    expect(timelineItemsWithinLimit(marketAnalysisTimelineLimits.maximumItems)).toBe(true)
    expect(timelineItemsWithinLimit(marketAnalysisTimelineLimits.maximumItems + 1)).toBe(false)
    expect(sanitizePage(page(marketAnalysisTimelineLimits.maximumItems + 1))).toBeUndefined()
  })
})