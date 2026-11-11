import type { MarketAnalysisRunStatus } from '../../shared/ipc/marketAnalysisRunOutcome'

/**
 * 自动会话里「这次运行」卡片的文案。
 *
 * 单独成表，不动 `productText`（那是几万行的共享表，多线同改风险高）。句子只有状态词与
 * 三句事实；**失败原因**复用 `analysisTimeline.failureReasons` 那一张已有的码→人话表，
 * 不在这里另抄一份。
 */
export type MarketAnalysisRunSessionText = Readonly<{
  /** 卡片标题：这一块说的是「这次运行怎么样」。 */
  title: string
  /** 状态词：只有这八档，与运行状态闭集一一对应。 */
  status: Readonly<Record<MarketAnalysisRunStatus, string>>
  /** 没有正文时的那句事实。 */
  noBody: string
  /** 状态不是成功、但失败码没记下来或没登记时的兜底。 */
  reasonUnknown: string
  startedAt: string
  finishedAt: string
  /** 连运行记录都没有（老会话、或记录被清理）。这句是事实，不是错误。 */
  noRecord: string
  /** ⓘ 里的整句说明。 */
  info: string
  infoAria: string
}>

const zh: MarketAnalysisRunSessionText = {
  title: '运行结果',
  status: {
    queued: '排队中',
    running: '正在运行',
    succeeded: '成功',
    'invalid-output': '输出无效',
    failed: '失败',
    cancelled: '已取消',
    stale: '已过期',
    superseded: '已被取代'
  },
  noBody: '这次没有产出正文。',
  reasonUnknown: '原因没有记录。',
  startedAt: '开始',
  finishedAt: '结束',
  noRecord: '这次运行没有留下记录。',
  info: '自动会话每次运行一条。运行没有产出正文时，这里写下它当时的状态、原因和起止时间；原因按运行记录原文翻译，不显示内部码。',
  infoAria: '关于这条运行结果'
}

const en: MarketAnalysisRunSessionText = {
  title: 'Run result',
  status: {
    queued: 'Queued',
    running: 'Running',
    succeeded: 'Succeeded',
    'invalid-output': 'Output rejected',
    failed: 'Failed',
    cancelled: 'Cancelled',
    stale: 'Out of date',
    superseded: 'Replaced'
  },
  noBody: 'This run produced no text.',
  reasonUnknown: 'No reason was recorded.',
  startedAt: 'Started',
  finishedAt: 'Finished',
  noRecord: 'This run left no record.',
  info: 'Each automatic session is one run. When a run produced no text, its status, reason and times are shown here; reasons are the recorded ones, never internal codes.',
  infoAria: 'About this run result'
}

export const marketAnalysisRunSessionText: Readonly<Record<'zh-CN' | 'en-US', MarketAnalysisRunSessionText>> = {
  'zh-CN': zh,
  'en-US': en
}
