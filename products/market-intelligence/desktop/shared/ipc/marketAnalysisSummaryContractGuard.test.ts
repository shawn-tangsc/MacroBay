import { describe, expect, it } from 'vitest'

import { ANALYSIS_SUMMARY_PERSISTED_KEYS } from '../../../contracts/analysisSummaryFields'
import { analysisOutputTopLevelKeys } from '../../../service/intelligence/analysis/analysisOutputValidator'
import { SUMMARY_OPTIONAL_FIELDS, SUMMARY_REQUIRED_FIELDS, missingSummaryWhitelistKeys } from './marketAnalysisSummaryWhitelist'
import { sanitizeSummary } from './marketAnalysisTimelineSanitizers'

/**
 * **体系守卫**：服务侧落库摘要的顶层键，与渲染端白名单必须逐字对齐。
 *
 * 2026-11-08 的事故是 `divergences` 进了分析结果、读取端白名单没跟上，整条详情被判成
 * 「暂不可用」，而数据完好。2026-11-18 的 P0 是同一类但更隐蔽：`analysisKind` 是**落库时**
 * 加的（模型不输出），而旧守卫只比模型输出的顶层键，所以恒真、永远拦不住。
 *
 * 现在分两条比对：
 * - **落库键表**（`ANALYSIS_SUMMARY_PERSISTED_KEYS`）：从 `keyof AnalysisSummary` 派生，
 *   服务端新增任何持久化字段都会出现在这里；
 * - **模型输出键**（`analysisOutputTopLevelKeys`）：模型可能写进摘要的段。
 */
describe('the summary whitelist matches what a persisted summary may carry', () => {
  it('accepts every key a persisted summary writes (including keys the model never outputs)', () => {
    // 少一个键，读者看到的就是「读取失败」——所以这里是「一个都不能少」。
    expect(missingSummaryWhitelistKeys(ANALYSIS_SUMMARY_PERSISTED_KEYS)).toEqual([])
    // 落库键表必须覆盖服务端真正会写的类别字段，否则这条守卫又会变成只比模型输出。
    expect(ANALYSIS_SUMMARY_PERSISTED_KEYS).toContain('analysisKind')
    expect(ANALYSIS_SUMMARY_PERSISTED_KEYS).toContain('newsInterpretation')
  })

  it('accepts every top-level key the model may add to a summary', () => {
    expect(missingSummaryWhitelistKeys(analysisOutputTopLevelKeys)).toEqual([])
  })

  it('keeps the divergence self-report optional: silence is not disagreement', () => {
    expect(SUMMARY_OPTIONAL_FIELDS).toContain('divergences')
    expect(SUMMARY_REQUIRED_FIELDS).not.toContain('divergences')
  })

  it('reads a market summary with the exact top-level key set the real database published', () => {
    // 真库 `mi-as-49634143…`（2026-11-18 06:11:49 发布）的键集：第一键就是 `analysisKind`。
    const summary = {
      id: 'mi-as-49634143', schemaVersion: 3, analysisKind: 'market', analysisRunId: 'mi-ar-1',
      eventGroupId: 'mi-eg-1', version: 1, proseLanguage: 'zh-CN',
      conclusion: {
        direction: 'range', summary: '市场判断一句。', change: '本次变化一句。', causalChain: '起因 → 机制 → 方向。',
        conditions: [], macro: null, evidenceStrength: null, dataGaps: []
      },
      knownFacts: [], transmissionHypotheses: [], marketReaction: [], supportingEvidence: [], counterEvidence: [],
      scenarios: [], directions: [], nextCatalysts: [], dataCaveats: [], evidenceRefs: ['e1'],
      createdAt: '2026-11-18T06:11:49.123Z'
    }
    expect(sanitizeSummary(summary)).toBeDefined()
  })

  it('reads a news summary that carries its structured record', () => {
    const summary = {
      id: 'mi-as-news', schemaVersion: 1, analysisKind: 'news', analysisRunId: 'mi-ar-news',
      eventGroupId: 'mi-eg-news', version: 1,
      conclusion: {
        direction: 'bearish', summary: '第一段。', change: '第二段。', causalChain: '第三段。',
        conditions: [], macro: null, evidenceStrength: null, dataGaps: []
      },
      knownFacts: [], transmissionHypotheses: [], marketReaction: [], supportingEvidence: [], counterEvidence: [],
      scenarios: [], directions: [], nextCatalysts: [], dataCaveats: [], evidenceRefs: ['e1'],
      newsInterpretation: { analysisKind: 'news', schemaVersion: 1, what: {}, reading: {}, outlook: {}, gaps: [] },
      createdAt: '2026-11-18T06:11:49.123Z'
    }
    // 抽屉只读三段正文；结构化记录必须“认得但不渲染”，不能因为它整条读不出。
    expect(sanitizeSummary(summary)).toBeDefined()
  })
})
