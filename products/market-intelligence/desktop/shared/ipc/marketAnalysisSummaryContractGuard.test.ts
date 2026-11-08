import { describe, expect, it } from 'vitest'

import { analysisOutputTopLevelKeys } from '../../../service/intelligence/analysis/analysisOutputValidator'
import { SUMMARY_OPTIONAL_FIELDS, SUMMARY_REQUIRED_FIELDS } from './marketAnalysisTimelineClient'

/**
 * **体系守卫**：服务侧能持久化的顶层键，与渲染端白名单必须逐字对齐。
 *
 * 为什么这条比修一个字段重要：2026-11-08 的事故是 `divergences` 进了分析结果、读取端的白名单没跟上，
 * 于是整条详情被判成「暂不可用」，而数据完好。同类缺陷这已经是第二次（上一次是"证据列表超 50 条
 * 就整份拒"）。以后契约加了字段、读取端没跟上，必须在这里先红。
 *
 * 键表**从服务侧常量读**（`analysisOutputTopLevelKeys`），不在测试里手抄第二份——手抄必然漂移。
 */
describe('the summary whitelist matches what an analysis result may persist', () => {
  it('accepts every top-level key the service may write into a summary', () => {
    const accepted = new Set<string>([...SUMMARY_REQUIRED_FIELDS, ...SUMMARY_OPTIONAL_FIELDS])
    const missing = analysisOutputTopLevelKeys.filter((key) => !accepted.has(key))
    // 少一个键，读者看到的就是「这项数据暂时读不到」——所以这里是「一个都不能少」。
    expect(missing).toEqual([])
  })

  it('keeps the divergence self-report optional: silence is not disagreement', () => {
    // 可选语义是产品与架构师定的：模型不写这一项不算相反，逼它表态等于逼它点头。
    expect(SUMMARY_OPTIONAL_FIELDS).toContain('divergences')
    expect(SUMMARY_REQUIRED_FIELDS).not.toContain('divergences')
  })
})
