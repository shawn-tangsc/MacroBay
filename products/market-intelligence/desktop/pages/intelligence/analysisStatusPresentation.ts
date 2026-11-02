import type { StatusPillTone } from '@platform/ui/components/status-pill'

import type { MarketAnalysisTimelineDetail, MarketAnalysisTimelineEntry } from '../../shared/ipc/marketAnalysisTimelineClient'

/** 一条时间轴节点的发布状态。 */
export type AnalysisEntryStatus = MarketAnalysisTimelineEntry['status']

/** 节点里某条预测的验证状态。 */
export type AnalysisPredictionStatus = MarketAnalysisTimelineDetail['predictions'][number]['status']

export type AnalysisStatus = AnalysisEntryStatus | AnalysisPredictionStatus

/**
 * 状态词 → 档位：**全仓唯一一张表**（界面设计 2026-11-02 定，Chief 采纳）。
 *
 * 四个页面（时间轴、最新结论卡、结论详情、详情抽屉）读同一份。同一个词在两处被判成两档，
 * 比不换更糟——那正是这一轮在收的事。
 *
 * 选档回答的只有「这个状态对读者有什么要求」：
 * - `published` / `confirmed`：在正常工作，不用管 → `ok`；
 * - `pending`：还没定论，等它 → `info`；
 * - `stale` / `partially-confirmed` / `insufficient-data`：该看一眼 → `warn`；
 * - `superseded` / `expired` / `invalidated`：已经结束，不需要动作 → `muted`。
 *
 * `invalidated` **不是 `bad`**：红色在这个应用里只表示「出错／读取失败」；「结论已失效」是一个
 * 已经结束的判断，不是应用坏了。标红会让真正的错误不再显眼。
 */
export const ANALYSIS_STATUS_TONE: Record<AnalysisStatus, StatusPillTone> = {
  published: 'ok',
  stale: 'warn',
  superseded: 'muted',
  pending: 'info',
  confirmed: 'ok',
  'partially-confirmed': 'warn',
  invalidated: 'muted',
  expired: 'muted',
  'insufficient-data': 'warn'
}

/**
 * 状态词的点分键。句子仍在 `productText` 里（中英各一份），这里只记位置——
 * 药丸只收键，句子由调用方的 `resolveText` 解析。
 */
export const ANALYSIS_STATUS_KEY: Record<AnalysisStatus, string> = {
  published: 'pages.intelligence.portal.analysisTimeline.status.published',
  stale: 'pages.intelligence.portal.analysisTimeline.status.stale',
  superseded: 'pages.intelligence.portal.analysisTimeline.status.superseded',
  pending: 'pages.intelligence.portal.analysisTimeline.status.pending',
  confirmed: 'pages.intelligence.portal.analysisTimeline.status.confirmed',
  'partially-confirmed': 'pages.intelligence.portal.analysisTimeline.status.partially-confirmed',
  invalidated: 'pages.intelligence.portal.analysisTimeline.status.invalidated',
  expired: 'pages.intelligence.portal.analysisTimeline.status.expired',
  'insufficient-data': 'pages.intelligence.portal.analysisTimeline.status.insufficient-data'
}
