import { describe, expect, it } from 'vitest'

import { signalAnalysisSentence, type SignalAnalysisCopyLookup, type SignalAnalysisCopyPart } from './signalAnalysisSentence'

const states: Record<string, string> = {
  'not-triggered': '还没有轮到这条信号分析',
  queued: '已排上队，正在分析',
  published: '分析已出',
  skipped: '这次没有分析',
  failed: '分析了但没成',
  stopped: '这次运行提前结束了'
}
const stopped: Record<string, string> = { 'run-cancelled': '这次运行被取消了', 'run-superseded': '已被更新的一次取代', 'run-unrecognized': '状态读不出来' }
const skippedReasons: Record<string, string> = { 'signal-cooldown-active': '同一规则刚分析过，这次不重复' }
const failedReasons: Record<string, string> = { 'analysis-provider-error': '模型服务出错了' }

const lookup: SignalAnalysisCopyLookup = (query: SignalAnalysisCopyPart) => {
  if (query.part === 'state') return states[query.code] ?? ''
  if (query.part === 'stoppedReason') return stopped[query.code] ?? ''
  if (query.part === 'skippedReason') return skippedReasons[query.code] ?? ''
  if (query.part === 'failedReason') return failedReasons[query.code] ?? ''
  if (query.part === 'separator') return '：'
  return '原因没记录'
}

const view = (analysisState: string, analysisReason?: string) =>
  ({ analysisOffByReader: false, analysisState, ...(analysisReason ? { analysisReason } : {}) }) as never

describe('the analysis-progress sentence', () => {
  it('says each state once, and only the three refusing states carry a reason', () => {
    expect(signalAnalysisSentence(view('not-triggered'), lookup)).toBe('还没有轮到这条信号分析')
    expect(signalAnalysisSentence(view('queued'), lookup)).toBe('已排上队，正在分析')
    expect(signalAnalysisSentence(view('published'), lookup)).toBe('分析已出')
    expect(signalAnalysisSentence(view('skipped', 'signal-cooldown-active'), lookup)).toBe('这次没有分析：同一规则刚分析过，这次不重复')
    expect(signalAnalysisSentence(view('failed', 'analysis-provider-error'), lookup)).toBe('分析了但没成：模型服务出错了')
    expect(signalAnalysisSentence(view('stopped', 'run-cancelled'), lookup)).toBe('这次运行被取消了')
    expect(signalAnalysisSentence(view('stopped', 'run-superseded'), lookup)).toBe('已被更新的一次取代')
  })

  it('keeps the two code tables apart instead of merging them', () => {
    // 失败的码喂给账本表、账本码喂给失败表：两边都查不到，都落兜底，不许串表。
    expect(signalAnalysisSentence(view('failed', 'signal-cooldown-active'), lookup)).toBe('分析了但没成：原因没记录')
    expect(signalAnalysisSentence(view('skipped', 'analysis-provider-error'), lookup)).toBe('这次没有分析：原因没记录')
  })

  it('never prints a code and never prints an empty reason', () => {
    const unknown = signalAnalysisSentence(view('failed', 'analysis-something-new'), lookup)
    expect(unknown).toBe('分析了但没成：原因没记录')
    expect(unknown).not.toContain('analysis-')
  })
})
